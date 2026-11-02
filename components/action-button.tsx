"use client";

import { primaryButton, secondaryButton } from "@/lib/ui";
import { ErrorText, useMutationError } from "./error-text";

/** One button that runs one mutation and shows its error right below it. */
export function ActionButton({
  label,
  onClick,
  confirmText,
  primary = false,
}: {
  label: string;
  onClick: () => Promise<unknown>;
  confirmText?: string;
  primary?: boolean;
}) {
  const { error, pending, run } = useMutationError();
  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        className={primary ? primaryButton : secondaryButton}
        onClick={() => {
          if (confirmText && !confirm(confirmText)) return;
          void run(onClick);
        }}
      >
        {label}
      </button>
      <ErrorText error={error} />
    </span>
  );
}
