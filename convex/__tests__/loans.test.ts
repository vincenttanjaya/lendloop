import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { admin, alice, bob, newTest, signIn, type TestConvex } from "./test.setup";

const carol = { subject: "user_carol", name: "Carol" };
const NOW = Date.parse("2026-11-02T12:00:00Z");
const dates = { startDate: "2026-11-03", endDate: "2026-11-05" };
const drill = { name: "Cordless drill", category: "power tools", condition: "good", description: "" } as const;
const rake = { name: "Leaf rake", category: "garden", condition: "worn", description: "" } as const;

beforeEach(() => {
  // Fake timers pin "today" and keep the scheduled n8n calls queued instead of running.
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

async function setup() {
  const t = newTest();
  const { as: asAlice, userId: aliceId } = await signIn(t, alice);
  const { as: asBob, userId: bobId } = await signIn(t, bob);
  const { as: asCarol } = await signIn(t, carol);
  const { as: asAdmin, userId: adminId } = await signIn(t, admin);
  const drillId = await asAlice.mutation(api.tools.create, drill);
  return { t, asAlice, aliceId, asBob, bobId, asCarol, asAdmin, adminId, drillId };
}

type Signed = Awaited<ReturnType<typeof setup>>["asBob"];

const requestDrill = (as: Signed, toolId: Id<"tools">, overrides: Partial<typeof dates> = {}) =>
  as.mutation(api.loans.request, { toolId, ...dates, ...overrides });

const loanOf = (t: TestConvex, loanId: Id<"loans">) => t.run((ctx) => ctx.db.get("loans", loanId));

const scheduledEvents = (t: TestConvex) =>
  t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).map((job) => job.args[0]));

test("request creates a pending loan and schedules a notification", async () => {
  const { t, asBob, aliceId, bobId, drillId } = await setup();

  const loanId = await requestDrill(asBob, drillId);

  const loan = await loanOf(t, loanId);
  expect(loan).toMatchObject({
    toolId: drillId,
    toolName: "Cordless drill",
    borrowerId: bobId,
    lenderId: aliceId,
    ...dates,
    status: "pending",
  });
  // convex-test advances its clock by a millisecond per transaction.
  expect(loan!.createdAt).toBe(loan!.updatedAt);
  expect(loan!.createdAt - NOW).toBeLessThan(100);

  const jobs = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
  expect(jobs).toHaveLength(1);
  expect(jobs[0]).toMatchObject({ args: [{ loanId, event: "requested", actorId: bobId }], state: { kind: "pending" } });
  expect(jobs[0].name).toContain("sendLoanEvent");
});

test("request rejects own tool, bad dates, end before start, past end date, and an unavailable tool", async () => {
  const { t, asAlice, asBob, asCarol, drillId } = await setup();

  await expect(t.mutation(api.loans.request, { toolId: drillId, ...dates })).rejects.toThrow("Sign in required");
  await expect(requestDrill(asAlice, drillId)).rejects.toThrow("You can't borrow your own tool");
  for (const endDate of ["2026-13-01", "2026-02-30", "11/05/2026", ""]) {
    await expect(requestDrill(asBob, drillId, { endDate })).rejects.toThrow("Dates must be YYYY-MM-DD");
  }
  await expect(requestDrill(asBob, drillId, { startDate: "2026-11-5" })).rejects.toThrow("Dates must be YYYY-MM-DD");
  await expect(requestDrill(asBob, drillId, { startDate: "2026-11-06" })).rejects.toThrow(
    "End date must be on or after start date",
  );
  await expect(requestDrill(asBob, drillId, { startDate: "2026-10-28", endDate: "2026-11-01" })).rejects.toThrow(
    "End date can't be in the past",
  );

  const carolLoan = await requestDrill(asCarol, drillId);
  await asAlice.mutation(api.loans.approve, { loanId: carolLoan });
  await expect(requestDrill(asBob, drillId)).rejects.toThrow("Tool is already on loan");

  // A one-day loan ending today is fine; a removed tool is Not found.
  const rakeId = await asAlice.mutation(api.tools.create, rake);
  await requestDrill(asBob, rakeId, { startDate: "2026-11-02", endDate: "2026-11-02" });
  await asAlice.mutation(api.tools.remove, { toolId: rakeId });
  await expect(requestDrill(asBob, rakeId)).rejects.toThrow("Not found");
});

test("request rejects a second pending request for the same tool by the same borrower", async () => {
  const { asBob, asCarol, drillId } = await setup();

  const first = await requestDrill(asBob, drillId);
  await expect(requestDrill(asBob, drillId, { endDate: "2026-11-09" })).rejects.toThrow(
    "You already have a pending request for this tool",
  );
  await requestDrill(asCarol, drillId);

  await asBob.mutation(api.loans.cancel, { loanId: first });
  await requestDrill(asBob, drillId);
});

