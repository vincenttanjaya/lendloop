"use client";

import { useMutation, useQuery } from "convex/react";
import { ActionButton } from "@/components/action-button";
import { LoanList } from "@/components/loan-list";
import { api } from "@/convex/_generated/api";

export default function MyRequestsPage() {
  const me = useQuery(api.users.current);
  const loans = useQuery(api.loans.mine, me ? {} : "skip");
  const cancel = useMutation(api.loans.cancel);
  const markReturned = useMutation(api.loans.markReturned);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">My requests</h1>
      <LoanList
        loans={loans}
        empty="You haven’t asked to borrow anything yet."
        actions={(loan) =>
          loan.status === "pending" ? (
            <ActionButton label="Cancel request" onClick={() => cancel({ loanId: loan._id })} />
          ) : loan.status === "approved" ? (
            <ActionButton
              label="Mark returned"
              primary
              confirmText="Mark this loan returned? This can't be undone."
              onClick={() => markReturned({ loanId: loan._id })}
            />
          ) : null
        }
      />
    </div>
  );
}
