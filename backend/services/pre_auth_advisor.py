"""Pre-Auth LLM Guardrail & Rule Engine.

The pre-auth pipeline historically had no AI step — every routed request went
straight to the insurer's manual queue. This module re-introduces AI as a
guardrailed advisor that can, when the insurer opts in, auto-approve or
auto-deny low-risk, policy-backed requests. Otherwise it just attaches an
advisory recommendation to the row and the human reviewer still decides.

Pipeline:
    1. Read insurer config (mode, thresholds, always-review lists, cost ceiling).
    2. Apply HARD GUARDRAILS that bypass the LLM entirely. Any guardrail hit
       forces ai_decision_status = 'auto_escalated' — the LLM does not run.
    3. RAG over policy_chunks for this insurer, retrieving both content AND ids.
    4. Call the PRE_AUTH_ADVISOR LLM with chunk ids inlined into the context.
    5. Verify each citation: the chunk id must exist for this insurer, and the
       `policy_quote` must actually appear (case-insensitive, whitespace-loose)
       inside that chunk's content. Approvals with fake citations are downgraded
       to `review`.
    6. Route by insurer config:
         off       -> persist nothing AI-side, leave the queue manual
         shadow    -> persist recommendation, status='shadow', stay in queue
         advisory  -> persist recommendation, status='advisory', stay in queue
         auto_both -> auto-approve / auto-deny only when confidence threshold
                      met AND citation check passed; else escalate to manual.

The module is side-effect-only — it writes to Supabase and never raises (a
failure escalates to manual review rather than blocking submission).
"""

from __future__ import annotations

import json
import logging
import re
import time
from datetime import datetime, timezone
from typing import Optional

from core.config import Config
from core.database import supabase
from services import audit
from services.ai_services import (
    PRE_AUTH_ADVISOR_SYSTEM_PROMPT,
    get_embeddings,
    get_llm,
    parse_llm_json,
)
from services.authorization import activate_authorization, revoke_authorization
from langchain_core.messages import HumanMessage, SystemMessage

logger = logging.getLogger(__name__)

# Defaults applied when an insurer has no automation config saved yet.
# Default is `auto_both`: the advisor auto-approves / auto-denies whenever the
# guardrails pass (confidence >= threshold, all citations verify, under the cost
# ceiling, no always-review/hard-block CPT, all required fields + documents
# present) and escalates everything else to a human. Insurers can dial it back
# to advisory/shadow/off via the automation settings page.
_DEFAULTS = {
    "mode": "auto_both",
    "confidence_threshold": 0.90,
    "auto_decision_max_amount": 5000.0,
    "always_review_specialties": [],
    "always_review_cpts": [],
    "auto_revocation_window_hours": 72,
}

_VALID_MODES = {"off", "shadow", "advisory", "auto_both"}

# Insurer-agnostic high-stakes procedure floor. Even an insurer that has not
# uploaded an `always_review_cpts` list never gets the LLM auto-deciding on a
# transplant, oncology infusion, or major cardiac surgery.
_HARD_BLOCK_CPTS = frozenset({
    "33945",  # heart transplant
    "47135",  # liver transplant
    "50360",  # kidney transplant
    "44135",  # intestinal transplant
})


# ── config loading ─────────────────────────────────────────────────────────
def load_automation_config(insurer_id: str) -> dict:
    """Returns the insurer's pre_auth_automation block, merged with defaults."""
    try:
        res = (supabase.table("insurers")
               .select("config")
               .eq("id", insurer_id)
               .maybe_single()
               .execute())
        cfg = ((res.data or {}).get("config") or {}).get("pre_auth_automation") or {}
    except Exception as e:
        logger.warning(f"load_automation_config({insurer_id}) failed: {e}")
        cfg = {}
    merged = {**_DEFAULTS, **{k: v for k, v in cfg.items() if v is not None}}
    if merged["mode"] not in _VALID_MODES:
        merged["mode"] = _DEFAULTS["mode"]
    return merged


# ── hard guardrails ────────────────────────────────────────────────────────
def _normalize_cpts(value) -> list[str]:
    if isinstance(value, str):
        value = [value]
    return [str(c).strip().upper() for c in (value or []) if str(c).strip()]


