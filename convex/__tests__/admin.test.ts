import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { admin, alice, bob, newTest, signIn } from "./test.setup";

const NOW = Date.parse("2026-11-02T12:00:00Z");
const drill = { name: "Cordless drill", category: "power tools", condition: "good", description: "" } as const;
const tent = { name: "Tent", category: "camping", condition: "fair", description: "" } as const;
const dates = { startDate: "2026-11-03", endDate: "2026-11-05" };

beforeEach(() => {
  // Fake timers pin "today" and keep the scheduled n8n calls queued instead of running.
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

test("non-admins get Forbidden on every admin function", async () => {
  const t = newTest();
  const { as: asBob, userId: bobId } = await signIn(t, bob);
  const calls = [
    () => asBob.query(api.admin.allLoans, {}),
    () => asBob.query(api.admin.allTools, {}),
    () => asBob.query(api.admin.users, {}),
    () => asBob.mutation(api.admin.setTrustedLender, { userId: bobId, trusted: true }),
  ];

  for (const call of calls) await expect(call()).rejects.toThrow("Forbidden");
  // The ADMIN_CLERK_IDS env var is the authority, not a stored role.
  await t.run((ctx) => ctx.db.patch("users", bobId, { role: "admin" }));
  for (const call of calls) await expect(call()).rejects.toThrow("Forbidden");
  await expect(t.query(api.admin.allLoans, {})).rejects.toThrow("Sign in required");
});

test("admin sees all loans and all tools", async () => {
  const t = newTest();
  const { as: asAlice, userId: aliceId } = await signIn(t, alice);
  const { as: asBob, userId: bobId } = await signIn(t, bob);
  const { as: asAdmin, userId: adminId } = await signIn(t, admin);
  const drillId = await asAlice.mutation(api.tools.create, drill);
  const tentId = await asBob.mutation(api.tools.create, tent);
  const bobLoan = await asBob.mutation(api.loans.request, { toolId: drillId, ...dates });
  const aliceLoan = await asAlice.mutation(api.loans.request, { toolId: tentId, ...dates });

  const loans = await asAdmin.query(api.admin.allLoans, {});
  expect(loans.map((loan) => loan._id)).toEqual([aliceLoan, bobLoan]);
  expect(loans[0]).toMatchObject({ borrowerName: "Alice", lenderName: "Bob", isOverdue: false, activity: [] });

  expect(await asAdmin.query(api.admin.allTools, {})).toMatchObject([
    { _id: drillId, name: "Cordless drill", ownerName: "Alice" },
    { _id: tentId, name: "Tent", ownerName: "Bob" },
  ]);

  expect(await asAdmin.query(api.admin.users, {})).toEqual([
    { _id: aliceId, name: "Alice", role: "user", trustedLender: false },
    { _id: bobId, name: "Bob", role: "user", trustedLender: false },
    { _id: adminId, name: "Ada Admin", role: "admin", trustedLender: false },
  ]);
});

test("admin can mark a lender trusted and tools.list reflects it", async () => {
  const t = newTest();
  const { as: asAlice, userId: aliceId } = await signIn(t, alice);
  const { as: asBob } = await signIn(t, bob);
  const { as: asAdmin } = await signIn(t, admin);
  await asAlice.mutation(api.tools.create, drill);

  expect(await asAdmin.mutation(api.admin.setTrustedLender, { userId: aliceId, trusted: true })).toBeNull();
  expect(await asBob.query(api.tools.list, {})).toMatchObject([{ ownerName: "Alice", ownerTrusted: true }]);

  await asAdmin.mutation(api.admin.setTrustedLender, { userId: aliceId, trusted: false });
  expect(await asBob.query(api.tools.list, {})).toMatchObject([{ ownerTrusted: false }]);
});

test("seed.demo inserts demo data once", async () => {
  const t = newTest();
  const counts = () =>
    t.run(async (ctx) => ({
      users: (await ctx.db.query("users").collect()).length,
      tools: (await ctx.db.query("tools").collect()).length,
      loans: (await ctx.db.query("loans").collect()).length,
    }));

  expect(await t.mutation(internal.seed.demo, {})).toEqual({ users: 2, tools: 4, loans: 2 });
  expect(await counts()).toEqual({ users: 2, tools: 4, loans: 2 });

  const { tools, loans, users } = await t.run(async (ctx) => ({
    users: await ctx.db.query("users").collect(),
    tools: await ctx.db.query("tools").collect(),
    loans: await ctx.db.query("loans").collect(),
  }));
  expect(users.map((user) => user.clerkId)).toEqual(["user_alice", "user_bob"]);
  expect(new Set(tools.map((tool) => tool.category)).size).toBe(4);
  const [aliceId, bobId] = users.map((user) => user._id);
  const aliceDrill = tools.find((tool) => tool.ownerId === aliceId && tool.category === "power tools");
  expect(loans.find((loan) => loan.status === "pending")).toMatchObject({
    toolId: aliceDrill?._id,
    borrowerId: bobId,
    lenderId: aliceId,
  });
  expect(loans.find((loan) => loan.status === "approved")).toMatchObject({ endDate: "2026-10-30" });
  expect(await t.query(internal.reminders.overdue, { asOf: "2026-11-02" })).toMatchObject([{ daysOverdue: 3 }]);

  expect(await t.mutation(internal.seed.demo, {})).toEqual({ users: 0, tools: 0, loans: 0 });
  expect(await counts()).toEqual({ users: 2, tools: 4, loans: 2 });
});
