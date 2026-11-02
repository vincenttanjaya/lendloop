"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { ErrorText, useMutationError } from "@/components/error-text";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { CATEGORIES, type Category } from "@/convex/constants";
import { todayISO } from "@/convex/lib/dates";
import { card, field, pill, primaryButton } from "@/lib/ui";

export default function ToolsPage() {
  const me = useQuery(api.users.current);
  const [category, setCategory] = useState<Category | "">("");
  // Wait for the user row (created by EnsureUser) so the first query is not a "Sign in required".
  const tools = useQuery(api.tools.list, me ? { category: category || undefined } : "skip");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">All tools</h1>
        <label className="flex items-center gap-2 text-sm">
          Category
          <select className={field} value={category} onChange={(e) => setCategory(e.target.value as Category | "")}>
            <option value="">All</option>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>
      {tools === undefined ? (
        <p className="text-zinc-500">Loading…</p>
      ) : tools.length === 0 ? (
        <p className="text-zinc-500">{category ? "No tools in this category yet." : "No tools listed yet."}</p>
      ) : (
        <ul className="space-y-3">
          {tools.map((tool) => (
            <li key={tool._id} className={`${card} space-y-2`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{tool.name}</span>
                <span
                  className={`${pill} ${tool.available ? "bg-emerald-100 text-emerald-800" : "bg-zinc-100 text-zinc-600"}`}
                >
                  {tool.available ? "Available" : "On loan"}
                </span>
              </div>
              <p className="text-sm text-zinc-500">
                <span className="capitalize">{tool.category}</span> · condition: {tool.condition} · lent by{" "}
                {tool.isMine ? "you" : tool.ownerName}{" "}
                {tool.ownerTrusted && (
                  <span className={`${pill} bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200`}>Trusted Lender</span>
                )}
              </p>
              {tool.description && <p className="text-sm">{tool.description}</p>}
              {!tool.isMine && tool.available && <RequestForm toolId={tool._id} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RequestForm({ toolId }: { toolId: Id<"tools"> }) {
  const request = useMutation(api.loans.request);
  const { error, pending, run } = useMutationError();
  const [dates, setDates] = useState({ startDate: "", endDate: "" });
  const [sent, setSent] = useState(false);
  const today = todayISO(); // the server's own "today" (UTC)

  if (sent) return <p className="text-sm text-emerald-700">Request sent. Track it under My requests.</p>;
  return (
    <form
      className="flex flex-wrap items-end gap-2 border-t border-zinc-100 pt-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await run(() => request({ toolId, ...dates }))) setSent(true);
      }}
    >
      <label className="grid gap-1 text-xs text-zinc-600">
        From
        <input
          type="date"
          required
          min={today}
          className={field}
          value={dates.startDate}
          onChange={(e) => setDates((d) => ({ ...d, startDate: e.target.value }))}
        />
      </label>
      <label className="grid gap-1 text-xs text-zinc-600">
        To
        <input
          type="date"
          required
          min={dates.startDate || today}
          className={field}
          value={dates.endDate}
          onChange={(e) => setDates((d) => ({ ...d, endDate: e.target.value }))}
        />
      </label>
      <button type="submit" disabled={pending} className={primaryButton}>
        Request to borrow
      </button>
      <ErrorText error={error} />
    </form>
  );
}
