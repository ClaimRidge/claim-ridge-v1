"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, CheckCheck, ShieldCheck, FileText, Plus } from "lucide-react";
import { DecisionNotifications } from "@/hooks/useDecisionNotifications";
import { NotifItem } from "@/lib/notifications";

const ROUTES = {
  doctor: { preauth: "/dashboard/doctor/pre-auth", claim: "/dashboard/doctor/claims/history" },
  provider: { preauth: "/dashboard/provider/pre-auth", claim: "/dashboard/provider/claims/history" },
} as const;

function decisionTone(status: string): string {
  const s = status.toLowerCase();
  if (["approve", "approved", "accept", "accepted"].includes(s)) return "text-[#16a34a]";
  if (["deny", "denied", "rejected"].includes(s)) return "text-red-600";
  return "text-blue-600";
}

function NotifLine({ item, href, category, onClick }: {
  item: NotifItem;
  href: string;
  category: "preauth" | "claim";
  onClick: () => void;
}) {
  const Icon = item.kind === "new" ? Plus : category === "preauth" ? ShieldCheck : FileText;
  const noun = category === "preauth" ? "Pre-auth" : "Claim";
  return (
    <Link
      href={href}
      onClick={onClick}
      className="flex items-start gap-3 px-4 py-3 hover:bg-[#f9fafb] transition-colors"
    >
      <div className="mt-0.5 w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-lg bg-[#f0fdf4]">
        <Icon className="h-3.5 w-3.5 text-[#16a34a]" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-[#0a0a0a] truncate">
          <span className="font-medium">{item.label || "Submission"}</span>
          {item.payer ? <span className="text-[#9ca3af]"> · {item.payer}</span> : null}
        </p>
        <p className="text-xs">
          {item.kind === "new" ? (
            <span className="font-bold uppercase text-[#16a34a]">New {noun} submitted</span>
          ) : (
            <>
              <span className={`font-bold uppercase ${decisionTone(item.status)}`}>{item.status}</span>
              <span className="text-[#9ca3af]"> · {noun} decision</span>
            </>
          )}
        </p>
      </div>
    </Link>
  );
}

export default function NotificationBell({
  notifications,
  portal,
}: {
  notifications: DecisionNotifications;
  portal: "doctor" | "provider";
}) {
  const { preAuthUnseen, claimUnseen, total, markSeen } = notifications;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const routes = ROUTES[portal];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications${total ? ` (${total} new)` : ""}`}
        className="relative p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
      >
        <Bell className="h-5 w-5" />
        {total > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold leading-none">
            {total > 99 ? "99+" : total}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] bg-white rounded-xl shadow-2xl border border-[#e5e7eb] z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#f3f4f6]">
            <p className="text-sm font-bold text-[#0a0a0a]">Notifications</p>
            {total > 0 && (
              <button
                onClick={() => markSeen("all")}
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#16a34a] hover:text-[#15803d]"
              >
                <CheckCheck className="h-3.5 w-3.5" /> Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto divide-y divide-[#f3f4f6]">
            {total === 0 ? (
              <div className="px-4 py-10 text-center">
                <Bell className="h-8 w-8 text-[#d1d5db] mx-auto mb-2" />
                <p className="text-sm text-[#9ca3af]">You&apos;re all caught up.</p>
                <p className="text-xs text-[#d1d5db] mt-1">New submissions and payer decisions appear here.</p>
              </div>
            ) : (
              <>
                {preAuthUnseen.map((item) => (
                  <NotifLine
                    key={`pa-${item.id}`}
                    item={item}
                    category="preauth"
                    href={routes.preauth}
                    onClick={() => setOpen(false)}
                  />
                ))}
                {claimUnseen.map((item) => (
                  <NotifLine
                    key={`cl-${item.id}`}
                    item={item}
                    category="claim"
                    href={routes.claim}
                    onClick={() => setOpen(false)}
                  />
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
