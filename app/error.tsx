"use client";

import { errorMessage } from "@/components/error-text";
import { secondaryButton } from "@/lib/ui";

// Catches a Convex query that throws (e.g. an admin whose access was just revoked) instead of a blank screen.
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="space-y-3">
      <p role="alert">{errorMessage(error)}</p>
      <button type="button" className={secondaryButton} onClick={() => retry()}>
        Try again
      </button>
    </div>
  );
}
