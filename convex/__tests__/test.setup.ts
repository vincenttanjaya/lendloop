/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { vi } from "vitest";
import schema from "../schema";

export const modules = import.meta.glob("../**/*.ts");

export const alice = { subject: "user_alice", name: "Alice" };
export const bob = { subject: "user_bob", name: "Bob" };
export const admin = { subject: "user_admin", name: "Ada Admin" };

export function newTest() {
  vi.stubEnv("ADMIN_CLERK_IDS", "user_admin");
  return convexTest(schema, modules);
}
