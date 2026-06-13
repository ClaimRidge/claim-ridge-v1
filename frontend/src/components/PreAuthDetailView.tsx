"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ShieldCheck, FileText, ClipboardList, AlertCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import PreAuthRequestFields, { PreAuthRequestData } from "@/components/PreAuthRequestFields";
import DocumentViewer, { ViewerDocument } from "@/components/DocumentViewer";
import PreAuthDecisionDetail, { PreAuthDecisionFields } from "@/components/PreAuthDecisionDetail";

// Standalone "full request" page for a single pre-auth, shared by the provider
// and doctor portals. Fetches the sender-scoped detail endpoint once and shows
// the complete submitted packet, the uploaded documents (with inline preview),
// and the insurer's decision.

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "";

type FullRow = PreAuthRequestData & PreAuthDecisionFields & {
  id: string;
  reference_number?: string;
  priority?: string | null;
  created_at?: string;
};

function StatusChip({ status, routing }: { status?: string; routing?: string }) {
  if (routing === "unrouted") {
    return <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">Out-of-network</span>;
  }
  const s = (status || "").toLowerCase();
  const cls =
    s === "approve" || s === "approved" ? "bg-green-50 text-green-700 border-green-200"
    : s === "escalate" || s === "escalated" ? "bg-blue-50 text-blue-700 border-blue-200"
    : s === "deny" || s === "denied" || s === "rejected" ? "bg-red-50 text-red-700 border-red-200"
    : "bg-amber-50 text-amber-700 border-amber-200";
  return <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase border ${cls}`}>{status || "—"}</span>;
}

export default function PreAuthDetailView({ id, backHref }: { id: string; backHref: string }) {
  const supabase = createClient();
  const [row, setRow] = useState<FullRow | null>(null);
  const [docs, setDocs] = useState<ViewerDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { setError("Not signed in."); setLoading(false); return; }
        const res = await fetch(`${BACKEND}/api/dropoff/submission/${id}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) {
          setError(res.status === 403 ? "You don't have access to this submission." : "This submission could not be found.");
          setLoading(false);
          return;
        }
        const data = await res.json();
        setRow(data.request || null);
        setDocs(data.documents || []);
      } catch {
        setError("Could not load the submission.");
      }
      setLoading(false);
    })();
  }, [id, supabase]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 flex flex-col items-center">
        <div className="animate-spin h-8 w-8 border-4 border-[#16a34a] border-t-transparent rounded-full mb-3" />
        <p className="text-sm text-[#9ca3af]">Loading the submitted request…</p>
      </div>
    );
  }

  if (error || !row) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <AlertCircle className="h-10 w-10 text-amber-500 mx-auto mb-3" />
        <h1 className="font-display text-xl font-bold text-[#0a0a0a] mb-2">Submission unavailable</h1>
        <p className="text-[#6b7280] mb-6">{error || "No data."}</p>
        <Link href={backHref} className="text-sm font-semibold text-[#16a34a] hover:text-[#15803d]">
          ← Back to Pre-Auth History
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
      <div className="mb-6">
        <Link href={backHref} className="flex items-center gap-2 text-sm text-[#6b7280] hover:text-[#16a34a] font-medium w-fit">
          <ArrowLeft className="h-4 w-4" /> Back to Pre-Auth History
        </Link>
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="inline-flex items-center justify-center w-10 h-10 bg-[#f0fdf4] border border-[#bbf7d0] rounded-lg">
            <ShieldCheck className="h-5 w-5 text-[#16a34a]" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#0a0a0a] font-mono">
                {row.reference_number || "Pre-Authorisation"}
              </h1>
              <StatusChip status={row.status} routing={row.routing_status} />
            </div>
            <p className="text-[#9ca3af] text-sm mt-0.5">
              {row.patient_name ? <>Patient: {row.patient_name} · </> : null}
              {row.created_at ? `Submitted ${new Date(row.created_at).toLocaleDateString()}` : null}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT: full request + documents */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-[#16a34a] mb-3 flex items-center gap-1.5">
              <ClipboardList className="h-3.5 w-3.5" /> Submitted request
            </p>
            <PreAuthRequestFields request={row} />
          </div>

          <div className="bg-white border border-[#e5e7eb] rounded-xl shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-[#f3f4f6] flex items-center gap-2">
              <FileText className="h-4 w-4 text-[#16a34a]" />
              <h3 className="font-bold text-[#0a0a0a] text-sm">Uploaded documents ({docs.length})</h3>
            </div>
            <DocumentViewer documents={docs} />
          </div>
        </div>

        {/* RIGHT: insurer decision */}
        <div className="flex flex-col gap-6">
          <div className="bg-white border border-[#e5e7eb] rounded-xl shadow-sm p-5">
            <h3 className="font-display font-bold text-[#0a0a0a] mb-4">Insurer decision</h3>
            <PreAuthDecisionDetail row={row} />
          </div>
        </div>
      </div>
    </div>
  );
}
