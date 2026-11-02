"use client";

import { useState } from "react";
import { CATEGORIES, CONDITIONS, type Category, type Condition } from "@/convex/constants";
import type { Doc } from "@/convex/_generated/dataModel";
import { field, primaryButton, secondaryButton } from "@/lib/ui";
import { ErrorText, useMutationError } from "./error-text";

type ToolFields =Pick<Doc<"tools">, "name" | "category" | "condition" | "description">;

const BLANK: ToolFields = { name: "", category: "power tools", condition: "good", description: "" };

/** Create form when `initial` is absent (clears itself after saving), edit form when present. */
export function ToolForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: ToolFields;
  submitLabel: string;
  onSubmit: (fields: ToolFields) => Promise<unknown>;
  onCancel?: () => void;
}) {
  // Copy only the editable fields: `initial` may be a whole tool doc, and its _id/ownerId must not reach the mutation.
  const [fields, setFields] = useState<ToolFields>(() => {
    const { name, category, condition, description } = initial ?? BLANK;
    return { name, category, condition, description };
  });
  const { error, pending, run } = useMutationError();
  const set = (patch: Partial<ToolFields>) => setFields((f) => ({ ...f, ...patch }));

  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if ((await run(() => onSubmit(fields))) && !initial) setFields(BLANK);
      }}
    >
      <label className="grid gap-1 text-sm sm:col-span-2">
        Name
        <input className={field} required maxLength={80} value={fields.name} onChange={(e) => set({ name: e.target.value })} />
      </label>
      <label className="grid gap-1 text-sm">
        Category
        <select className={field} value={fields.category} onChange={(e) => set({ category: e.target.value as Category })}>
          {CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        Condition
        <select className={field} value={fields.condition} onChange={(e) => set({ condition: e.target.value as Condition })}>
          {CONDITIONS.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm sm:col-span-2">
        Short description
        <textarea
          className={field}
          rows={2}
          maxLength={500}
          value={fields.description}
          onChange={(e) => set({ description: e.target.value })}
        />
      </label>
      <div className="flex items-center gap-2 sm:col-span-2">
        <button type="submit" disabled={pending} className={primaryButton}>
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={secondaryButton}>
            Cancel
          </button>
        )}
        <ErrorText error={error} />
      </div>
    </form>
  );
}
