import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * The one idempotent write-back: inserts the activity row unless its key already exists; true if it inserted.
 * It runs inside the caller's mutation, a serializable transaction, so concurrent retries can't both insert.
 */
export async function insertEventOnce(
  ctx: MutationCtx,
  row: Omit<Doc<"automationEvents">, "_id" | "_creationTime" | "createdAt">,
): Promise<boolean> {
  const existing = await ctx.db
    .query("automationEvents")
    .withIndex("by_key", (q) => q.eq("idempotencyKey", row.idempotencyKey))
    .first();
  if (existing) return false;
  await ctx.db.insert("automationEvents", { ...row, createdAt: Date.now() });
  return true;
}
