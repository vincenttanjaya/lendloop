/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as admin from "../admin.js";
import type * as constants from "../constants.js";
import type * as http from "../http.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_dates from "../lib/dates.js";
import type * as lib_events from "../lib/events.js";
import type * as lib_signature from "../lib/signature.js";
import type * as loans from "../loans.js";
import type * as n8n from "../n8n.js";
import type * as reminders from "../reminders.js";
import type * as seed from "../seed.js";
import type * as tools from "../tools.js";
import type * as users from "../users.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  constants: typeof constants;
  http: typeof http;
  "lib/auth": typeof lib_auth;
  "lib/dates": typeof lib_dates;
  "lib/events": typeof lib_events;
  "lib/signature": typeof lib_signature;
  loans: typeof loans;
  n8n: typeof n8n;
  reminders: typeof reminders;
  seed: typeof seed;
  tools: typeof tools;
  users: typeof users;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
