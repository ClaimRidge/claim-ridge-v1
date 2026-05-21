"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Button from "@/components/ui/Button";
import { Download, Loader2, X, FileText, Sparkles, AlertCircle } from "lucide-react";

interface OfflinePacket {
  cover_letter?: string;
  clinical_summary?: string;
  structured_packet?: Record<string, unknown>;
  suggestions?: string[];
  completeness_score?: number;
}

interface Props {
  preAuthId: string;
  referenceNumber: string;
  onClose: () => void;
}

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "";

function packetToText(packet: OfflinePacket, ref: string, payer: string | null): string {
  const lines: string[] = [];
  lines.push(`Pre-Authorisation Request — ${ref}`);
  lines.push(`Payer: ${payer || "—"}`);
  lines.push("");
  if (packet.cover_letter) {
    lines.push("--- COVER LETTER ---");
    lines.push(packet.cover_letter);
    lines.push("");
  }
  if (packet.clinical_summary) {
    lines.push("--- CLINICAL SUMMARY ---");
    lines.push(packet.clinical_summary);
    lines.push("");
  }
  if (packet.structured_packet && Object.keys(packet.structured_packet).length > 0) {
    lines.push("--- STRUCTURED PACKET ---");
    for (const [k, v] of Object.entries(packet.structured_packet)) {
      lines.push(`${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export default function OfflinePacketPanel({ preAuthId, referenceNumber, onClose }: Props) {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [packet, setPacket] = useState<OfflinePacket | null>(null);
  const [payer, setPayer] = useState<string | null>(null);
  const [completeness, setCompleteness] = useState<number | null>(null);

  const fetchPacket = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError("Not signed in.");
        return;
      }
      const res = await fetch(`${BACKEND}/api/pre-auth/${preAuthId}/offline-packet`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail?.detail || "Failed to load the offline packet.");
      }
      const json = await res.json();
      setPacket(json.packet || null);
      setPayer(json.payer_name || null);
      setCompleteness(
        typeof json.completeness_score === "number" ? json.completeness_score : null
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load the offline packet.");
    } finally {
      setLoading(false);
    }
  }, [preAuthId, supabase]);

  useEffect(() => {
    fetchPacket();
  }, [fetchPacket]);

  const download = () => {
    if (!packet) return;
    const text = packetToText(packet, referenceNumber, payer);
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${referenceNumber}-offline-packet.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e5e7eb]">
          <div>
            <h2 className="font-display font-bold text-lg text-[#0a0a0a] flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[#00B4A6]" /> Offline submission packet
            </h2>
            <p className="text-xs text-[#6b7280] mt-0.5">
              {referenceNumber}{payer ? ` · for ${payer}` : ""} (out-of-network)
            </p>
          </div>
          <button onClick={onClose} className="text-[#9ca3af] hover:text-[#0a0a0a]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading && (
            <div className="flex flex-col items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-[#0A1628] mb-3" />
              <p className="text-sm text-[#6b7280]">Preparing your packet…</p>
            </div>
          )}
          {error && !loading && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5" />
              <div>
                <p className="font-bold">Could not load packet</p>
                <p className="text-red-600 mt-0.5">{error}</p>
              </div>
            </div>
          )}
          {!loading && !error && packet && (
            <div className="space-y-6">
              {completeness !== null && (
                <div className="flex items-center gap-3">
                  <p className="text-[11px] uppercase tracking-widest text-[#9ca3af] font-black">Completeness</p>
                  <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#00B4A6]"
                      style={{ width: `${Math.round(completeness * 100)}%` }}
                    />
                  </div>
                  <p className="text-xs font-mono text-[#374151]">{Math.round(completeness * 100)}%</p>
                </div>
              )}

              {packet.cover_letter && (
                <section>
                  <h3 className="text-[10px] uppercase tracking-[0.18em] text-[#0A1628] font-black mb-2 flex items-center gap-1.5">
                    <FileText className="h-3 w-3" /> Cover letter
                  </h3>
                  <p className="text-sm text-[#374151] leading-relaxed whitespace-pre-wrap bg-gray-50 p-3 rounded-lg border border-gray-100">
                    {packet.cover_letter}
                  </p>
                </section>
              )}

              {packet.clinical_summary && (
                <section>
                  <h3 className="text-[10px] uppercase tracking-[0.18em] text-[#0A1628] font-black mb-2 flex items-center gap-1.5">
                    <FileText className="h-3 w-3" /> Clinical summary
                  </h3>
                  <p className="text-sm text-[#374151] leading-relaxed whitespace-pre-wrap bg-gray-50 p-3 rounded-lg border border-gray-100">
                    {packet.clinical_summary}
                  </p>
                </section>
              )}

              {packet.structured_packet && Object.keys(packet.structured_packet).length > 0 && (
                <section>
                  <h3 className="text-[10px] uppercase tracking-[0.18em] text-[#0A1628] font-black mb-2">Structured packet</h3>
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    {Object.entries(packet.structured_packet).map(([k, v]) => (
                      <div key={k} className="bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
                        <dt className="text-[10px] uppercase tracking-widest text-[#9ca3af] font-black mb-0.5">{k.replace(/_/g, " ")}</dt>
                        <dd className="text-[#0a0a0a] font-mono break-words">
                          {typeof v === "object" ? JSON.stringify(v) : String(v)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )}

              {packet.suggestions && packet.suggestions.length > 0 && (
                <section>
                  <h3 className="text-[10px] uppercase tracking-[0.18em] text-amber-700 font-black mb-2">
                    Suggestions to strengthen the request
                  </h3>
                  <ul className="space-y-1.5">
                    {packet.suggestions.map((s, i) => (
                      <li key={i} className="text-sm text-[#374151] bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                        {s}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-[#e5e7eb] bg-gray-50/50">
          <p className="text-[11px] text-[#6b7280] max-w-md leading-relaxed">
            ClaimRidge does not submit this on your behalf — download it, attach the original clinical documents, and email it to the insurer yourself.
          </p>
          <Button onClick={download} disabled={!packet || loading} className="gap-2">
            <Download className="h-4 w-4" /> Download packet (.txt)
          </Button>
        </div>
      </div>
    </div>
  );
}
