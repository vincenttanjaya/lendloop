import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { categoryValidator, conditionValidator } from "./constants";
import { isAdminClerkId, requireToolOwner, requireUser } from "./lib/auth";
import { isToolAvailable, setLoanStatus } from "./loans";

export const MAX_TOOLS_PER_OWNER = 50;

const toolFields = {
  name: v.string(),
  category: categoryValidator,
  condition: conditionValidator,
  description: v.string(),
};

function cleanText(fields: { name: string; description: string }) {
  const name = fields.name.trim();
  const description = fields.description.trim();
  if (name.length < 1 || name.length > 80) throw new ConvexError("Name must be 1–80 characters");
  if (description.length > 500) throw new ConvexError("Description must be at most 500 characters");
  return { name, description };
}

/** Signed-out view: available tools with only the fields safe to show anyone. */
export const listPublic = query({
  args: {},
  // Data minimization: Convex rejects the response if any extra field slips in.
  returns: v.array(v.object({ _id: v.id("tools"), name: v.string(), category: categoryValidator })),
  handler: async (ctx) => {
    // ponytail: full scan plus one loan lookup per tool; paginate once the board outgrows a few hundred tools.
    const tools = await ctx.db.query("tools").collect();
    const available = await Promise.all(tools.map((tool) => isToolAvailable(ctx, tool._id)));
    return tools.filter((_, i) => available[i]).map(({ _id, name, category }) => ({ _id, name, category }));
  },
});

export const list = query({
  args: { category: v.optional(categoryValidator) },
  handler: async (ctx, { category }) => {
    const user = await requireUser(ctx);
    const tools = category
      ? await ctx.db
          .query("tools")
          .withIndex("by_category", (q) => q.eq("category", category))
          .collect()
      : await ctx.db.query("tools").collect();
    return await Promise.all(
      tools.map(async (tool) => {
        const owner = await ctx.db.get("users", tool.ownerId);
        return {
          ...tool,
          ownerName: owner?.name ?? "Unknown",
          ownerTrusted: owner?.trustedLender ?? false,
          isMine: tool.ownerId === user._id,
          available: await isToolAvailable(ctx, tool._id),
        };
      }),
    );
  },
});

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    return await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .collect();
  },
});

export const create = mutation({
  args: toolFields,
  handler: async (ctx, fields) => {
    const user = await requireUser(ctx);
    // ponytail: hard cap so one account cannot bloat the public board past Convex read limits.
    const owned = await ctx.db.query("tools").withIndex("by_owner", (q) => q.eq("ownerId", user._id)).collect();
    if (owned.length >= MAX_TOOLS_PER_OWNER) throw new ConvexError(`You can list at most ${MAX_TOOLS_PER_OWNER} tools`);
    return await ctx.db.insert("tools", { ...fields, ...cleanText(fields), ownerId: user._id });
  },
});

export const update = mutation({
  args: { toolId: v.id("tools"), ...toolFields },
  handler: async (ctx, { toolId, ...fields }) => {
    await requireToolOwner(ctx, toolId);
    await ctx.db.patch("tools", toolId, { ...fields, ...cleanText(fields) });
    return null;
  },
});

export const remove = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    const user = await requireUser(ctx);
    const tool = await ctx.db.get("tools", toolId);
    if (!tool) throw new ConvexError("Not found");
    const isAdmin = isAdminClerkId(user.clerkId);
    if (tool.ownerId !== user._id && !isAdmin) throw new ConvexError("Forbidden");
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_tool", (q) => q.eq("toolId", toolId))
      .collect();
    // The owner takes the tool back first; an admin can remove any listing, which also ends its active loan.
    if (!isAdmin && loans.some((loan) => loan.status === "approved")) {
      throw new ConvexError("Tool is on loan; mark it returned first");
    }
    for (const loan of loans) {
      if (loan.status === "pending" || loan.status === "approved") {
        await setLoanStatus(ctx, loan._id, "cancelled", user._id);
      }
    }
    // Loans keep their own toolName, so history still reads correctly once the tool is gone.
    await ctx.db.delete("tools", toolId);
    return null;
  },
});
