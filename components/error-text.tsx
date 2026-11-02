"use client";

import { ConvexError } from "convex/values";
import { useState } from "react";

export function ErrorText({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-red-700">
      {error}
    </p>
  );
}

/** ConvexError carries our plain-English message; anything else is a bug or outage, so stay generic. */
export function errorMessage(e: unknown): string {
  return e instanceof ConvexError ? String(e.data) : "Something went wrong.";
}

/** Runs a mutation and keeps its failure as plain text for <ErrorText>; `run` resolves to true on success. */
export function useMutationError() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function run(fn: () => Promise<unknown>): Promise<boolean> {
    setError(null);
    setPending(true);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setPending(false);
    }
  }
  return { error, pending, run };
}
