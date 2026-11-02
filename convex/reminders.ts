import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const DAY_MS = 86_400_000;

/** Approved loans past their end date that have not been reminded for `asOf` (feed for the n8n reminder workflow). */
export const overdue = internalQuery({
  args: { asOf: v.string() },
  // Data minimization: Convex rejects the response if any extra field slips in.
  returns: v.array(
    v.object({
      loanId: v.id("loans"),
      toolName: v.string(),
      endDate: v.string(),
      daysOverdue: v.number(),
      borrower: v.object({ clerkId: v.string(), name: v.string() }),
    }),
  ),
  handler: async (ctx, { asOf }) => {
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_status_endDate", (q) => q.eq("status", "approved").lt("endDate", asOf))
      .collect();
    const rows = await Promise.all(
      loans.map(async (loan) => {
        const reminded = await ctx.db
          .query("automationEvents")
          .withIndex("by_key", (q) => q.eq("idempotencyKey", `reminder:${loan._id}:${asOf}`))
          .first();
        const borrower = await ctx.db.get("users", loan.borrowerId);
        if (reminded || !borrower) return null;
        return {
          loanId: loan._id,
          toolName: loan.toolName,
          endDate: loan.endDate,
          daysOverdue: Math.round((Date.parse(asOf) - Date.parse(loan.endDate)) / DAY_MS),
          borrower: { clerkId: borrower.clerkId, name: borrower.name },
        };
      }),
    );
    return rows.filter((row) => row !== null);
  },
});

/**
 * Write-back from the reminder workflow; idempotent per loan and day.
 * Takes the loan id as an untrusted string so the HTTP route can answer 404; returns null for an unknown loan.
 */
export const record = internalMutation({
  args: {
    loanId: v.string(),
    reminderDate: v.string(),
    status: v.union(v.literal("sent"), v.literal("failed")),
    channel: v.string(),
  },
  handler: async (ctx, { loanId: rawLoanId, reminderDate, status, channel }) => {
    const loanId = ctx.db.normalizeId("loans", rawLoanId);
    if (!loanId || !(await ctx.db.get("loans", loanId))) return null;
    const idempotencyKey = `reminder:${loanId}:${reminderDate}`;
    const existing = await ctx.db
      .query("automationEvents")
      .withIndex("by_key", (q) => q.eq("idempotencyKey", idempotencyKey))
      .first();
    if (existing) return { duplicate: true };
    await ctx.db.insert("automationEvents", {
      loanId,
      kind: "reminder",
      idempotencyKey,
      message: `Reminder ${status} via ${channel}`,
      createdAt: Date.now(),
    });
    return { duplicate: false };
  },
});
