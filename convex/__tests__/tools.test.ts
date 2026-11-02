import { expect, test } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { LoanStatus } from "../constants";
import { admin, alice, bob, newTest, signIn, type TestConvex } from "./test.setup";

const drill = {
  name: "Cordless drill",
  category: "power tools",
  condition: "good",
  description: "18V, two batteries",
} as const;
const rake = { name: "Leaf rake", category: "garden", condition: "worn", description: "" } as const;

async function insertLoan(t: TestConvex, toolId: Id<"tools">, borrowerId: Id<"users">, status: LoanStatus) {
  await t.run(async (ctx) => {
    const tool = await ctx.db.get("tools", toolId);
    const now = Date.now();
    await ctx.db.insert("loans", {
      toolId,
      toolName: tool!.name,
      borrowerId,
      lenderId: tool!.ownerId,
      startDate: "2026-11-01",
      endDate: "2026-11-08",
      status,
      createdAt: now,
      updatedAt: now,
    });
  });
}

test("ensure upserts the user and assigns admin role from ADMIN_CLERK_IDS", async () => {
  const t = newTest();
  const { as: asAlice, userId: aliceId } = await signIn(t, alice);
  const { as: asAdmin, userId: adminId } = await signIn(t, admin);

  expect(await asAlice.query(api.users.current, {})).toMatchObject({
    _id: aliceId,
    clerkId: "user_alice",
    name: "Alice",
    role: "user",
    trustedLender: false,
  });
  expect(await asAdmin.query(api.users.current, {})).toMatchObject({ _id: adminId, role: "admin" });

  const renamed = t.withIdentity({ ...alice, name: "Alice Liddell" });
  expect(await renamed.mutation(api.users.ensure, {})).toBe(aliceId);
  expect(await renamed.query(api.users.current, {})).toMatchObject({ name: "Alice Liddell" });
  expect(await t.run((ctx) => ctx.db.query("users").collect())).toHaveLength(2);
  expect(await t.query(api.users.current, {})).toBeNull();
});

test("create requires sign-in", async () => {
  const t = newTest();
  await expect(t.mutation(api.tools.create, drill)).rejects.toThrow("Sign in required");
});

test("listPublic returns only _id, name, category of available tools", async () => {
  const t = newTest();
  const { as: asAlice } = await signIn(t, alice);
  const toolId = await asAlice.mutation(api.tools.create, drill);

  const items = await t.query(api.tools.listPublic, {});
  expect(items).toEqual([{ _id: toolId, name: "Cordless drill", category: "power tools" }]);
  expect(Object.keys(items[0]).sort()).toEqual(["_id", "category", "name"]);
});

test("listPublic hides tools that are on loan", async () => {
  const t = newTest();
  const { as: asAlice } = await signIn(t, alice);
  const { userId: bobId } = await signIn(t, bob);
  const drillId = await asAlice.mutation(api.tools.create, drill);
  const rakeId = await asAlice.mutation(api.tools.create, rake);

  await insertLoan(t, drillId, bobId, "approved");
  await insertLoan(t, rakeId, bobId, "pending");

  const items = await t.query(api.tools.listPublic, {});
  expect(items.map((item) => item.name)).toEqual(["Leaf rake"]);
});

test("list marks availability, ownership and trusted lender", async () => {
  const t = newTest();
  const { as: asAlice, userId: aliceId } = await signIn(t, alice);
  const { as: asBob, userId: bobId } = await signIn(t, bob);
  const toolId = await asAlice.mutation(api.tools.create, drill);

  expect(await asAlice.query(api.tools.list, {})).toMatchObject([
    { _id: toolId, ownerName: "Alice", ownerTrusted: false, isMine: true, available: true },
  ]);
  expect(await asBob.query(api.tools.list, {})).toMatchObject([{ _id: toolId, isMine: false }]);

  await t.run((ctx) => ctx.db.patch("users", aliceId, { trustedLender: true }));
  await insertLoan(t, toolId, bobId, "approved");

  expect(await asBob.query(api.tools.list, {})).toMatchObject([
    { _id: toolId, ownerName: "Alice", ownerTrusted: true, isMine: false, available: false },
  ]);
});

