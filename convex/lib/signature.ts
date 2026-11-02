export const TIMESTAMP_HEADER = "X-LendLoop-Timestamp";
export const SIGNATURE_HEADER = "X-LendLoop-Signature";
export const MAX_SKEW_MS = 300_000;

const encoder = new TextEncoder();

/** "sha256=" + lowercase hex HMAC-SHA256(secret, `${timestamp}.${body}`). */
export async function sign(secret: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${body}`));
  return "sha256=" + Array.from(new Uint8Array(mac), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verify(
  secret: string,
  timestamp: string | null,
  signature: string | null,
  body: string,
  now: number = Date.now(),
): Promise<{ ok: true } | { ok: false; reason: "missing" | "stale" | "mismatch" }> {
  if (!timestamp || !signature) return { ok: false, reason: "missing" };
  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt) || Math.abs(now - sentAt) > MAX_SKEW_MS) return { ok: false, reason: "stale" };

  const expected = encoder.encode(await sign(secret, timestamp, body));
  const actual = encoder.encode(signature);
  if (expected.length !== actual.length) return { ok: false, reason: "mismatch" };
  // Constant-time: touch every byte regardless of where the first difference is.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ actual[i];
  return diff === 0 ? { ok: true } : { ok: false, reason: "mismatch" };
}