test("only the lender can approve or decline; borrower and stranger get Forbidden", async () => {
  const { t, asAlice, aliceId, asBob, bobId, asCarol, asAdmin, drillId } = await setup();
  const declined = await requestDrill(asBob, drillId);

  for (const as of [asBob, asCarol, asAdmin]) {
    await expect(as.mutation(api.loans.approve, { loanId: declined })).rejects.toThrow("Forbidden");
    await expect(as.mutation(api.loans.decline, { loanId: declined })).rejects.toThrow("Forbidden");
  }
  vi.setSystemTime(NOW + 60_000);
  expect(await asAlice.mutation(api.loans.decline, { loanId: declined })).toBeNull();
  const after = await loanOf(t, declined);
  expect(after).toMatchObject({ status: "declined" });
  expect(after!.updatedAt).toBeGreaterThanOrEqual(NOW + 60_000);

  const approved = await requestDrill(asBob, drillId);
  expect(await asAlice.mutation(api.loans.approve, { loanId: approved })).toBeNull();
  expect(await loanOf(t, approved)).toMatchObject({ status: "approved" });

  expect((await scheduledEvents(t)).slice(-3)).toEqual([
    { loanId: declined, event: "declined", actorId: aliceId },
    { loanId: approved, event: "requested", actorId: bobId },
    { loanId: approved, event: "approved", actorId: aliceId },
  ]);
});

test("only the borrower can cancel", async () => {
  const { t, asAlice, asBob, bobId, asCarol, drillId } = await setup();
  const loanId = await requestDrill(asBob, drillId);

  await expect(asAlice.mutation(api.loans.cancel, { loanId })).rejects.toThrow("Forbidden");
  await expect(asCarol.mutation(api.loans.cancel, { loanId })).rejects.toThrow("Forbidden");
  expect(await asBob.mutation(api.loans.cancel, { loanId })).toBeNull();

  expect(await loanOf(t, loanId)).toMatchObject({ status: "cancelled" });
  expect((await scheduledEvents(t)).at(-1)).toEqual({ loanId, event: "cancelled", actorId: bobId });
});

test("lender or borrower can mark returned; stranger cannot", async () => {
  const { t, asAlice, aliceId, asBob, bobId, asCarol, drillId } = await setup();

  const first = await requestDrill(asBob, drillId);
  await asAlice.mutation(api.loans.approve, { loanId: first });
  await expect(asCarol.mutation(api.loans.markReturned, { loanId: first })).rejects.toThrow("Forbidden");
  expect(await asBob.mutation(api.loans.markReturned, { loanId: first })).toBeNull();
  expect(await loanOf(t, first)).toMatchObject({ status: "returned" });
  expect((await scheduledEvents(t)).at(-1)).toEqual({ loanId: first, event: "returned", actorId: bobId });

  const second = await requestDrill(asBob, drillId);
  await asAlice.mutation(api.loans.approve, { loanId: second });
  expect(await asAlice.mutation(api.loans.markReturned, { loanId: second })).toBeNull();
  expect(await loanOf(t, second)).toMatchObject({ status: "returned" });
  expect((await scheduledEvents(t)).at(-1)).toEqual({ loanId: second, event: "returned", actorId: aliceId });
});

test("state transitions are enforced", async () => {
  const { asAlice, asBob, drillId } = await setup();

  const declined = await requestDrill(asBob, drillId);
  await asAlice.mutation(api.loans.decline, { loanId: declined });
  await expect(asAlice.mutation(api.loans.approve, { loanId: declined })).rejects.toThrow(
    "Request is no longer pending",
  );
  await expect(asAlice.mutation(api.loans.decline, { loanId: declined })).rejects.toThrow(
    "Request is no longer pending",
  );
  await expect(asBob.mutation(api.loans.cancel, { loanId: declined })).rejects.toThrow("Request is no longer pending");
  await expect(asBob.mutation(api.loans.markReturned, { loanId: declined })).rejects.toThrow("Loan is not active");

  const pending = await requestDrill(asBob, drillId);
  await expect(asAlice.mutation(api.loans.markReturned, { loanId: pending })).rejects.toThrow("Loan is not active");

  await asAlice.mutation(api.loans.approve, { loanId: pending });
  await asBob.mutation(api.loans.markReturned, { loanId: pending });
  await expect(asBob.mutation(api.loans.markReturned, { loanId: pending })).rejects.toThrow("Loan is not active");
  await expect(asBob.mutation(api.loans.cancel, { loanId: pending })).rejects.toThrow("Request is no longer pending");
});

test("approve makes the tool unavailable and listPublic hides it; return makes it available again", async () => {
  const { t, asAlice, asBob, asCarol, drillId } = await setup();
  const bobLoan = await requestDrill(asBob, drillId);
  const carolLoan = await requestDrill(asCarol, drillId);
  const publicNames = async () => (await t.query(api.tools.listPublic, {})).map((tool) => tool.name);

  expect(await publicNames()).toEqual(["Cordless drill"]);
  await asAlice.mutation(api.loans.approve, { loanId: bobLoan });
  expect(await publicNames()).toEqual([]);
  expect(await asCarol.query(api.tools.list, {})).toMatchObject([{ _id: drillId, available: false }]);
  await expect(asAlice.mutation(api.loans.approve, { loanId: carolLoan })).rejects.toThrow("Tool is already on loan");

  await asBob.mutation(api.loans.markReturned, { loanId: bobLoan });
  expect(await publicNames()).toEqual(["Cordless drill"]);
  await asAlice.mutation(api.loans.approve, { loanId: carolLoan });
});

