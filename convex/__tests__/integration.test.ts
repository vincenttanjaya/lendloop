import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { internal } from "../_generated/api";
import type { LoanStatus } from "../constants";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, sign, verify } from "../lib/signature";
import { newTest } from "./test.setup";

type TestConvex = ReturnType<typeof newTest>;

const SECRET = "test-secret";
const WEBHOOK_URL = "http://n8n.test/webhook/lendloop/loan-event";
const asOf = "2026-11-02";
const NOW = Date.parse(`${asOf}T12:00:00Z`);

beforeEach(() => {
  // Fake timers pin "today" and keep scheduled retries from running in the background.
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("LENDLOOP_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("N8N_LOAN_EVENT_WEBHOOK_URL", WEBHOOK_URL);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function seedOverdue(t: TestConvex) {
  return await t.run(async (ctx) => {
    const user = (clerkId: string, name: string) =>
      ctx.db.insert("users", { clerkId, name, role: "user", trustedLender: false });
    const lenderId = await user("user_alice", "Alice");
    const borrowerId = await user("user_bob", "Bob");
    const loan = async (toolName: string, status: LoanStatus, endDate: string) => {
      const toolId = await ctx.db.insert("tools", {
        ownerId: lenderId,
        name: toolName,
        category: "power tools",
        condition: "good",
        description: "",
      });
      return await ctx.db.insert("loans", {
        toolId,
        toolName,
        borrowerId,
        lenderId,
        startDate: "2026-10-25",
        endDate,
        status,
        createdAt: NOW,
        updatedAt: NOW,
      });
    };
    return {
      lenderId,
      borrowerId,
      overdueId: await loan("Cordless drill", "approved", "2026-10-31"),
      pendingId: await loan("Leaf rake", "pending", "2026-10-30"),
      dueTodayId: await loan("Camping tent", "approved", asOf),
    };
  });
}

async function signedFetch(t: TestConvex, path: string, body?: string, secret = SECRET) {
  const timestamp = String(Date.now());
  return await t.fetch(path, {
    method: body === undefined ? "GET" : "POST",
    body,
    headers: { [TIMESTAMP_HEADER]: timestamp, [SIGNATURE_HEADER]: await sign(secret, timestamp, body ?? "") },
  });
}

const reminder = (loanId: string, reminderDate = asOf) =>
  JSON.stringify({ loanId, reminderDate, status: "sent", channel: "log" });

const automationEvents = (t: TestConvex) => t.run((ctx) => ctx.db.query("automationEvents").collect());

test("sign/verify round-trips and verify rejects mismatch, stale and missing headers", async () => {
  // Pinned vector (Node: createHmac("sha256", "test-secret").update(`${ts}.${body}`)) keeps n8n interoperable.
  expect(await sign(SECRET, String(NOW), '{"hello":"world"}')).toBe(
    "sha256=8cbea6a3b6951ae4f3f74c8ec9b4134422f46b82f0b3c842e852f1801b22587f",
  );

  const ts = String(NOW);
  const signature = await sign(SECRET, ts, "body");
  expect(await verify(SECRET, ts, signature, "body", NOW)).toEqual({ ok: true });
  expect(await verify(SECRET, ts, signature, "body", NOW + 300_000)).toEqual({ ok: true });

  expect(await verify(SECRET, ts, signature, "body!", NOW)).toEqual({ ok: false, reason: "mismatch" });
  expect(await verify("other-secret", ts, signature, "body", NOW)).toEqual({ ok: false, reason: "mismatch" });
  expect(await verify(SECRET, ts, "sha256=00", "body", NOW)).toEqual({ ok: false, reason: "mismatch" });
  expect(await verify(SECRET, ts, signature, "body", NOW + 300_001)).toEqual({ ok: false, reason: "stale" });
  expect(await verify(SECRET, ts, signature, "body", NOW - 300_001)).toEqual({ ok: false, reason: "stale" });
  expect(await verify(SECRET, "soon", signature, "body", NOW)).toEqual({ ok: false, reason: "stale" });
  expect(await verify(SECRET, null, signature, "body", NOW)).toEqual({ ok: false, reason: "missing" });
  expect(await verify(SECRET, ts, null, "body", NOW)).toEqual({ ok: false, reason: "missing" });
});

test("GET /api/overdue rejects unsigned and wrongly signed requests with 401", async () => {
  const t = newTest();
  await seedOverdue(t);

  for (const res of [await t.fetch("/api/overdue"), await signedFetch(t, "/api/overdue", undefined, "wrong-secret")]) {
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid signature" });
  }
});

test("GET /api/overdue returns only overdue approved loans with exactly the minimal fields", async () => {
  const t = newTest();
  const { overdueId } = await seedOverdue(t);

  const res = await signedFetch(t, "/api/overdue");
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("application/json");
  const body = await res.json();
  expect(body).toEqual({
    asOf,
    loans: [
      {
        loanId: overdueId,
        toolName: "Cordless drill",
        endDate: "2026-10-31",
        daysOverdue: 2,
        borrower: { clerkId: "user_bob", name: "Bob" },
      },
    ],
  });
  expect(Object.keys(body.loans[0]).sort()).toEqual(["borrower", "daysOverdue", "endDate", "loanId", "toolName"]);
  expect(Object.keys(body.loans[0].borrower).sort()).toEqual(["clerkId", "name"]);
});

test("GET /api/overdue omits loans already reminded for asOf", async () => {
  const t = newTest();
  const { overdueId } = await seedOverdue(t);

  // A reminder from a previous day does not count.
  await signedFetch(t, "/api/reminders", reminder(overdueId, "2026-11-01"));
  expect((await (await signedFetch(t, "/api/overdue")).json()).loans).toHaveLength(1);

  await signedFetch(t, "/api/reminders", reminder(overdueId));
  expect((await (await signedFetch(t, "/api/overdue")).json()).loans).toEqual([]);
});

test("POST /api/reminders is idempotent per loan and day", async () => {
  const t = newTest();
  const { overdueId } = await seedOverdue(t);

  const first = await signedFetch(t, "/api/reminders", reminder(overdueId));
  expect(first.status).toBe(200);
  expect(first.headers.get("content-type")).toBe("application/json");
  expect(await first.json()).toEqual({ ok: true, duplicate: false });

  const second = await signedFetch(t, "/api/reminders", reminder(overdueId));
  expect(await second.json()).toEqual({ ok: true, duplicate: true });

  expect(await automationEvents(t)).toMatchObject([
    {
      loanId: overdueId,
      kind: "reminder",
      idempotencyKey: `reminder:${overdueId}:${asOf}`,
      message: "Reminder sent via log",
    },
  ]);
});

test("POST /api/reminders rejects a malformed body with 400 and an unknown loan with 404", async () => {
  const t = newTest();
  const { overdueId, pendingId: deletedLoanId, lenderId } = await seedOverdue(t);
  await t.run((ctx) => ctx.db.delete("loans", deletedLoanId));

  // The signature covers the exact body: a tampered body is a 401, not a 400.
  const timestamp = String(Date.now());
  const tampered = await t.fetch("/api/reminders", {
    method: "POST",
    body: reminder(overdueId),
    headers: { [TIMESTAMP_HEADER]: timestamp, [SIGNATURE_HEADER]: await sign(SECRET, timestamp, "{}") },
  });
  expect(tampered.status).toBe(401);

  const valid = { loanId: overdueId, reminderDate: asOf, status: "sent", channel: "log" };
  for (const body of [
    "not json",
    "null",
    JSON.stringify({ ...valid, reminderDate: "2026-13-01" }),
    JSON.stringify({ ...valid, status: "maybe" }),
    JSON.stringify({ ...valid, channel: 7 }),
    JSON.stringify({ ...valid, loanId: undefined }),
  ]) {
    const res = await signedFetch(t, "/api/reminders", body);
    expect(res.status, body).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid body" });
  }

  for (const loanId of ["nope", lenderId, deletedLoanId]) {
    const res = await signedFetch(t, "/api/reminders", reminder(loanId));
    expect(res.status, loanId).toBe(404);
    expect(await res.json()).toEqual({ error: "unknown loan" });
  }
  expect(await automationEvents(t)).toEqual([]);
});

test("sendLoanEvent posts a signed, minimal payload and records a notification", async () => {
  const t = newTest();
  const { overdueId, lenderId } = await seedOverdue(t);
  const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);

  const args = { loanId: overdueId, event: "approved", actorId: lenderId } as const;
  expect(await t.action(internal.n8n.sendLoanEvent, args)).toBeNull();

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init = {}] = fetchMock.mock.calls[0];
  expect(url).toBe(WEBHOOK_URL);
  expect(init.method).toBe("POST");
  const body = init.body as string;
  const payload = JSON.parse(body);
  expect(Object.keys(payload).sort()).toEqual([
    "actorName",
    "endDate",
    "event",
    "eventId",
    "loanId",
    "recipient",
    "startDate",
    "toolName",
  ]);
  const eventId = `${overdueId}:approved:${NOW}`;
  expect(payload).toEqual({
    eventId,
    event: "approved",
    loanId: overdueId,
    toolName: "Cordless drill",
    startDate: "2026-10-25",
    endDate: "2026-10-31",
    recipient: { clerkId: "user_bob", name: "Bob" },
    actorName: "Alice",
  });
  const headers = new Headers(init.headers);
  expect(headers.get("content-type")).toBe("application/json");
  expect(await verify(SECRET, headers.get(TIMESTAMP_HEADER), headers.get(SIGNATURE_HEADER), body)).toEqual({
    ok: true,
  });

  // A redelivery of the same event does not record a second notification.
  await t.action(internal.n8n.sendLoanEvent, args);
  expect(await automationEvents(t)).toMatchObject([
    { loanId: overdueId, kind: "notification", idempotencyKey: `notify:${eventId}`, message: "Notified Bob (approved)" },
  ]);
});