def _request_cpts(req: dict) -> list[str]:
    codes = _normalize_cpts(req.get("procedure_codes"))
    if not codes and req.get("procedure_code"):
        codes = _normalize_cpts([req["procedure_code"]])
    return codes


def _required_fields_present(req: dict) -> tuple[bool, Optional[str]]:
    required = [
        ("patient_name", "patient name"),
        ("patient_id", "patient national ID"),
        ("insurance_member_id", "insurance member ID"),
    ]
    for field, label in required:
        val = req.get(field)
        if not val or not str(val).strip() or str(val).strip().lower() == "pending extraction":
            return False, f"Missing {label}."
    if not _request_cpts(req):
        return False, "No procedure code (CPT) on the request."
    if not (req.get("diagnosis_codes") or req.get("diagnosis_code")):
        return False, "No diagnosis code (ICD-10) on the request."
    return True, None


def _check_hard_guardrails(req: dict, cfg: dict, doc_count: int) -> Optional[dict]:
    """Returns a guardrail-hit dict, or None when the LLM is allowed to run."""
    if doc_count == 0:
        return {"reason": "no_documents", "detail": "No clinical documents were attached."}

    ok, missing = _required_fields_present(req)
    if not ok:
        return {"reason": "missing_fields", "detail": missing}

    cpts = _request_cpts(req)
    always = set(_normalize_cpts(cfg.get("always_review_cpts"))) | _HARD_BLOCK_CPTS
    flagged_cpt = next((c for c in cpts if c in always), None)
    if flagged_cpt:
        return {
            "reason": "always_review_cpt",
            "detail": f"CPT {flagged_cpt} is on the always-review list.",
        }

    specialty = (req.get("provider_specialty") or "").strip().lower()
    if specialty:
        always_specs = {
            s.strip().lower()
            for s in (cfg.get("always_review_specialties") or [])
            if isinstance(s, str) and s.strip()
        }
        if specialty in always_specs:
            return {
                "reason": "always_review_specialty",
                "detail": f"Specialty '{req.get('provider_specialty')}' is on the always-review list.",
            }

    try:
        amount = float(req.get("claim_amount") or 0)
    except (TypeError, ValueError):
        amount = 0.0
    ceiling = float(cfg.get("auto_decision_max_amount") or 0)
    if ceiling > 0 and amount > ceiling:
        return {
            "reason": "above_cost_ceiling",
            "detail": f"Estimated cost {amount:.2f} exceeds auto-decision ceiling {ceiling:.2f}.",
        }
    return None


