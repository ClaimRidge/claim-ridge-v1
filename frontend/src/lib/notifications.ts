// Decision-notification logic shared by the provider + doctor portals.
//
// The payer (insurer) decides pre-auths and claims asynchronously, and the
// sender's portal is otherwise static — they'd have to refresh and hunt for a
// changed status. This module tracks which decisions a sender has already seen
// (in localStorage, per user) so the UI can alert them to *newly arrived*
// payer responses, and only those.

export type NotifCategory = "preauth" | "claim";

export interface NotifRecord {
  id: string;
  status: string;
  // Display context for the dropdown (best-effort — may be absent).
  label?: string | null;
  payer?: string | null;
  decidedAt?: string | null;
}

// A status counts as a "payer response" once it leaves the pending/in-flight
// set and lands on a terminal or escalated decision. Out-of-network rows
// (status "unrouted") never get a payer decision, so they're naturally excluded.
const PREAUTH_DECIDED = new Set([
  "approve", "approved", "deny", "denied", "rejected", "escalate", "escalated", "needs_info",
]);
const CLAIM_DECIDED = new Set([
  "accept", "accepted", "approve", "approved", "deny", "denied", "rejected", "escalate", "escalated", "needs_info",
]);

export function isDecided(category: NotifCategory, status: string | null | undefined): boolean {
  const s = (status || "").toLowerCase();
  return category === "preauth" ? PREAUTH_DECIDED.has(s) : CLAIM_DECIDED.has(s);
}

// localStorage holds, per user + category, a map of recordId → the status the
// user last acknowledged. A record is "new" when its current status is a
// decision AND differs from what was acknowledged (covers both a freshly
// arrived already-decided row and a pending→decided transition).
type SeenMap = Record<string, string>;

function storageKey(userId: string, category: NotifCategory): string {
  return `cr_seen_${category}_${userId}`;
}

export function readSeen(userId: string, category: NotifCategory): SeenMap | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(userId, category));
    return raw ? (JSON.parse(raw) as SeenMap) : null;
  } catch {
    return null;
  }
}

export function writeSeen(userId: string, category: NotifCategory, map: SeenMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(userId, category), JSON.stringify(map));
  } catch {
    /* storage full / disabled — notifications just won't persist */
  }
}

// Snapshot every record's current status so future polls can diff against it.
export function statusSnapshot(records: NotifRecord[]): SeenMap {
  const map: SeenMap = {};
  for (const r of records) map[r.id] = (r.status || "").toLowerCase();
  return map;
}

// A single unacknowledged update. `kind` distinguishes a brand-new submission
// (a record that appeared since the user last looked) from a payer decision
// (a record whose status changed to a terminal/escalated verdict).
export interface NotifItem extends NotifRecord {
  kind: "new" | "decision";
}

// Diff the live records against the acknowledged snapshot:
//  - a record absent from `seen` is NEW (surfaced only when includeNew — e.g.
//    providers want to know their doctors filed something; a doctor's own fresh
//    submission isn't news to them).
//  - a record present in `seen` whose status flipped to a decision is a RESPONSE.
// A record that is both brand-new AND already decided counts once, as the more
// actionable of the two given the audience.
export function unseenItems(
  category: NotifCategory,
  records: NotifRecord[],
  seen: SeenMap,
  includeNew: boolean,
): NotifItem[] {
  const items: NotifItem[] = [];
  for (const r of records) {
    const status = (r.status || "").toLowerCase();
    const known = r.id in seen;
    if (!known) {
      if (includeNew) items.push({ ...r, kind: "new" });
      else if (isDecided(category, status)) items.push({ ...r, kind: "decision" });
    } else if (isDecided(category, status) && seen[r.id] !== status) {
      items.push({ ...r, kind: "decision" });
    }
  }
  return items;
}
