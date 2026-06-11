"use client";

import { Claim } from "@/types/claim";
import {
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  Info,
  Landmark,
} from "lucide-react";

// Sender-side view of the payer's answer on a claim.
//
// Two decision vocabularies coexist on claims.status: AI adjudication writes
// accepted | denied | escalated (rationale in claims.adjudication), while a
// human Medical Officer writes approved | rejected | needs_info (reason in
// claims.review_notes). Whichever wrote last owns the status, so we read the
// detail from the vocabulary the current status belongs to.

type DecisionKind =
  | "approved"
  | "denied"
  | "in_review"
  | "needs_info"
  | "pending"
  | "unrouted";

interface DecisionMeta {
  kind: DecisionKind;
  label: string;
  badgeClass: string;
  Icon: typeof CheckCircle;
}

const DECISION_META: Record<DecisionKind, DecisionMeta> = {
  approved: {
    kind: "approved",
    label: "Approved",
    badgeClass: "bg-[#f0fdf4] text-[#16a34a] border-[#bbf7d0]",
    Icon: CheckCircle,
  },
  denied: {
    kind: "denied",
    label: "Denied",
    badgeClass: "bg-red-50 text-red-600 border-red-200",
    Icon: XCircle,
  },
  in_review: {
    kind: "in_review",
    label: "Under Review",
    badgeClass: "bg-amber-50 text-amber-600 border-amber-200",
    Icon: AlertTriangle,
  },
  needs_info: {
    kind: "needs_info",
    label: "Info Requested",
    badgeClass: "bg-blue-50 text-blue-600 border-blue-200",
    Icon: Info,
  },
  pending: {
    kind: "pending",
    label: "Awaiting Payer",
    badgeClass: "bg-[#f9fafb] text-[#6b7280] border-[#e5e7eb]",
    Icon: Clock,
  },
  unrouted: {
    kind: "unrouted",
    label: "Out of Network",
    badgeClass: "bg-[#f9fafb] text-[#6b7280] border-[#e5e7eb]",
    Icon: Landmark,
  },
};

export function payerDecisionMeta(
  status: string | null | undefined,
  routingStatus?: string | null
): DecisionMeta {
  if (routingStatus === "unrouted" || status === "unrouted")
    return DECISION_META.unrouted;
  switch (status) {
    case "approved":
    case "accepted":
      return DECISION_META.approved;
    case "denied":
    case "rejected":
      return DECISION_META.denied;
    case "escalated":
    case "under_review":
    case "pending":
      return DECISION_META.in_review;
    case "needs_info":
      return DECISION_META.needs_info;
    default:
      return DECISION_META.pending;
  }
}

export function PayerDecisionBadge({
  status,
  routingStatus,
}: {
  status: string | null | undefined;
  routingStatus?: string | null;
}) {
  const meta = payerDecisionMeta(status, routingStatus);
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${meta.badgeClass}`}
    >
      <meta.Icon className="h-3 w-3" />
      {meta.label}
    </span>
  );
}

const MANUAL_STATUSES = ["approved", "rejected", "needs_info"];
const AI_STATUSES = ["accepted", "denied", "escalated"];

function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  return new Date(value).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function PayerDecisionPanel({ claim }: { claim: Claim }) {
  const meta = payerDecisionMeta(claim.status, claim.routing_status);

  const isManual = MANUAL_STATUSES.includes(claim.status);
  const isAi = AI_STATUSES.includes(claim.status) && !!claim.adjudication;

  const decidedAt = isManual
    ? formatDate(claim.reviewed_at || claim.updated_at)
    : isAi
    ? formatDate(claim.adjudicated_at || claim.adjudication?.adjudicated_at)
    : null;

  const reason = isManual
    ? claim.review_notes
    : isAi
    ? claim.adjudication?.rationale
    : null;

  const evidence = isAi ? claim.adjudication?.evidence ?? [] : [];
  const policyBasis = isAi ? claim.adjudication?.policy_basis ?? [] : [];

  return (
    <div className="bg-white border border-[#e5e7eb] rounded-xl shadow-sm p-6 md:p-8 mb-6">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Landmark className="h-5 w-5 text-[#16a34a]" />
          <h3 className="font-display text-lg font-bold text-[#0a0a0a]">
            Payer Decision
          </h3>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium border ${meta.badgeClass}`}
        >
          <meta.Icon className="h-4 w-4" />
          {meta.label}
        </span>
      </div>

      {meta.kind === "pending" && (
        <p className="text-sm text-[#6b7280]">
          {claim.payer_name || "The payer"} has received this claim but has not
          reviewed it yet. The decision will appear here once it is made.
        </p>
      )}

      {meta.kind === "unrouted" && (
        <p className="text-sm text-[#6b7280]">
          This claim was submitted to a payer outside the ClaimRidge network, so
          no decision will be reported back here. Follow up with the payer
          directly.
        </p>
      )}

      {meta.kind !== "pending" && meta.kind !== "unrouted" && (
        <>
          <p className="text-sm text-[#6b7280] mb-3">
            {isManual
              ? `Decided by ${claim.payer_name || "the payer"}'s medical reviewer`
              : isAi
              ? `Decided by ${claim.payer_name || "the payer"}'s automated adjudication`
              : `Reported by ${claim.payer_name || "the payer"}`}
            {decidedAt ? ` on ${decidedAt}` : ""}.
          </p>

          {reason && (
            <div className="bg-[#f9fafb] border border-[#e5e7eb] rounded-lg p-4 mb-3">
              <p className="text-xs font-bold uppercase tracking-wider text-[#6b7280] mb-1">
                {meta.kind === "needs_info"
                  ? "What the payer needs"
                  : "Reason from the payer"}
              </p>
              <p className="text-sm text-[#374151] whitespace-pre-wrap">{reason}</p>
            </div>
          )}

          {evidence.length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-bold uppercase tracking-wider text-[#6b7280] mb-2">
                Findings
              </p>
              <ul className="space-y-1">
                {evidence.map((e, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-sm text-[#374151]"
                  >
                    <Info className="h-4 w-4 text-[#9ca3af] flex-shrink-0 mt-0.5" />
                    {e.finding}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {policyBasis.length > 0 && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-[#6b7280] mb-2">
                Policy Basis
              </p>
              <ul className="list-disc list-inside space-y-1 text-sm text-[#374151] ml-2">
                {policyBasis.map((rule, i) => (
                  <li key={i}>{rule}</li>
                ))}
              </ul>
            </div>
          )}

          {meta.kind === "in_review" && (
            <p className="text-xs text-[#9ca3af] mt-2">
              A human reviewer at the payer is taking a closer look — the final
              decision will appear here.
            </p>
          )}
        </>
      )}
    </div>
  );
}
