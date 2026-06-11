-- 018_claim_review_feedback.sql
-- Claim decision feedback to the sender.
--
-- The insurer's manual review (`POST /api/insurer/review-claim`) used to write
-- its reason into `claims.notes`, clobbering the submitter's own notes, and the
-- provider/doctor portals never displayed the payer's answer at all.
--
-- This migration gives the manual decision a proper home so the sender-side
-- pages (claim history + results) can show who decided, when, and why:
--   - review_notes : reviewer-to-submitter reason for the decision
--   - reviewed_by  : the insurer staff profile that decided
--   - reviewed_at  : when the manual decision was made
--
-- AI adjudication verdicts already persist on `adjudication` /
-- `adjudication_decision` / `adjudicated_at` (migration 010) and need no change.

ALTER TABLE public.claims
  ADD COLUMN IF NOT EXISTS review_notes text,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS reviewed_at timestamp with time zone;
