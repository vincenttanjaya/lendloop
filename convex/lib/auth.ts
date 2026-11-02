import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export function isAdminClerkId(clerkId: string): boolean {
  const adminIds = (process.env.ADMIN_CLERK_IDS ?? "").split(",").map((id) => id.trim());
  return adminIds.filter(Boolean).includes(clerkId);
}

export async function getUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
    .unique();
}

export async function requireUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users">> {
  const user = await getUser(ctx);
  if (!user) throw new ConvexError("Sign in required");
  return user;
}

export async function requireAdmin(ctx: QueryCtx | MutationCtx): Promise<Doc<"users">> {
  const user = await requireUser(ctx);
  // The env var, not the stored role, is the authority: revoking an admin takes effect immediately.
  if (!isAdminClerkId(user.clerkId)) throw new ConvexError("Forbidden");
  return user;
}

export async function requireToolOwner(
  ctx: QueryCtx | MutationCtx,
  toolId: Id<"tools">,
): Promise<{ user: Doc<"users">; tool: Doc<"tools"> }> {
  const user = await requireUser(ctx);
  const tool = await ctx.db.get("tools", toolId);
  if (!tool) throw new ConvexError("Not found");
  if (tool.ownerId !== user._id) throw new ConvexError("Forbidden");
  return { user, tool };
}

export async function getOrCreateUser(ctx: MutationCtx): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Sign in required");
  // No name in the token (e.g. an email-only sign-up): a short id suffix keeps such users apart on /admin.
  const name = (identity.name || identity.nickname || "").trim().slice(0, 80) || `Neighbor ${identity.subject.slice(-4)}`;
  const role = isAdminClerkId(identity.subject) ? "admin" : "user";

  const existing = await getUser(ctx);
  if (existing) {
    if (existing.name !== name || existing.role !== role) await ctx.db.patch("users", existing._id, { name, role });
    return { ...existing, name, role };
  }
  const userId = await ctx.db.insert("users", { clerkId: identity.subject, name, role, trustedLender: false });
  return (await ctx.db.get("users", userId))!;
}
