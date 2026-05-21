# Pre-Auth AI Advisor — Rollout Guide

This document explains how to roll out the new pre-auth LLM guardrail safely.
It walks through the four automation modes, the recommended rollout sequence
for any new insurer, and a worked case example.

The feature is **opt-in per insurer**. By default every insurer stays on
`mode = "off"` and the queue behaves exactly as before — no AI runs.

## The four modes

| Mode        | LLM runs? | Auto-decision? | What the reviewer sees                                  |
|-------------|-----------|----------------|---------------------------------------------------------|
| `off`       | No        | No             | Manual queue, no AI panel.                              |
| `shadow`    | Yes       | No             | Manual queue, AI panel shows what it *would* have done. |
| `advisory`  | Yes       | No             | Manual queue, AI panel shows recommendation + citations.|
| `auto_both` | Yes       | Yes            | Auto-approve / auto-deny when confident; else escalate. |

The recommended rollout is **off → shadow → advisory → auto_both**, one step at
a time, with at least a week in each mode and the agreement rate reviewed
before moving on.

## Rollout sequence

### 0. Onboarding requirements

Before turning anything on, the insurer must:

1. Upload a policy document via the insurer-settings page (`/process-policy`
   stores chunks in `policy_chunks`). The AI advisor **cannot work without
   policy chunks** — it would have nothing to cite. Out-of-network insurers
   are a different story (see below).
2. Confirm an `always_review_specialties` and `always_review_cpts` list with
   their medical team. Anything on these lists bypasses the LLM and goes to
   the manual queue. We pre-populate with high-stakes CPTs (transplants) but
   the medical team usually wants more.

### 1. Shadow mode (2–4 weeks)

Set `mode = "shadow"`. The advisor evaluates every routed pre-auth and stamps
`ai_recommendation`, `ai_confidence`, and `ai_rationale` on the row. Every
request still goes to the manual queue — `status` stays `pending`. The
insurer's reviewers decide as normal.

What to measure during shadow:

- **Agreement rate**: how often the AI's recommendation matches the
  reviewer's final decision. Compute this from the audit log
  (`pre_auth_ai_decision` events vs. the eventual `pre_auth_approved` /
  `pre_auth_denied` event on the same `target_id`).
- **Confidence calibration**: among requests where the AI was ≥ 0.90
  confident, what fraction did the reviewer end up agreeing with? You want
  this above ~95% before you trust auto-decisions.
- **Citation health**: how often does `citations_ok = false`? A high rate
  means the policy chunks are too short or too fragmented and the LLM is
  reaching for spans that don't exist verbatim.
- **Guardrail traffic**: how many requests are escalated by a guardrail
  before the LLM ever runs? Those bypass the advisor entirely and the
  reviewer experience is identical to `off`.

### 2. Advisory mode (2 weeks)

Once shadow agreement is high, set `mode = "advisory"`. Functionally identical
to shadow as far as the data model is concerned, but the reviewer UI now
foregrounds the AI panel — the recommendation, confidence, criteria_met /
criteria_failed table, and the cited policy snippets. Reviewers don't have to
trust it, but they can confirm a recommendation with one click.

This is the "human-in-the-loop" stable resting point. Many insurers stay
here permanently — they get faster reviews without ever delegating the
decision.

### 3. Auto-decide mode (`auto_both`)

When the team is comfortable, flip to `auto_both`. The advisor will now
auto-approve and auto-deny requests that satisfy *all* of:

- `recommendation` is `approve` or `deny` (never `review`),
- `confidence >= confidence_threshold` (default 0.90),
- every cited policy chunk verifies — the chunk exists for this insurer AND
  the quoted span appears verbatim in the chunk's content,
- no hard guardrail fired (cost ceiling, always-review CPT/specialty,
  missing documents, missing patient/member identifiers).

Anything that fails one of those checks lands in the manual queue with
`ai_decision_status = 'auto_escalated'`. Reviewers see the panel exactly as
they did in `advisory` mode.

## Reviewer override + sender notification

When an auto-decision is overridden by a reviewer, the system:

1. Updates `pre_auth_requests.ai_decision_status` to `overridden`.
2. Stores `decision_override_reason` (verbatim) and stamps `sender_notified_at`.
3. Appends an `override_notice` block to `ai_rationale`, with the reviewer's
   note, the original auto status, and the timestamp — the submitter's
   pre-auth history page surfaces this so they know who overrode it and why.
4. Records a `pre_auth_ai_override` event on the immutable audit chain.

The reviewer UI only asks for the override reason when they are actually
overriding — confirming an auto-decision takes a single click.

## Out-of-network insurers

When a provider or doctor submits a pre-auth to a payer that isn't in our
network (`insurer_id IS NULL`, `routing_status = 'unrouted'`), there is no
policy to evaluate against. The advisor does NOT run. Instead the pipeline:

1. OCRs the attached documents (same as the in-network case).
2. Calls `services/pre_auth_template.prepare_offline_packet`, which uses an
   LLM purely to draft a clean offline-submission packet: cover letter,
   masked clinical summary, structured packet, and a list of concrete
   suggestions to strengthen the request before sending.
3. Persists the packet on `pre_auth_requests.ai_rationale.packet` and marks
   `ai_decision_status = 'advisory'`.

The provider / doctor downloads the packet from their pre-auth history page
(the "Offline packet" button on each unrouted row) and emails it to the
insurer themselves. ClaimRidge does not submit it on their behalf.

## Case example

> Insurer **MENA Health Cover** turns on shadow mode after uploading their
> policy on 2026-04-01.
>
> 2026-04-02 — Dr. Khalil at Royal Hospital files a pre-auth for a
> laparoscopic cholecystectomy (CPT 47562) on patient Layla A. (member
> 442-XXXX-7733), estimated cost JOD 1,800. The policy chunk that covers
> abdominal surgery says: *"Laparoscopic cholecystectomy is covered when
> symptomatic gallstones are documented on imaging."*. The submitted notes
> include an ultrasound report showing cholelithiasis and biliary colic.
>
> Pipeline:
>
> 1. OCR extracts the structured packet — diagnoses `K80.20`, procedure
>    `47562`, member ID, ordering & servicing provider.
> 2. Hard guardrails pass: there's no transplant CPT, no always-review
>    specialty match, estimated cost (1,800) is below the 5,000 ceiling, and
>    every required field is populated.
> 3. RAG retrieves 4 policy chunks for the diagnosis/procedure pair.
> 4. The LLM returns `recommendation = "approve"`, `confidence = 0.93`,
>    criteria_met with the gallstone-imaging quote from the policy AND the
>    matching ultrasound finding from the notes.
> 5. Citation check: both quotes appear verbatim in the cited chunk →
>    `citations_ok = true`.
> 6. Mode is `shadow`, so `ai_decision_status` is set to `"shadow"` and the
>    request stays in the manual queue.
>
> Dr. Aida (MENA Health Cover reviewer) opens the queue, sees the AI panel
> showing the recommendation, criteria, and the two quoted spans. She agrees
> and clicks Approve. Audit log records two events: `pre_auth_ai_shadow` for
> the AI run, `pre_auth_approved` for her decision. After four weeks, the
> insurer reviews the agreement rate (97% on shadow), flips to `advisory`,
> and a month later to `auto_both`. The same request a month later auto-
> approves in 8 seconds.
>
> If a reviewer had clicked **Deny** on this auto-approval, the modal would
> have asked for an override reason; the submitter (Dr. Khalil) would see
> the reason on his pre-auth history page the next time he refreshes, and
> the override would appear on the immutable audit chain as
> `pre_auth_ai_override`.

## When to disable auto mode again

Flip back to `advisory` (or `shadow`) if any of:

- Override rate climbs above ~5% over a two-week window.
- A policy update has been uploaded that doesn't re-embed cleanly (you'll
  see `policy_chunks` count drop on the insurer settings page).
- The insurer's medical leadership asks for it.

Returning to a manual-first mode requires no migration — just save the
config; in-flight requests are unaffected.