test("list filters by category", async () => {
  const t = newTest();
  const { as: asAlice } = await signIn(t, alice);
  await asAlice.mutation(api.tools.create, drill);
  await asAlice.mutation(api.tools.create, rake);

  const garden = await asAlice.query(api.tools.list, { category: "garden" });
  expect(garden.map((tool) => tool.name)).toEqual(["Leaf rake"]);
  expect(await asAlice.query(api.tools.list, {})).toHaveLength(2);
});

test("mine returns only the caller's tools", async () => {
  const t = newTest();
  const { as: asAlice } = await signIn(t, alice);
  const { as: asBob } = await signIn(t, bob);
  await asAlice.mutation(api.tools.create, drill);
  await asBob.mutation(api.tools.create, rake);

  expect((await asAlice.query(api.tools.mine, {})).map((tool) => tool.name)).toEqual(["Cordless drill"]);
  expect((await asBob.query(api.tools.mine, {})).map((tool) => tool.name)).toEqual(["Leaf rake"]);
});

test("user cannot update or remove another user's tool", async () => {
  const t = newTest();
  const { as: asAlice } = await signIn(t, alice);
  const { as: asBob } = await signIn(t, bob);
  const toolId = await asAlice.mutation(api.tools.create, drill);

  await expect(asBob.mutation(api.tools.update, { toolId, ...drill, name: "Mine now" })).rejects.toThrow(
    "Forbidden",
  );
  await expect(asBob.mutation(api.tools.remove, { toolId })).rejects.toThrow("Forbidden");

  await asAlice.mutation(api.tools.update, { toolId, ...drill, condition: "fair" });
  expect(await t.run((ctx) => ctx.db.get("tools", toolId))).toMatchObject({
    name: "Cordless drill",
    condition: "fair",
  });
});

test("admin can remove any tool", async () => {
  const t = newTest();
  const { as: asAlice } = await signIn(t, alice);
  const { as: asAdmin } = await signIn(t, admin);
  const toolId = await asAlice.mutation(api.tools.create, drill);

  expect(await asAdmin.mutation(api.tools.remove, { toolId })).toBeNull();
  expect(await t.run((ctx) => ctx.db.get("tools", toolId))).toBeNull();
});

test("create rejects an empty name and an overlong description", async () => {
  const t = newTest();
  const { as: asAlice } = await signIn(t, alice);

  await expect(asAlice.mutation(api.tools.create, { ...drill, name: "   " })).rejects.toThrow(
    "Name must be 1–80 characters",
  );
  await expect(asAlice.mutation(api.tools.create, { ...drill, description: "x".repeat(501) })).rejects.toThrow(
    "Description must be at most 500 characters",
  );

  const toolId = await asAlice.mutation(api.tools.create, { ...drill, name: "  Cordless drill  " });
  expect(await t.run((ctx) => ctx.db.get("tools", toolId))).toMatchObject({ name: "Cordless drill" });
});

test("update rejects a bad name", async () => {
  const t = newTest();
  const { as: asAlice } = await signIn(t, alice);
  const toolId = await asAlice.mutation(api.tools.create, drill);

  for (const name of ["", "x".repeat(81)]) {
    await expect(asAlice.mutation(api.tools.update, { toolId, ...drill, name })).rejects.toThrow(
      "Name must be 1–80 characters",
    );
  }
  await asAlice.mutation(api.tools.update, { toolId, ...drill, name: "x".repeat(80) });
  expect((await t.run((ctx) => ctx.db.get("tools", toolId)))?.name).toHaveLength(80);
});

test("update on a missing tool is Not found", async () => {
  const t = newTest();
  const { as: asAlice } = await signIn(t, alice);
  const toolId = await asAlice.mutation(api.tools.create, drill);
  await t.run((ctx) => ctx.db.delete("tools", toolId));

  await expect(asAlice.mutation(api.tools.update, { toolId, ...drill })).rejects.toThrow("Not found");
});

test("remove by a non-owner is Forbidden", async () => {
  const t = newTest();
  const { as: asAlice } = await signIn(t, alice);
  const { as: asBob } = await signIn(t, bob);
  const toolId = await asAlice.mutation(api.tools.create, drill);

  await expect(asBob.mutation(api.tools.remove, { toolId })).rejects.toThrow("Forbidden");
  expect(await t.run((ctx) => ctx.db.get("tools", toolId))).not.toBeNull();
});
