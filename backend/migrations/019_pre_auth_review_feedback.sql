-- 019_pre_auth_review_feedback.sql
-- Pre-auth decision feedback to the sender.
--
-- The insurer reviewer's decision (`POST /api/pre-auth/{id}/review`) only set
-- `status`; the free-text reason the reviewer typed was persisted ONLY when the
-- decision overrode an AI auto-decision (folded into
-- `ai_rationale.override_notice`, migration 017). For a plain manual decision
-- the reason was dropped, so the submitter (provider/doctor) never saw why
-- their pre-auth was approved or denied.
--
-- Mirrors migration 018 (claims): give the reviewer's answer a proper home so
-- the sender's pre-auth history pages can show who decided, when, and why:
--   - review_notes : reviewer-to-submitter reason for the decision
--   - reviewed_by  : the insurer staff profile that decided
--   - reviewed_at  : when the manual decision was made

ALTER TABLE public.pre_auth_requests
  ADD COLUMN IF NOT EXISTS review_notes text,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS reviewed_at timestamp with time zone;