# ── citation verification ──────────────────────────────────────────────────
def _loose(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def _verify_citations(verdict: dict, chunks_by_id: dict[str, str]) -> tuple[bool, list[str]]:
    """Each criterion claimed by the verdict must point to a real chunk for this
    insurer AND quote a span that actually appears in that chunk. Returns
    (passed, problems_found)."""
    problems: list[str] = []

    def _check_block(items, block_name: str):
        if not isinstance(items, list):
            return
        for i, item in enumerate(items):
            if not isinstance(item, dict):
                problems.append(f"{block_name}[{i}] is not an object")
                continue
            chunk_id = (item.get("policy_chunk_id") or "").strip()
            quote = item.get("policy_quote") or ""
            if not chunk_id:
                problems.append(f"{block_name}[{i}] missing policy_chunk_id")
                continue
            content = chunks_by_id.get(chunk_id)
            if content is None:
                problems.append(f"{block_name}[{i}] cites unknown chunk_id {chunk_id}")
                continue
            if not quote or _loose(quote) not in _loose(content):
                problems.append(
                    f"{block_name}[{i}] policy_quote not found verbatim in chunk {chunk_id}"
                )

    _check_block(verdict.get("criteria_met"), "criteria_met")
    _check_block(verdict.get("criteria_failed"), "criteria_failed")
    return (not problems), problems


# ── LLM call ───────────────────────────────────────────────────────────────
def _build_policy_context(chunks: list[dict]) -> str:
    if not chunks:
        return "No insurer policy passages were retrieved for these codes."
    return "\n---\n".join(
        f"[chunk_id: {c['id']}]\n{c['content']}" for c in chunks
    )


def _build_clinical_context(req: dict, doc_text: str) -> dict:
    return {
        "patient": {
            "name": req.get("patient_name"),
            "id": req.get("patient_id"),
            "dob": req.get("patient_dob"),
            "age": req.get("patient_age"),
            "gender": req.get("patient_gender"),
            "member_id": req.get("insurance_member_id"),
        },
        "ordering_provider": {
            "name": req.get("ordering_provider_name"),
            "npi": req.get("ordering_provider_npi"),
        },
        "servicing_provider": {
            "name": req.get("servicing_provider_name") or req.get("provider_name"),
            "npi": req.get("servicing_provider_npi"),
            "specialty": req.get("provider_specialty"),
        },
        "diagnoses_icd10": req.get("diagnosis_codes") or (
            [req["diagnosis_code"]] if req.get("diagnosis_code") else []
        ),
        "procedures_cpt": _request_cpts(req),
        "place_of_service": req.get("place_of_service"),
        "anticipated_date_of_service": req.get("anticipated_date_of_service"),
        "priority": req.get("priority"),
        "estimated_cost": req.get("claim_amount"),
        "currency": req.get("currency"),
        "submitted_role": req.get("submitted_role"),
        "clinical_notes": (doc_text or "")[:8000],
    }


async def _retrieve_policy_chunks(req: dict, insurer_id: str) -> list[dict]:
    diagnoses = req.get("diagnosis_codes") or (
        [req["diagnosis_code"]] if req.get("diagnosis_code") else []
    )
    procedures = _request_cpts(req)
    if not diagnoses and not procedures:
        return []
    query = (
        f"Medical necessity criteria, coverage rules and exclusions for "
        f"diagnoses {', '.join(diagnoses)} and procedures {', '.join(procedures)}"
    )
    try:
        vec = get_embeddings().embed_query(query)
        res = supabase.rpc("match_policy_rules", {
            "query_embedding": vec,
            "match_threshold": 0.4,
            "match_count": 6,
            "p_insurer_id": insurer_id,
        }).execute()
        rows = res.data or []
    except Exception as e:
        logger.error(f"pre_auth_advisor RAG failed for insurer {insurer_id}: {e}")
        return []

    # The RPC may or may not return `id` depending on schema version. When it
    # doesn't, fall back to a content-keyed lookup so citation verification can
    # still resolve chunk ids.
    out: list[dict] = []
    missing_ids = [r for r in rows if not r.get("id")]
    id_by_content: dict[str, str] = {}
    if missing_ids:
        try:
            contents = [r.get("content") for r in missing_ids if r.get("content")]
            if contents:
                lookup = (supabase.table("policy_chunks")
                          .select("id, content")
                          .eq("insurer_id", insurer_id)
                          .in_("content", contents)
                          .execute())
                for row in lookup.data or []:
                    id_by_content[row["content"]] = row["id"]
        except Exception as e:
            logger.warning(f"chunk id lookup fallback failed: {e}")
    for r in rows:
        cid = r.get("id") or id_by_content.get(r.get("content") or "")
        if cid and r.get("content"):
            out.append({"id": str(cid), "content": r["content"]})
    return out


async def _run_llm(req: dict, doc_text: str, chunks: list[dict]) -> tuple[dict, dict]:
    """Returns (verdict, meta). On any failure returns a safe `review` verdict."""
    started = time.time()
    policy_context = _build_policy_context(chunks)
    clinical = _build_clinical_context(req, doc_text)
    system_prompt = PRE_AUTH_ADVISOR_SYSTEM_PROMPT.format(policy_context=policy_context)
    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=(
            "Evaluate the following pre-authorisation request against the "
            "policy passages above and return your verdict as JSON:\n\n"
            + json.dumps(clinical, indent=2, default=str)
        )),
    ]
    try:
        llm = get_llm(json_mode=True)
        response = await llm.ainvoke(messages)
        verdict = parse_llm_json(response.content)
        if not isinstance(verdict, dict):
            raise ValueError("response was not a JSON object")
    except Exception as e:
        logger.error(f"pre_auth_advisor LLM call failed: {e}")
        verdict = {
            "recommendation": "review",
            "confidence": 0.0,
            "rationale": "AI advisor failed to produce a verdict — request escalated to manual review.",
            "criteria_met": [],
            "criteria_failed": [],
            "missing_information": [],
            "reviewer_notes": f"LLM error: {e!s}",
        }
    meta = {
        "latency_ms": int((time.time() - started) * 1000),
        "model_version": Config.LLM_MODEL,
        "chunks_retrieved": len(chunks),
    }
    return verdict, meta


