"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  NotifCategory,
  NotifItem,
  NotifRecord,
  readSeen,
  statusSnapshot,
  unseenItems,
  writeSeen,
} from "@/lib/notifications";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "";
const POLL_MS = 30_000;

export interface DecisionNotifications {
  preAuthUnseen: NotifItem[];
  claimUnseen: NotifItem[];
  total: number;
  /** Mark every currently-known item in a category as acknowledged. */
  markSeen: (category: NotifCategory | "all") => void;
  /** Force an immediate refetch. */
  refresh: () => void;
}

interface State {
  preAuths: NotifRecord[];
  claims: NotifRecord[];
}

/**
 * Polls the caller's pre-auths + claims, diffs each against the locally-stored
 * "seen" snapshot, and exposes the payer decisions that arrived since the user
 * last looked. Refetches on an interval and whenever the tab regains focus, so
 * the portal stops being a static, manual-refresh experience.
 */
export function useDecisionNotifications(portal: "doctor" | "provider"): DecisionNotifications {
  const supabase = createClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [data, setData] = useState<State>({ preAuths: [], claims: [] });
  const [preAuthUnseen, setPreAuthUnseen] = useState<NotifItem[]>([]);
  const [claimUnseen, setClaimUnseen] = useState<NotifItem[]>([]);
  // Keeps the latest records reachable from markSeen without re-creating it.
  const dataRef = useRef<State>(data);
  dataRef.current = data;

  // Providers govern submissions filed by their whole org, so they get alerted
  // to new pre-auths/claims as well as responses. A doctor only sees their own
  // submissions, so a "new" item would just be their own action — they get
  // responses only.
  const includeNew = portal === "provider";

  const recompute = useCallback((uid: string, next: State) => {
    // First observation for this user seeds the snapshot silently, so we only
    // ever alert on changes that happen *after* the user starts watching.
    let seenPa = readSeen(uid, "preauth");
    if (seenPa === null) {
      seenPa = statusSnapshot(next.preAuths);
      writeSeen(uid, "preauth", seenPa);
    }
    let seenCl = readSeen(uid, "claim");
    if (seenCl === null) {
      seenCl = statusSnapshot(next.claims);
      writeSeen(uid, "claim", seenCl);
    }
    setPreAuthUnseen(unseenItems("preauth", next.preAuths, seenPa, includeNew));
    setClaimUnseen(unseenItems("claim", next.claims, seenCl, includeNew));
  }, [includeNew]);

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const uid = session.user.id;
    setUserId(uid);
    const auth = `Bearer ${session.access_token}`;

    let preAuths: NotifRecord[] = [];
    let claims: NotifRecord[] = [];

    // ── Pre-auths (backend; portal-specific endpoint) ──
    try {
      const url =
        portal === "doctor"
          ? `${BACKEND}/api/dropoff/my-submissions`
          : `${BACKEND}/api/providers/pre-auths`;
      const res = await fetch(url, { headers: { Authorization: auth } });
      if (res.ok) {
        const body = await res.json();
        const rows = portal === "doctor" ? body : body.submissions || [];
        preAuths = (rows as Record<string, unknown>[]).map((r) => ({
          id: String(r.id),
          status: String(r.status || ""),
          label: (r.patient_name as string) || (r.reference_number as string) || null,
          payer: (r.insurer_name as string) || (r.payer_name_raw as string) || null,
          decidedAt: (r.reviewed_at as string) || (r.created_at as string) || null,
        }));
      }
    } catch {
      /* leave pre-auths empty — non-critical */
    }

    // ── Claims (Supabase; RLS scopes provider→org, doctor→self) ──
    try {
      let q = supabase
        .from("claims")
        .select("id, status, patient_name, payer_name, reviewed_at, created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (portal === "doctor") q = q.eq("user_id", uid);
      const { data: rows } = await q;
      claims = (rows || []).map((r: Record<string, unknown>) => ({
        id: String(r.id),
        status: String(r.status || ""),
        label: (r.patient_name as string) || null,
        payer: (r.payer_name as string) || null,
        decidedAt: (r.reviewed_at as string) || (r.created_at as string) || null,
      }));
    } catch {
      /* leave claims empty — non-critical */
    }

    const next = { preAuths, claims };
    setData(next);
    recompute(uid, next);
  }, [supabase, portal, recompute]);

  // Initial load + polling + refetch on tab focus.
  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_MS);
    const onFocus = () => { if (document.visibilityState === "visible") load(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [load]);

  // Realtime push for claims — RLS scopes the stream to rows the caller can see
  // (provider → their org, doctor → their own), so any insert/update to a
  // relevant claim refetches within a moment instead of waiting for the poll.
  // (pre_auth_requests has no browser RLS read policy, so it can't be streamed
  // to the client and stays on the polling path.)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const debouncedLoad = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(load, 600); // collapse event bursts into one refetch
    };
    const channel = supabase
      .channel("claims-activity")
      .on("postgres_changes", { event: "*", schema: "public", table: "claims" }, debouncedLoad)
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [supabase, load]);

  const markSeen = useCallback((category: NotifCategory | "all") => {
    if (!userId) return;
    const { preAuths, claims } = dataRef.current;
    if (category === "preauth" || category === "all") {
      writeSeen(userId, "preauth", statusSnapshot(preAuths));
      setPreAuthUnseen([]);
    }
    if (category === "claim" || category === "all") {
      writeSeen(userId, "claim", statusSnapshot(claims));
      setClaimUnseen([]);
    }
  }, [userId]);

  return {
    preAuthUnseen,
    claimUnseen,
    total: preAuthUnseen.length + claimUnseen.length,
    markSeen,
    refresh: load,
  };
}
