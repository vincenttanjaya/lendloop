"use client";

import { useMutation, useQuery } from "convex/react";
import { ActionButton } from "@/components/action-button";
import { ErrorText, useMutationError } from "@/components/error-text";
import { LoanList } from "@/components/loan-list";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { card } from "@/lib/ui";

export default function AdminPage() {
  const me = useQuery(api.users.current);
  // Hides the page for non-admins; admin.* functions enforce the role themselves.
  const isAdmin = me?.role === "admin";
  const loans = useQuery(api.admin.allLoans, isAdmin ? {} : "skip");
  const tools = useQuery(api.admin.allTools, isAdmin ? {} : "skip");
  const users = useQuery(api.admin.users, isAdmin ? {} : "skip");
  const remove = useMutation(api.tools.remove);

  if (!me) return <p className="text-zinc-500">Loading…</p>;
  if (!isAdmin) return <p>Admin only.</p>;
  return (
    <div className="space-y-10">
      <h1 className="text-2xl font-semibold">Admin</h1>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">All loans</h2>
        <LoanList loans={loans} empty="No loans yet." />
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">All listings</h2>
        {tools === undefined ? (
          <p className="text-zinc-500">Loading…</p>
        ) : tools.length === 0 ? (
          <p className="text-zinc-500">No tools listed.</p>
        ) : (
          <ul className={`${card} divide-y divide-zinc-100 py-1`}>
            {tools.map((tool) => (
              <li key={tool._id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {tool.name} <span className="text-sm text-zinc-500">· {tool.category} · {tool.ownerName}</span>
                </span>
                <ActionButton
                  label="Remove"
                  confirmText={`Remove "${tool.name}"? Pending requests for it will be cancelled.`}
                  onClick={() => remove({ toolId: tool._id })}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Users</h2>
        {users === undefined ? (
          <p className="text-zinc-500">Loading…</p>
        ) : (
          <ul className={`${card} divide-y divide-zinc-100 py-1`}>
            {users.map((user) => (
              <li key={user._id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {user.name} {user.role === "admin" && <span className="text-xs text-zinc-500">(admin)</span>}
                </span>
                <TrustedToggle userId={user._id} trusted={user.trustedLender} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function TrustedToggle({ userId, trusted }: { userId: Id<"users">; trusted: boolean }) {
  const setTrustedLender = useMutation(api.admin.setTrustedLender);
  const { error, pending, run } = useMutationError();
  return (
    <span className="flex flex-col items-end gap-1">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={trusted}
          disabled={pending}
          onChange={(e) => void run(() => setTrustedLender({ userId, trusted: e.target.checked }))}
          className="accent-emerald-700"
        />
        Trusted Lender
      </label>
      <ErrorText error={error} />
    </span>
  );
}