# ── decision routing ───────────────────────────────────────────────────────
def _normalise_recommendation(value) -> str:
    v = str(value or "").strip().lower()
    if v in {"approve", "approved"}:
        return "approve"
    if v in {"deny", "denied", "reject", "rejected"}:
        return "deny"
    return "review"


def _normalise_confidence(value) -> float:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, min(1.0, f))


def _route_decision(
    *, mode: str, recommendation: str, confidence: float,
    threshold: float, citations_ok: bool,
) -> str:
    """Returns the ai_decision_status to persist."""
    if mode == "off":
        return "pending"
    if mode == "shadow":
        return "shadow"
    if mode == "advisory":
        return "advisory"
    # mode == "auto_both"
    if recommendation == "review":
        return "auto_escalated"
    if confidence < threshold:
        return "auto_escalated"
    if recommendation == "approve" and not citations_ok:
        return "auto_escalated"
    if recommendation == "deny" and not citations_ok:
        return "auto_escalated"
    return "auto_approved" if recommendation == "approve" else "auto_denied"


# ── persistence ────────────────────────────────────────────────────────────
def _persist(pre_auth_id: str, updates: dict) -> None:
    try:
        supabase.table("pre_auth_requests").update(updates).eq("id", pre_auth_id).execute()
    except Exception as e:
        logger.error(f"pre_auth_advisor persist failed for {pre_auth_id}: {e}")