test("mine and incoming return the right loans with names, overdue flag and activity", async () => {
  const { t, asAlice, asBob, drillId } = await setup();
  const rakeId = await asAlice.mutation(api.tools.create, rake);
  const pendingId = await requestDrill(asBob, drillId);
  const activeId = await requestDrill(asBob, rakeId, { startDate: "2026-11-02", endDate: "2026-11-04" });
  await asAlice.mutation(api.loans.approve, { loanId: activeId });
  await t.run(async (ctx) => {
    for (let i = 1; i <= 6; i++) {
      await ctx.db.insert("automationEvents", {
        loanId: activeId,
        kind: "notification",
        idempotencyKey: `test:${i}`,
        message: `Event ${i}`,
        createdAt: NOW + i,
      });
    }
  });

  const mine = await asBob.query(api.loans.mine, {});
  expect(mine.map((loan) => loan._id)).toEqual([activeId, pendingId]);
  expect(mine[0]).toMatchObject({ borrowerName: "Bob", lenderName: "Alice", status: "approved", isOverdue: false });
  expect(mine[0].activity.map((event) => event.message)).toEqual(["Event 6", "Event 5", "Event 4", "Event 3", "Event 2"]);
  expect(mine[0].activity[0]).toEqual({ kind: "notification", message: "Event 6", createdAt: NOW + 6 });
  expect(mine[1]).toMatchObject({ toolName: "Cordless drill", isOverdue: false, activity: [] });

  expect(await asAlice.query(api.loans.incoming, {})).toEqual(mine);
  expect(await asAlice.query(api.loans.mine, {})).toEqual([]);
  expect(await asBob.query(api.loans.incoming, {})).toEqual([]);
  await expect(t.query(api.loans.mine, {})).rejects.toThrow("Sign in required");

  vi.setSystemTime(Date.parse("2026-11-05T12:00:00Z"));
  expect((await asBob.query(api.loans.mine, {}))[0]).toMatchObject({ _id: activeId, isOverdue: true });
});

test("approve refuses a request whose end date has passed; decline still works", async () => {
  const { t, asAlice, asBob, asCarol, drillId } = await setup();
  const bobLoan = await requestDrill(asBob, drillId);
  const carolLoan = await requestDrill(asCarol, drillId);
  await asAlice.mutation(api.loans.approve, { loanId: bobLoan });

  // Carol's request waits behind Bob's loan until after its own end date (2026-11-05).
  vi.setSystemTime(Date.parse("2026-11-06T12:00:00Z"));
  await asBob.mutation(api.loans.markReturned, { loanId: bobLoan });
  await expect(asAlice.mutation(api.loans.approve, { loanId: carolLoan })).rejects.toThrow(
    "This request's dates have passed",
  );
  await asAlice.mutation(api.loans.decline, { loanId: carolLoan });
  expect(await loanOf(t, carolLoan)).toMatchObject({ status: "declined" });
});

test("an owner can't remove a tool on loan; removing cancels pending requests", async () => {
  const { t, asAlice, asBob, asCarol, asAdmin, adminId, drillId } = await setup();
  const returnedId = await requestDrill(asBob, drillId);
  await asAlice.mutation(api.loans.approve, { loanId: returnedId });

  await expect(asAlice.mutation(api.tools.remove, { toolId: drillId })).rejects.toThrow(
    "Tool is on loan; mark it returned first",
  );

  await asBob.mutation(api.loans.markReturned, { loanId: returnedId });
  const pendingId = await requestDrill(asCarol, drillId);
  expect(await asAdmin.mutation(api.tools.remove, { toolId: drillId })).toBeNull();

  expect(await t.run((ctx) => ctx.db.get("tools", drillId))).toBeNull();
  expect(await loanOf(t, pendingId)).toMatchObject({ status: "cancelled" });
  expect(await loanOf(t, returnedId)).toMatchObject({ status: "returned", toolName: "Cordless drill" });
  expect((await scheduledEvents(t)).at(-1)).toEqual({ loanId: pendingId, event: "cancelled", actorId: adminId });
});

test("an admin can remove a tool on loan, which cancels the loan and notifies the borrower", async () => {
  const { t, asAlice, asBob, asAdmin, adminId, drillId } = await setup();
  const loanId = await requestDrill(asBob, drillId);
  await asAlice.mutation(api.loans.approve, { loanId });

  expect(await asAdmin.mutation(api.tools.remove, { toolId: drillId })).toBeNull();

  expect(await t.run((ctx) => ctx.db.get("tools", drillId))).toBeNull();
  expect(await loanOf(t, loanId)).toMatchObject({ status: "cancelled" });
  expect((await scheduledEvents(t)).at(-1)).toEqual({ loanId, event: "cancelled", actorId: adminId });
  const event = await t.query(internal.n8n.loadLoanEvent, { loanId, event: "cancelled", actorId: adminId });
  expect(event?.recipient.name).toBe("Bob");
});
