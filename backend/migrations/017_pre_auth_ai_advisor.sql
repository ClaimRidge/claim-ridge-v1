-- 017_pre_auth_ai_advisor.sql
-- Pre-Auth LLM Guardrail & Rule Engine
--
-- Re-introduces an AI layer on the pre-auth pipeline. Migration 014 deliberately
-- removed the original `ai_decision`/`ai_rationale` columns when pre-auth went
-- fully manual; this migration brings AI back as a guardrailed advisor that can
-- optionally auto-decide on the insurer's behalf (opt-in, per-insurer).
--
-- Three modes are supported per insurer (stored in insurers.config):
--   off        -> the queue stays purely manual (current behaviour, default)
--   shadow     -> the LLM runs and writes a recommendation, but every request
--                 still goes to the manual queue. Used for measuring agreement
--                 with reviewers before flipping the auto switch.
--   advisory   -> recommendation shown next to the queue row, no auto-decisions
--   auto_both  -> auto_approve and auto_deny when confidence >= threshold AND
--                 every criterion carries a verifiable policy citation
--
-- Hard guardrails always run BEFORE the LLM and force a manual queue entry:
--   * estimated cost above insurer-configured ceiling
--   * procedure on the insurer's "always_review" CPT list
--   * specialty on the insurer's "always_review" specialty list
--   * required documents missing
--   * patient identifiers fail basic shape checks
--
-- Out-of-network requests (insurer_id IS NULL) skip the LLM entirely — see
-- services/pre_auth_template.py, which prepares an offline-submission packet
-- the provider/doctor can download and email to the insurer themselves.

-- ────────────────────────────────────────────────────────────────────────────
-- Per-request AI fields
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.pre_auth_requests
    ADD COLUMN IF NOT EXISTS ai_recommendation text
        CHECK (ai_recommendation IS NULL OR ai_recommendation = ANY (
            ARRAY['approve'::text, 'deny'::text, 'review'::text]
        )),
    ADD COLUMN IF NOT EXISTS ai_confidence numeric
        CHECK (ai_confidence IS NULL OR (ai_confidence >= 0 AND ai_confidence <= 1)),
    ADD COLUMN IF NOT EXISTS ai_rationale jsonb,
    ADD COLUMN IF NOT EXISTS ai_decision_status text
        CHECK (ai_decision_status IS NULL OR ai_decision_status = ANY (
            ARRAY[
                'pending'::text,        -- queued, not yet evaluated
                'shadow'::text,         -- LLM ran, kept in manual queue by config
                'advisory'::text,       -- LLM ran, attached as advice (manual queue)
                'auto_approved'::text,  -- LLM auto-approved, authorisation activated
                'auto_denied'::text,    -- LLM auto-denied
                'auto_escalated'::text, -- LLM ran but failed guardrails, queued
                'overridden'::text,     -- reviewer overrode the auto decision
                'failed'::text          -- LLM error, treated as escalate
            ]
        )),
    ADD COLUMN IF NOT EXISTS ai_evaluated_at timestamp with time zone,
    ADD COLUMN IF NOT EXISTS decision_override_reason text,
    ADD COLUMN IF NOT EXISTS sender_notified_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS idx_pre_auth_ai_decision_status
    ON public.pre_auth_requests (ai_decision_status);

CREATE INDEX IF NOT EXISTS idx_pre_auth_insurer_ai_status
    ON public.pre_auth_requests (insurer_id, ai_decision_status);

-- ────────────────────────────────────────────────────────────────────────────
-- insurers.config.pre_auth_automation schema (documented, not enforced)
-- ────────────────────────────────────────────────────────────────────────────
-- {
--   "pre_auth_automation": {
--     "mode": "off" | "shadow" | "advisory" | "auto_both",
--     "confidence_threshold": 0.90,
--     "auto_decision_max_amount": 5000,           -- in insurer's billing currency
--     "always_review_specialties": ["Oncology", "Transplant", "Psychiatry"],
--     "always_review_cpts": ["33945", "47135"],   -- CPT codes that force manual
--     "auto_revocation_window_hours": 72          -- SLA for reviewer to override
--   }
-- }
--
-- Defaults applied in code when keys are absent. No CHECK constraint here —
-- insurers can extend their config bag freely.

-- ────────────────────────────────────────────────────────────────────────────
-- Audit categories used by this feature (documented, not enforced)
-- ────────────────────────────────────────────────────────────────────────────
--   pre_auth_ai_decision   -> auto_approved / auto_denied / shadow / advisory
--   pre_auth_ai_override   -> reviewer overrode an auto decision
--   pre_auth_offline_packet -> out-of-network packet prepared / downloaded
--
-- See services/audit.py:record_event and services/audit.py:record_ai_inference.
