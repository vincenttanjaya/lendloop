import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, sign } from "./lib/signature";

export const LOAN_EVENTS = ["requested", "approved", "declined", "cancelled", "returned"] as const;
export const loanEventValidator = v.union(...LOAN_EVENTS.map((event) => v.literal(event)));

const RETRY_DELAYS_MS = [5_000, 30_000];
const eventArgs = { loanId: v.id("loans"), event: loanEventValidator, actorId: v.id("users") };

/** The outbound webhook payload: only what n8n needs to notify one person. */
export const loadLoanEvent = internalQuery({
  args: eventArgs,
  // Data minimization: Convex rejects the payload if any extra field slips in.
  returns: v.union(
    v.null(),
    v.object({
      eventId: v.string(),
      event: loanEventValidator,
      loanId: v.id("loans"),
      toolName: v.string(),
      startDate: v.string(),
      endDate: v.string(),
      recipient: v.object({ clerkId: v.string(), name: v.string() }),
      actorName: v.string(),
    }),
  ),
  handler: async (ctx, { loanId, event, actorId }) => {
    const loan = await ctx.db.get("loans", loanId);
    if (!loan) return null;
    const toLender =
      event === "requested" ||
      ((event === "cancelled" || event === "returned") && actorId === loan.borrowerId);
    const [recipient, actor] = await Promise.all([
      ctx.db.get("users", toLender ? loan.lenderId : loan.borrowerId),
      ctx.db.get("users", actorId),
    ]);
    if (!recipient || !actor) return null;
    return {
      eventId: `${loanId}:${event}:${loan.updatedAt}`,
      event,
      loanId,
      toolName: loan.toolName,
      startDate: loan.startDate,
      endDate: loan.endDate,
      recipient: { clerkId: recipient.clerkId, name: recipient.name },
      actorName: actor.name,
    };
  },
});

export const recordNotification = internalMutation({
  args: { loanId: v.id("loans"), idempotencyKey: v.string(), message: v.string() },
  returns: v.null(),
  handler: async (ctx, { loanId, idempotencyKey, message }) => {
    const existing = await ctx.db
      .query("automationEvents")
      .withIndex("by_key", (q) => q.eq("idempotencyKey", idempotencyKey))
      .first();
    if (!existing) {
      await ctx.db.insert("automationEvents", {
        loanId,
        kind: "notification",
        idempotencyKey,
        message,
        createdAt: Date.now(),
      });
    }
    return null;
  },
});

/** Posts a signed loan event to n8n; retries after 5 s and 30 s, then throws so the failure shows in the logs. */
export const sendLoanEvent = internalAction({
  args: { ...eventArgs, attempt: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const { loanId, event, actorId, attempt = 1 } = args;
    const payload = await ctx.runQuery(internal.n8n.loadLoanEvent, { loanId, event, actorId });
    if (!payload) return null;

    const url = process.env.N8N_LOAN_EVENT_WEBHOOK_URL;
    if (!url) {
      console.warn("n8n webhook URL not configured; skipping", payload.eventId);
      return null;
    }
    const secret = process.env.LENDLOOP_WEBHOOK_SECRET;
    if (!secret) throw new Error("LENDLOOP_WEBHOOK_SECRET is not set");

    const body = JSON.stringify(payload);
    const timestamp = String(Date.now());
    let detail: string;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [TIMESTAMP_HEADER]: timestamp,
          [SIGNATURE_HEADER]: await sign(secret, timestamp, body),
        },
        body,
      });
      if (response.ok) {
        await ctx.runMutation(internal.n8n.recordNotification, {
          loanId,
          idempotencyKey: `notify:${payload.eventId}`,
          message: `Notified ${payload.recipient.name} (${event})`,
        });
        return null;
      }
      detail = `HTTP ${response.status}`;
    } catch (error) {
      detail = error instanceof Error ? error.message : String(error);
    }

    if (attempt < 3) {
      await ctx.scheduler.runAfter(RETRY_DELAYS_MS[attempt - 1], internal.n8n.sendLoanEvent, {
        ...args,
        attempt: attempt + 1,
      });
      return null;
    }
    throw new Error(`n8n webhook failed after 3 attempts: ${detail}`);
  },
});
