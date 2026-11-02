import { internalMutation } from "./_generated/server";
import { DAY_MS, todayISO } from "./lib/dates";

/** Demo data for a fresh deployment (`npx convex run seed:demo`); does nothing once any user exists. */
export const demo = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (await ctx.db.query("users").first()) return { users: 0, tools: 0, loans: 0 };

    const now = Date.now();
    const day = (offset: number) => todayISO(now + offset * DAY_MS);
    const aliceId = await ctx.db.insert("users", { clerkId: "user_alice", name: "Alice", role: "user", trustedLender: false });
    const bobId = await ctx.db.insert("users", { clerkId: "user_bob", name: "Bob", role: "user", trustedLender: false });

    const drillId = await ctx.db.insert("tools", {
      ownerId: aliceId,
      name: "Cordless drill",
      category: "power tools",
      condition: "good",
      description: "18V drill with two batteries and a charger.",
    });
    await ctx.db.insert("tools", {
      ownerId: aliceId,
      name: "Leaf rake",
      category: "garden",
      condition: "worn",
      description: "Wide metal rake, handle has seen better days.",
    });
    const tentId = await ctx.db.insert("tools", {
      ownerId: bobId,
      name: "Four-person tent",
      category: "camping",
      condition: "good",
      description: "Pitches in ten minutes; footprint included.",
    });
    await ctx.db.insert("tools", {
      ownerId: bobId,
      name: "Stand mixer",
      category: "kitchen",
      condition: "new",
      description: "Five-quart bowl with dough hook and whisk.",
    });

    await ctx.db.insert("loans", {
      toolId: drillId,
      toolName: "Cordless drill",
      borrowerId: bobId,
      lenderId: aliceId,
      startDate: day(2),
      endDate: day(5),
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("loans", {
      toolId: tentId,
      toolName: "Four-person tent",
      borrowerId: aliceId,
      lenderId: bobId,
      startDate: day(-10),
      endDate: day(-3),
      status: "approved",
      createdAt: now,
      updatedAt: now,
    });
    return { users: 2, tools: 4, loans: 2 };
  },
});
