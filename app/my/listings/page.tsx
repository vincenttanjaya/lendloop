"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { ActionButton } from "@/components/action-button";
import { ToolForm } from "@/components/tool-form";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { card, secondaryButton } from "@/lib/ui";

export default function MyListingsPage() {
  const me = useQuery(api.users.current);
  const tools = useQuery(api.tools.mine, me ? {} : "skip");
  const create = useMutation(api.tools.create);
  const update = useMutation(api.tools.update);
  const remove = useMutation(api.tools.remove);
  const [editing, setEditing] = useState<Id<"tools"> | null>(null);

  return (
    <div className="space-y-8">
      <section className={`${card} space-y-3`}>
        <h1 className="text-2xl font-semibold">List a tool</h1>
        <ToolForm submitLabel="List tool" onSubmit={(fields) => create(fields)} />
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">My listings</h2>
        {tools === undefined ? (
          <p className="text-zinc-500">Loading…</p>
        ) : tools.length === 0 ? (
          <p className="text-zinc-500">You haven’t listed any tools yet.</p>
        ) : (
          <ul className="space-y-3">
            {tools.map((tool) => (
              <li key={tool._id} className={card}>
                {editing === tool._id ? (
                  <ToolForm
                    initial={tool}
                    submitLabel="Save"
                    onSubmit={async (fields) => {
                      await update({ toolId: tool._id, ...fields });
                      setEditing(null);
                    }}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="font-medium">{tool.name}</p>
                      <p className="text-sm text-zinc-500">
                        <span className="capitalize">{tool.category}</span> · condition: {tool.condition}
                      </p>
                      {tool.description && <p className="text-sm">{tool.description}</p>}
                    </div>
                    <div className="flex items-start gap-2">
                      <button type="button" className={secondaryButton} onClick={() => setEditing(tool._id)}>
                        Edit
                      </button>
                      <ActionButton
                        label="Delete"
                        confirmText={`Delete "${tool.name}"? Pending requests for it will be cancelled.`}
                        onClick={() => remove({ toolId: tool._id })}
                      />
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
