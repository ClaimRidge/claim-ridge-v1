"use client";

import { CheckCircle2, XCircle, Clock, Bot, UserCheck } from "lucide-react";

// Sender-side view of the insurer's answer on a pre-auth request, rendered as
// an expandable detail block in the provider/doctor history tables.
//
// The decision lives on pre_auth_requests.status (approved | denied, manual or
// auto). The reviewer's reason is in review_notes/reviewed_at (migration 019);
// AI auto-decisions are flagged by ai_decision_status (auto_approved |
// auto_denied), and a reviewer overriding an auto-decision leaves an
// override_notice (folded out of ai_rationale by the backend list endpoints).

export interface PreAuthDecisionFields {
  status: string;
  routing_status: string;
  insurer_name?: string | null;
  valid_until?: string | null;
  approved_procedures?: string[] | null;
  review_notes?: string | null;
  reviewed_at?: string | null;
  ai_decision_status?: string | null;
  ai_recommendation?: string | null;
  override_notice?: {
    at?: string;
    reason?: string | null;
    overridden_from?: string;
    overridden_to?: string;
  } | null;
}

function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  return new Date(value).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function PreAuthDecisionDetail({ row }: { row: PreAuthDecisionFields }) {
  const status = (row.status || "").toLowerCase();
  const decided = status === "approved" || status === "denied";
  const isAuto =
    row.ai_decision_status === "auto_approved" || row.ai_decision_status === "auto_denied";
  const insurer = row.insurer_name || "the insurer";
  const decidedAt = formatDate(row.reviewed_at) || formatDate(row.override_notice?.at);

  if (row.routing_status === "unrouted") {
    return (
      <div className="text-sm text-[#6b7280]">
        This request was sent to a payer outside the network — no decision is
        reported back here. Use the offline packet to follow up directly.
      </div>
    );
  }

  if (!decided) {
    return (
      <div className="flex items-center gap-2 text-sm text-[#6b7280]">
        <Clock className="h-4 w-4 text-[#9ca3af]" />
        {insurer} has not decided on this request yet — the decision and the
        reviewer&apos;s note will appear here.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm text-[#374151]">
        {status === "approved" ? (
          <CheckCircle2 className="h-4 w-4 text-[#16a34a] flex-shrink-0" />
        ) : (
          <XCircle className="h-4 w-4 text-red-500 flex-shrink-0" />
        )}
        <span>
          <strong className="capitalize">{status}</strong>{" "}
          {isAuto ? (
            <>
              automatically by {insurer}&apos;s AI advisor
              <Bot className="h-3.5 w-3.5 inline ml-1 text-[#9ca3af]" />
            </>
          ) : (
            <>by {insurer}&apos;s medical reviewer</>
          )}
          {decidedAt ? ` on ${decidedAt}` : ""}.
        </span>
      </div>

      {row.review_notes && (
        <div className="bg-white border border-[#e5e7eb] rounded-lg p-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-[#9ca3af] mb-1 flex items-center gap-1">
            <UserCheck className="h-3.5 w-3.5" /> Reviewer&apos;s note
          </p>
          <p className="text-sm text-[#374151] whitespace-pre-wrap">{row.review_notes}</p>
        </div>
      )}

      {row.override_notice && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-amber-700 mb-1">
            AI decision overridden
          </p>
          <p className="text-sm text-amber-800">
            The reviewer overrode the AI&apos;s{" "}
            {row.override_notice.overridden_from === "auto_approved"
              ? "auto-approval"
              : "auto-denial"}
            {row.override_notice.reason ? `: ${row.override_notice.reason}` : "."}
          </p>
        </div>
      )}

      {status === "approved" && (
        <div className="text-sm text-[#374151]">
          <span className="font-medium">Authorisation valid until:</span>{" "}
          {formatDate(row.valid_until) || "—"}
          {Array.isArray(row.approved_procedures) && row.approved_procedures.length > 0 && (
            <span className="ml-3">
              <span className="font-medium">Approved procedures:</span>{" "}
              {row.approved_procedures.map((p) => (
                <span
                  key={p}
                  className="inline-block font-mono text-xs bg-[#f0fdf4] text-[#15803d] border border-[#bbf7d0] px-1.5 py-0.5 rounded mr-1"
                >
                  {p}
                </span>
              ))}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
