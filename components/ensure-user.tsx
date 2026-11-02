"use client";

import { useAuth } from "@clerk/nextjs";
import { useConvexAuth, useMutation } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";

/**
 * Creates or refreshes the caller's Convex user row (name, role) once Convex has their Clerk token.
 * If Clerk says signed in but Convex never accepts the token (a missing or misnamed `convex` JWT template, or a
 * wrong CLERK_JWT_ISSUER_DOMAIN), every page would sit on "Loading…" with no hint, so say so instead.
 */
export function EnsureUser() {
  const { isSignedIn } = useAuth();
  const { isLoading, isAuthenticated } = useConvexAuth();
  const ensure = useMutation(api.users.ensure);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!isAuthenticated) return;
    ensure().then(
      () => setFailed(false),
      (e: unknown) => {
        console.error("users.ensure failed", e);
        setFailed(true);
      },
    );
  }, [isAuthenticated, ensure]);

  if (!failed && !(isSignedIn && !isLoading && !isAuthenticated)) return null;
  return (
    <div className="mx-auto max-w-3xl px-4 pt-4">
      <p role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-800">
        You’re signed in, but LendLoop couldn’t verify your session with its backend. Try reloading. If it keeps
        happening, check the Clerk <code>convex</code> JWT template and <code>CLERK_JWT_ISSUER_DOMAIN</code> (README,
        setup step 2).
      </p>
    </div>
  );
}
