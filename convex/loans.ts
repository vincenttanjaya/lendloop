import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { LoanStatus } from "./constants";
import { requireUser } from "./lib/auth";
import { isISODate, todayISO } from "./lib/dates";

export type LoanView = Doc<"loans"> & {
  borrowerName: string;
  lenderName: string;
  isOverdue: boolean;
  activity: { kind: "notification" | "reminder"; message: string; createdAt: number }[];
};

export async function toLoanView(ctx: QueryCtx, loan: Doc<"loans">): Promise<LoanView> {
  const [borrower, lender, events] = await Promise.all([
    ctx.db.get("users", loan.borrowerId),
    ctx.db.get("users", loan.lenderId),
    ctx.db
      .query("automationEvents")
      .withIndex("by_loan", (q) => q.eq("loanId", loan._id))
      .order("desc")
      .take(5),
  ]);
  return {
    ...loan,
    borrowerName: borrower?.name ?? "Unknown",
    lenderName: lender?.name ?? "Unknown",
    // ponytail: uses query time, so a cached subscription flips to overdue on its next re-run, not exactly at midnight UTC.
    isOverdue: loan.status === "approved" && loan.endDate < todayISO(),
    activity: events.map(({ kind, message, createdAt }) => ({ kind, message, createdAt })),
  };
}

/** A tool is available iff it has no approved loan. */
export async function isToolAvailable(ctx: QueryCtx | MutationCtx, toolId: Id<"tools">): Promise<boolean> {
  // ponytail: scans this tool's loan history; add a ["toolId", "status"] index if tools accumulate many loans.
  const approved = await ctx.db
    .query("loans")
    .withIndex("by_tool", (q) => q.eq("toolId", toolId))
    .filter((q) => q.eq(q.field("status"), "approved"))
    .first();
  return approved === null;
}

/** Every status change goes through here: bump updatedAt, then tell n8n. */
export async function setLoanStatus(
  ctx: MutationCtx,
  loanId: Id<"loans">,
  status: Exclude<LoanStatus, "pending">,
  actorId: Id<"users">,
) {
  await ctx.db.patch("loans", loanId, { status, updatedAt: Date.now() });
  await ctx.scheduler.runAfter(0, internal.n8n.sendLoanEvent, { loanId, event: status, actorId });
}

/** Loads a loan the caller is a party to (as one of `parties`) and checks it is in the `from` state. */
async function loanForTransition(
  ctx: MutationCtx,
  loanId: Id<"loans">,
  parties: ("lender" | "borrower")[],
  from: "pending" | "approved",
) {
  const user = await requireUser(ctx);
  const loan = await ctx.db.get("loans", loanId);
  if (!loan) throw new ConvexError("Not found");
  const isParty =
    (parties.includes("lender") && loan.lenderId === user._id) ||
    (parties.includes("borrower") && loan.borrowerId === user._id);
  if (!isParty) throw new ConvexError("Forbidden");
  if (loan.status !== from) {
    throw new ConvexError(from === "pending" ? "Request is no longer pending" : "Loan is not active");
  }
  return { user, loan };
}

export const request = mutation({
  args: { toolId: v.id("tools"), startDate: v.string(), endDate: v.string() },
  handler: async (ctx, { toolId, startDate, endDate }) => {
    const user = await requireUser(ctx);
    const tool = await ctx.db.get("tools", toolId);
    if (!tool) throw new ConvexError("Not found");
    if (tool.ownerId === user._id) throw new ConvexError("You can't borrow your own tool");
    if (!isISODate(startDate) || !isISODate(endDate)) throw new ConvexError("Dates must be YYYY-MM-DD");
    if (startDate > endDate) throw new ConvexError("End date must be on or after start date");
    if (endDate < todayISO()) throw new ConvexError("End date can't be in the past");
    if (!(await isToolAvailable(ctx, toolId))) throw new ConvexError("Tool is already on loan");
    const alreadyPending = await ctx.db
      .query("loans")
      .withIndex("by_tool", (q) => q.eq("toolId", toolId))
      .filter((q) => q.and(q.eq(q.field("borrowerId"), user._id), q.eq(q.field("status"), "pending")))
      .first();
    if (alreadyPending) throw new ConvexError("You already have a pending request for this tool");

    const now = Date.now();
    const loanId = await ctx.db.insert("loans", {
      toolId,
      toolName: tool.name,
      borrowerId: user._id,
      lenderId: tool.ownerId,
      startDate,
      endDate,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.n8n.sendLoanEvent, { loanId, event: "requested", actorId: user._id });
    return loanId;
  },
});

export const approve = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const { user, loan } = await loanForTransition(ctx, loanId, ["lender"], "pending");
    if (!(await isToolAvailable(ctx, loan.toolId))) throw new ConvexError("Tool is already on loan");
    // A request can wait past its dates (e.g. behind another loan); approving it then would start out overdue.
    if (loan.endDate < todayISO()) throw new ConvexError("This request's dates have passed");
    await setLoanStatus(ctx, loanId, "approved", user._id);
    return null;
  },
});

export const decline = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const { user } = await loanForTransition(ctx, loanId, ["lender"], "pending");
    await setLoanStatus(ctx, loanId, "declined", user._id);
    return null;
  },
});

export const cancel = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const { user } = await loanForTransition(ctx, loanId, ["borrower"], "pending");
    await setLoanStatus(ctx, loanId, "cancelled", user._id);
    return null;
  },
});

export const markReturned = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const { user } = await loanForTransition(ctx, loanId, ["lender", "borrower"], "approved");
    await setLoanStatus(ctx, loanId, "returned", user._id);
    return null;
  },
});

/** Loans the caller asked for, newest first. */
export const mine = query({
  args: {},
  handler: async (ctx): Promise<LoanView[]> => {
    const user = await requireUser(ctx);
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", user._id))
      .order("desc")
      .collect();
    return await Promise.all(loans.map((loan) => toLoanView(ctx, loan)));
  },
});

/** Requests for the caller's tools, newest first. */
export const incoming = query({
  args: {},
  handler: async (ctx): Promise<LoanView[]> => {
    const user = await requireUser(ctx);
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_lender", (q) => q.eq("lenderId", user._id))
      .order("desc")
      .collect();
    return await Promise.all(loans.map((loan) => toLoanView(ctx, loan)));
  },
});