test("loadLoanEvent picks the recipient for each event", async () => {
  const t = newTest();
  const { overdueId: loanId, lenderId, borrowerId } = await seedOverdue(t);
  const recipientOf = async (event: "requested" | "approved" | "declined" | "cancelled" | "returned", actorId = lenderId) =>
    (await t.query(internal.n8n.loadLoanEvent, { loanId, event, actorId }))?.recipient.name;

  expect(await recipientOf("requested", borrowerId)).toBe("Alice");
  expect(await recipientOf("cancelled", borrowerId)).toBe("Alice");
  expect(await recipientOf("approved")).toBe("Bob");
  expect(await recipientOf("declined")).toBe("Bob");
  expect(await recipientOf("returned", lenderId)).toBe("Bob");
  expect(await recipientOf("returned", borrowerId)).toBe("Alice");
});

test("sendLoanEvent schedules a retry on failure and throws after the third attempt", async () => {
  const t = newTest();
  const { overdueId, lenderId } = await seedOverdue(t);
  const args = { loanId: overdueId, event: "approved", actorId: lenderId } as const;
  const scheduled = () => t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());

  vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
  await t.action(internal.n8n.sendLoanEvent, args);
  expect(await scheduled()).toMatchObject([{ args: [{ ...args, attempt: 2 }], scheduledTime: NOW + 5_000 }]);

  vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("connection refused"))));
  await t.action(internal.n8n.sendLoanEvent, { ...args, attempt: 2 });
  expect((await scheduled())[1]).toMatchObject({ args: [{ ...args, attempt: 3 }], scheduledTime: NOW + 30_000 });

  await expect(t.action(internal.n8n.sendLoanEvent, { ...args, attempt: 3 })).rejects.toThrow(
    /after 3 attempts: connection refused/,
  );
  expect(await scheduled()).toHaveLength(2);
  expect(await automationEvents(t)).toEqual([]);
});

test("sendLoanEvent is a no-op with a warning when the webhook URL is unset", async () => {
  const t = newTest();
  const { overdueId, lenderId } = await seedOverdue(t);
  vi.stubEnv("N8N_LOAN_EVENT_WEBHOOK_URL", "");
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

  expect(await t.action(internal.n8n.sendLoanEvent, { loanId: overdueId, event: "approved", actorId: lenderId })).toBeNull();
  expect(warn).toHaveBeenCalledWith("n8n webhook URL not configured; skipping", `${overdueId}:approved:${NOW}`);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(await automationEvents(t)).toEqual([]);
});

test("sendLoanEvent fails loudly when the secret is unset", async () => {
  const t = newTest();
  const { overdueId, lenderId } = await seedOverdue(t);
  vi.stubEnv("LENDLOOP_WEBHOOK_SECRET", "");

  await expect(
    t.action(internal.n8n.sendLoanEvent, { loanId: overdueId, event: "approved", actorId: lenderId }),
  ).rejects.toThrow("LENDLOOP_WEBHOOK_SECRET is not set");
});
