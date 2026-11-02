"use client";

import { useMutation, useQuery } from "convex/react";
import { ActionButton } from "@/components/action-button";
import { LoanList } from "@/components/loan-list";
import { api } from "@/convex/_generated/api";

export default function IncomingPage() {
  const me = useQuery(api.users.current);
  const loans = useQuery(api.loans.incoming, me ? {} : "skip");
  const approve = useMutation(api.loans.approve);
  const decline = useMutation(api.loans.decline);
  const markReturned = useMutation(api.loans.markReturned);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Incoming requests</h1>
      <LoanList
        loans={loans}
        empty="No one has asked to borrow your tools yet."
        actions={(loan) =>
          loan.status === "pending" ? (
            <>
              <ActionButton label="Approve" primary onClick={() => approve({ loanId: loan._id })} />
              <ActionButton label="Decline" onClick={() => decline({ loanId: loan._id })} />
            </>
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
