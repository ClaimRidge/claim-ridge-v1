"use client";

import { useEffect, useState } from "react";
import { FileText, Download } from "lucide-react";

// Inline previewer for uploaded clinical documents — images render directly,
// PDFs go through a Blob URL (data: URIs are blocked by some browsers in
// iframes), anything else falls back to a download link. Mirrors the insurer
// review page's viewer so the sender sees the exact same documents.

export interface ViewerDocument {
  id: string;
  file_name: string;
  file_type: string | null;
  file_base64?: string | null;
}

export default function DocumentViewer({ documents }: { documents: ViewerDocument[] }) {
  const [activeId, setActiveId] = useState<string | null>(documents[0]?.id ?? null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  const active = documents.find((d) => d.id === activeId) || null;

  // Build (and clean up) a Blob URL whenever the active doc is a PDF.
  useEffect(() => {
    if (!active || !active.file_base64 || active.file_type !== "application/pdf") {
      setBlobUrl(null);
      return;
    }
    try {
      const bytes = atob(active.file_base64);
      const arr = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([arr], { type: "application/pdf" }));
      setBlobUrl(url);
      return () => URL.revokeObjectURL(url);
    } catch {
      setBlobUrl(null);
    }
  }, [active]);

  if (documents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-[#9ca3af]">
        <FileText className="h-12 w-12 mb-3 opacity-20" />
        <p className="text-sm font-medium">No documents were attached.</p>
      </div>
    );
  }

  const dataHref = active?.file_base64
    ? `data:${active.file_type || "application/octet-stream"};base64,${active.file_base64}`
    : null;

  return (
    <div className="flex flex-col min-h-[500px]">
      {/* Tabs */}
      <div className="px-4 py-3 border-b border-[#f3f4f6] flex items-center justify-between gap-3 overflow-x-auto">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="h-4 w-4 text-[#9ca3af] flex-shrink-0" />
          <div className="flex gap-1">
            {documents.map((doc) => (
              <button
                key={doc.id}
                onClick={() => setActiveId(doc.id)}
                className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all whitespace-nowrap ${
                  activeId === doc.id
                    ? "bg-[#0A1628] text-white shadow-md"
                    : "bg-[#f3f4f6] text-[#6b7280] hover:bg-[#e5e7eb]"
                }`}
              >
                {doc.file_name}
              </button>
            ))}
          </div>
        </div>
        {dataHref && (
          <a
            href={dataHref}
            download={active?.file_name}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#16a34a] hover:text-[#15803d] flex-shrink-0"
          >
            <Download className="h-3.5 w-3.5" /> Download
          </a>
        )}
      </div>

      {/* Preview */}
      <div className="flex-1 bg-[#fafafa] flex flex-col min-h-[500px]">
        {!active ? (
          <div className="flex-1 flex items-center justify-center text-[#9ca3af] text-sm">
            Select a document to preview.
          </div>
        ) : active.file_base64 && active.file_type === "application/pdf" ? (
          blobUrl ? (
            <iframe src={`${blobUrl}#toolbar=0&navpanes=0`} className="w-full flex-1 border-0 min-h-[500px]" title={active.file_name} />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-12">
              <div className="animate-spin h-8 w-8 border-4 border-[#0A1628] border-t-transparent rounded-full mb-3" />
              <p className="text-sm text-[#6b7280]">Preparing PDF preview…</p>
            </div>
          )
        ) : active.file_base64 && (active.file_type || "").startsWith("image/") ? (
          <div className="flex-1 flex items-center justify-center p-4 overflow-auto">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`data:${active.file_type};base64,${active.file_base64}`}
              alt={active.file_name}
              className="max-w-full max-h-[70vh] object-contain shadow-xl rounded-lg border border-gray-200"
            />
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
              <FileText className="h-8 w-8 text-gray-400" />
            </div>
            <h3 className="text-base font-bold text-gray-900">Preview unavailable</h3>
            <p className="text-sm text-gray-500 mt-1 max-w-sm">
              {active.file_name} can&apos;t be previewed inline
              {dataHref ? " — use Download above." : " and no stored copy is available."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
