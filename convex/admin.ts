import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin } from "./lib/auth";
import { toLoanView, type LoanView } from "./loans";

// ponytail: admin lists are unpaginated; switch to .paginate() once the board outgrows a few hundred rows.

export const allLoans = query({
  args: {},
  handler: async (ctx): Promise<LoanView[]> => {
    await requireAdmin(ctx);
    const loans = await ctx.db.query("loans").order("desc").collect();
    return await Promise.all(loans.map((loan) => toLoanView(ctx, loan)));
  },
});

export const allTools = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const tools = await ctx.db.query("tools").collect();
    return await Promise.all(
      tools.map(async (tool) => ({
        ...tool,
        ownerName: (await ctx.db.get("users", tool.ownerId))?.name ?? "Unknown",
      })),
    );
  },
});

export const users = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const rows = await ctx.db.query("users").collect();
    return rows.map(({ _id, name, role, trustedLender }) => ({ _id, name, role, trustedLender }));
  },
});

export const setTrustedLender = mutation({
  args: { userId: v.id("users"), trusted: v.boolean() },
  handler: async (ctx, { userId, trusted }) => {
    await requireAdmin(ctx);
    if (!(await ctx.db.get("users", userId))) throw new ConvexError("Not found");
    await ctx.db.patch("users", userId, { trustedLender: trusted });
    return null;
  },
});
