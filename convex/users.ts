import { mutation, query } from "./_generated/server";
import { getOrCreateUser, getUser } from "./lib/auth";

export const current = query({
  args: {},
  handler: (ctx) => getUser(ctx),
});

/** Called by the client after sign-in: creates the user row, or refreshes name and role. */
export const ensure = mutation({
  args: {},
  handler: async (ctx) => (await getOrCreateUser(ctx))._id,
});
