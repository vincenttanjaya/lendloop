"use client";

import { useQuery } from "convex/react";
import type { ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { LoanView } from "@/convex/loans";
import { formatDate, relativeTime } from "@/lib/format";
import { card, pill } from "@/lib/ui";

const STATUS_STYLE: Record<LoanView["status"], string> = {
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  declined: "bg-zinc-100 text-zinc-600",
  cancelled: "bg-zinc-100 text-zinc-600",
  returned: "bg-zinc-100 text-zinc-600",
};

export function LoanList({
  loans,
  empty,
  actions,
}: {
  loans: LoanView[] | undefined;
  empty: string;
  actions?: (loan: LoanView) => ReactNode;
}) {
  const me = useQuery(api.users.current);
  if (loans === undefined) return <p className="text-zinc-500">Loading…</p>;
  if (loans.length === 0) return <p className="text-zinc-500">{empty}</p>;
  return (
    <ul className="space-y-3">
      {loans.map((loan) => (
        <li key={loan._id} className={`${card} space-y-2`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{loan.toolName}</span>
            <span className={`${pill} ${STATUS_STYLE[loan.status]} capitalize`}>{loan.status}</span>
            {loan.isOverdue && <span className={`${pill} bg-red-100 text-red-800`}>Overdue</span>}
          </div>
          <p className="text-sm text-zinc-600">
            {otherParty(loan, me?._id)} · {formatDate(loan.startDate)} – {formatDate(loan.endDate)}
          </p>
          {actions && <div className="flex flex-wrap items-start gap-2">{actions(loan)}</div>}
          {loan.activity.length > 0 && (
            <ul className="border-t border-zinc-100 pt-2 text-xs text-zinc-500">
              {loan.activity.map((event, i) => (
                <li key={i}>
                  {event.message} · {relativeTime(event.createdAt)}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

function otherParty(loan: LoanView, myId: Id<"users"> | undefined): string {
  if (loan.borrowerId === myId) return `From ${loan.lenderName}`;
  if (loan.lenderId === myId) return `Requested by ${loan.borrowerName}`;
  return `${loan.borrowerName} borrowing from ${loan.lenderName}`;
}
