"use client";

import { useConvexAuth, useMutation } from "convex/react";
import { useEffect } from "react";
import { api } from "@/convex/_generated/api";

/** Creates or refreshes the caller's Convex user row (name, role) once Convex has their Clerk token. */
export function EnsureUser() {
  const { isAuthenticated } = useConvexAuth();
  const ensure = useMutation(api.users.ensure);
  useEffect(() => {
    if (isAuthenticated) ensure().catch((e: unknown) => console.error("users.ensure failed", e));
  }, [isAuthenticated, ensure]);
  return null;
}
