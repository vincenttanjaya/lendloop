import { ConvexError } from "convex/values";
import { expect, test } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { alice, modules, newTest, signIn, type TestConvex } from "./test.setup";

const drill = { name: "Cordless drill", category: "power tools", condition: "good", description: "" } as const;

type Ids = { userId: Id<"users">; toolId: Id<"tools">; loanId: Id<"loans"> };

/** Real ids so every call passes argument validation and reaches the auth check. */
function seed(t: TestConvex): Promise<Ids> {
  return t.run(async (ctx) => {
    const plain = { role: "user", trustedLender: false } as const;
    const userId = await ctx.db.insert("users", { clerkId: "user_alice", name: "Alice", ...plain });
    const borrowerId = await ctx.db.insert("users", { clerkId: "user_bob", name: "Bob", ...plain });
    const toolId = await ctx.db.insert("tools", { ...drill, ownerId: userId });
    const loanId = await ctx.db.insert("loans", {
      toolId,
      toolName: drill.name,
      borrowerId,
      lenderId: userId,
      startDate: "2099-01-01",
      endDate: "2099-01-02",
      status: "pending",
      createdAt: 0,
      updatedAt: 0,
    });
    return { userId, toolId, loanId };
  });
}

// Every public function except tools:listPublic and users:current, which serve signed-out visitors.
const signedInOnly: [string, (t: TestConvex, ids: Ids) => Promise<unknown>][] = [
  ["tools:list", (t) => t.query(api.tools.list, {})],
  ["tools:mine", (t) => t.query(api.tools.mine, {})],
  ["tools:create", (t) => t.mutation(api.tools.create, drill)],
  ["tools:update", (t, { toolId }) => t.mutation(api.tools.update, { toolId, ...drill })],
  ["tools:remove", (t, { toolId }) => t.mutation(api.tools.remove, { toolId })],
  [
    "loans:request",
    (t, { toolId }) => t.mutation(api.loans.request, { toolId, startDate: "2099-01-01", endDate: "2099-01-02" }),
  ],
  ["loans:approve", (t, { loanId }) => t.mutation(api.loans.approve, { loanId })],
  ["loans:decline", (t, { loanId }) => t.mutation(api.loans.decline, { loanId })],
  ["loans:cancel", (t, { loanId }) => t.mutation(api.loans.cancel, { loanId })],
  ["loans:markReturned", (t, { loanId }) => t.mutation(api.loans.markReturned, { loanId })],
  ["loans:mine", (t) => t.query(api.loans.mine, {})],
  ["loans:incoming", (t) => t.query(api.loans.incoming, {})],
  ["admin:allLoans", (t) => t.query(api.admin.allLoans, {})],
  ["admin:allTools", (t) => t.query(api.admin.allTools, {})],
  ["admin:users", (t) => t.query(api.admin.users, {})],
  ["admin:setTrustedLender", (t, { userId }) => t.mutation(api.admin.setTrustedLender, { userId, trusted: true })],
  ["users:ensure", (t) => t.mutation(api.users.ensure, {})],
];

test.each(signedInOnly)("every non-public function rejects anonymous callers: %s", async (_name, call) => {
  const t = newTest();
  const result = call(t, await seed(t));
  await expect(result).rejects.toBeInstanceOf(ConvexError);
  await expect(result).rejects.toMatchObject({ data: "Sign in required" });
});

test("the anonymous table covers every public function", async () => {
  const found: string[] = [];
  for (const [path, load] of Object.entries(modules)) {
    // Test files in this folder glob as "./x.test.ts"; Convex modules as "../x.ts".
    if (!path.startsWith("../") || path.startsWith("../_generated/")) continue;
    const moduleName = path.replace(/^\.\.\//, "").replace(/\.ts$/, "");
    for (const [name, value] of Object.entries((await load()) as Record<string, { isPublic?: boolean }>)) {
      if (value?.isPublic) found.push(`${moduleName}:${name}`);
    }
  }
  const expected = [...signedInOnly.map(([name]) => name), "tools:listPublic", "users:current"];
  expect(found.sort()).toEqual(expected.sort());
});

test("signed-out visitors can call the public functions", async () => {
  const t = newTest();
  const { toolId } = await seed(t);
  const { name, category } = drill;
  expect(await t.query(api.tools.listPublic, {})).toEqual([{ _id: toolId, name, category }]);
  expect(await t.query(api.users.current, {})).toBeNull();
});

test("a stale stored admin role is not trusted", async () => {
  const t = newTest();
  const { as: asAlice } = await signIn(t, alice);
  const toolId = await asAlice.mutation(api.tools.create, drill);
  // Not in ADMIN_CLERK_IDS; never calls users.ensure, so the stored role stays "admin".
  await t.run((ctx) =>
    ctx.db.insert("users", { clerkId: "user_stale", name: "Stale", role: "admin", trustedLender: false }),
  );
  const asStale = t.withIdentity({ subject: "user_stale", name: "Stale" });

  await expect(asStale.query(api.admin.allTools, {})).rejects.toThrow("Forbidden");
  await expect(asStale.mutation(api.tools.remove, { toolId })).rejects.toThrow("Forbidden");
  expect(await t.run((ctx) => ctx.db.get("tools", toolId))).not.toBeNull();
});

test("JWT names are trimmed, capped at 80 chars and fall back to Neighbor", async () => {
  const t = newTest();
  const { userId: longId } = await signIn(t, { subject: "user_long", name: "  " + "x".repeat(100) + "  " });
  const { userId: blankId } = await signIn(t, { subject: "user_blank", name: "   " });

  expect((await t.run((ctx) => ctx.db.get("users", longId)))?.name).toBe("x".repeat(80));
  expect((await t.run((ctx) => ctx.db.get("users", blankId)))?.name).toBe("Neighbor");
});

test("an owner cannot list more than 50 tools", async () => {
  const t = newTest();
  const { as: asAlice } = await signIn(t, alice);
  for (let i = 1; i <= 50; i++) await asAlice.mutation(api.tools.create, { ...drill, name: `Drill ${i}` });

  await expect(asAlice.mutation(api.tools.create, drill)).rejects.toThrow("You can list at most 50 tools");
  expect(await asAlice.query(api.tools.mine, {})).toHaveLength(50);
});