# ── public entry point ─────────────────────────────────────────────────────
async def evaluate_pre_auth(pre_auth_id: str) -> dict:
    """Top-level orchestrator. Always returns a result dict; never raises."""
    res = (supabase.table("pre_auth_requests")
           .select("*")
           .eq("id", pre_auth_id)
           .maybe_single()
           .execute())
    if not res or not getattr(res, "data", None):
        return {"ok": False, "error": "pre_auth_not_found"}
    req = res.data

    insurer_id = req.get("insurer_id")
    if not insurer_id:
        # Out-of-network requests are handled by services/pre_auth_template.py.
        return {"ok": False, "error": "unrouted"}

    cfg = load_automation_config(insurer_id)
    mode = cfg["mode"]

    # When the insurer has opted out entirely we still record `pending` so the
    # UI can tell "no AI ran" apart from "AI is queued but hasn't run yet".
    if mode == "off":
        _persist(pre_auth_id, {"ai_decision_status": "pending"})
        return {"ok": True, "mode": "off"}

    # Pull document text for the clinical context.
    try:
        docs_res = (supabase.table("pre_auth_documents")
                    .select("file_name, extracted_text")
                    .eq("pre_auth_id", pre_auth_id)
                    .execute())
        docs = docs_res.data or []
    except Exception as e:
        logger.warning(f"could not load documents for {pre_auth_id}: {e}")
        docs = []
    doc_text = "\n\n".join(
        f"--- {d['file_name']} ---\n{d.get('extracted_text') or ''}"
        for d in docs if d.get("extracted_text")
    )

    # 1. Hard guardrails.
    guardrail = _check_hard_guardrails(req, cfg, doc_count=len(docs))
    if guardrail:
        rationale = {
            "mode": mode,
            "guardrail": guardrail,
            "summary": f"Guardrail '{guardrail['reason']}' — escalated to manual review.",
        }
        _persist(pre_auth_id, {
            "ai_recommendation": "review",
            "ai_confidence": 0.0,
            "ai_rationale": rationale,
            "ai_decision_status": "auto_escalated",
            "ai_evaluated_at": datetime.now(timezone.utc).isoformat(),
        })
        audit.record_event(
            action="pre_auth_ai_escalated",
            category="pre_auth_ai_decision",
            tenant_type="insurer",
            tenant_id=insurer_id,
            target_type="pre_auth",
            target_id=pre_auth_id,
            summary=f"AI advisor escalated on guardrail: {guardrail['reason']}",
            metadata={"guardrail": guardrail, "mode": mode},
        )
        return {"ok": True, "mode": mode, "decision": "auto_escalated", "guardrail": guardrail}

    # 2. RAG + LLM.
    chunks = await _retrieve_policy_chunks(req, insurer_id)
    verdict, meta = await _run_llm(req, doc_text, chunks)

    recommendation = _normalise_recommendation(verdict.get("recommendation"))
    confidence = _normalise_confidence(verdict.get("confidence"))

    # 3. Citation verification.
    chunks_by_id = {c["id"]: c["content"] for c in chunks}
    citations_ok, citation_problems = _verify_citations(verdict, chunks_by_id)
    if not citations_ok:
        logger.info(
            f"pre_auth_advisor {pre_auth_id}: citation check failed — {citation_problems}"
        )

    # 4. Route.
    status = _route_decision(
        mode=mode,
        recommendation=recommendation,
        confidence=confidence,
        threshold=float(cfg.get("confidence_threshold") or 0.9),
        citations_ok=citations_ok,
    )

    rationale = {
        "mode": mode,
        "recommendation": recommendation,
        "confidence": confidence,
        "rationale": verdict.get("rationale"),
        "criteria_met": verdict.get("criteria_met") or [],
        "criteria_failed": verdict.get("criteria_failed") or [],
        "missing_information": verdict.get("missing_information") or [],
        "reviewer_notes": verdict.get("reviewer_notes"),
        "citations_ok": citations_ok,
        "citation_problems": citation_problems,
        "policy_chunks_retrieved": [c["id"] for c in chunks],
        "model_version": meta["model_version"],
        "latency_ms": meta["latency_ms"],
    }

    # 5. Persist + side effects.
    updates: dict = {
        "ai_recommendation": recommendation,
        "ai_confidence": confidence,
        "ai_rationale": rationale,
        "ai_decision_status": status,
        "ai_evaluated_at": datetime.now(timezone.utc).isoformat(),
    }
    if status == "auto_approved":
        updates["status"] = "approved"
    elif status == "auto_denied":
        updates["status"] = "denied"

    _persist(pre_auth_id, updates)

    authorization_info = None
    if status == "auto_approved":
        try:
            authorization_info = activate_authorization(pre_auth_id)
        except Exception as e:
            logger.error(f"auto-approval activation failed for {pre_auth_id}: {e}")
    elif status == "auto_denied":
        try:
            revoke_authorization(pre_auth_id)
        except Exception as e:
            logger.warning(f"auto-denial revoke (idempotent) failed: {e}")

    audit.record_ai_inference(
        event_type=f"pre_auth_ai_{status}",
        model_version=meta["model_version"],
        prompt_template_name="PRE_AUTH_ADVISOR_SYSTEM_PROMPT",
        input_data={
            "pre_auth_id": pre_auth_id,
            "procedures": _request_cpts(req),
            "diagnoses": req.get("diagnosis_codes"),
            "estimated_cost": req.get("claim_amount"),
            "documents_attached": len(docs),
            "policy_chunks_retrieved": [c["id"] for c in chunks],
        },
        output_data={
            "recommendation": recommendation,
            "confidence": confidence,
            "ai_decision_status": status,
            "citations_ok": citations_ok,
        },
        confidence_score=confidence,
        latency_ms=meta["latency_ms"],
        tenant_type="insurer",
        tenant_id=insurer_id,
        pre_auth_id=pre_auth_id,
        summary=f"Pre-auth AI advisor: {recommendation} @ {confidence:.2f} -> {status}",
    )

    return {
        "ok": True,
        "mode": mode,
        "decision": status,
        "recommendation": recommendation,
        "confidence": confidence,
        "authorization": authorization_info,
    }
