import { httpRouter, type FunctionArgs } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { isISODate, todayISO } from "./lib/dates";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verify } from "./lib/signature";

const http = httpRouter();

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function isSigned(request: Request, rawBody: string): Promise<boolean> {
  const secret = process.env.LENDLOOP_WEBHOOK_SECRET;
  if (!secret) throw new Error("LENDLOOP_WEBHOOK_SECRET is not set");
  const timestamp = request.headers.get(TIMESTAMP_HEADER);
  const signature = request.headers.get(SIGNATURE_HEADER);
  return (await verify(secret, timestamp, signature, rawBody)).ok;
}

function parseReminder(rawBody: string): FunctionArgs<typeof internal.reminders.record> | null {
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null) return null;
  const { loanId, reminderDate, status, channel } = body as Record<string, unknown>;
  const valid =
    typeof loanId === "string" &&
    typeof reminderDate === "string" &&
    isISODate(reminderDate) &&
    (status === "sent" || status === "failed") &&
    typeof channel === "string";
  return valid ? { loanId, reminderDate, status, channel } : null;
}

http.route({
  path: "/api/overdue",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    if (!(await isSigned(request, ""))) return json(401, { error: "invalid signature" });
    const asOf = todayISO();
    return json(200, { asOf, loans: await ctx.runQuery(internal.reminders.overdue, { asOf }) });
  }),
});

http.route({
  path: "/api/reminders",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    // Read the body once and verify over exactly that string before parsing it.
    const rawBody = await request.text();
    if (!(await isSigned(request, rawBody))) return json(401, { error: "invalid signature" });
    const reminder = parseReminder(rawBody);
    if (!reminder) return json(400, { error: "invalid body" });
    const result = await ctx.runMutation(internal.reminders.record, reminder);
    if (!result) return json(404, { error: "unknown loan" });
    return json(200, { ok: true, duplicate: result.duplicate });
  }),
});

export default http;
