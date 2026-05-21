"""Offline pre-auth packet generator for out-of-network insurers.

When a provider or doctor submits a pre-auth request to an insurer that is not
in our network (`insurer_id IS NULL`, `routing_status = 'unrouted'`), no policy
exists for us to evaluate against. We do NOT run the medical-necessity LLM and
we do NOT auto-decide.

What we DO offer in this case is a structured offline-submission packet: an
LLM extracts the clinical picture from the uploaded documents, drafts a clean
cover letter + clinical summary the submitter can email to the insurer
themselves, and lists concrete suggestions for strengthening the request
(missing fields, weak justification, supporting documents to attach).

The packet is persisted on `pre_auth_requests.ai_rationale` under
`{"mode": "offline_packet", "packet": {...}, "suggestions": [...]}` so the
provider's history page can surface it and the new
`GET /api/pre-auth/{id}/offline-packet` endpoint can return it.
"""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from typing import Optional

from core.config import Config
from core.database import supabase
from services import audit
from services.ai_services import get_llm, parse_llm_json
from langchain_core.messages import HumanMessage, SystemMessage

logger = logging.getLogger(__name__)

OFFLINE_PACKET_PROMPT = """You are ClaimRidge AI, helping a provider or doctor in the MENA region prepare a clean pre-authorisation packet to send DIRECTLY to an insurer that is not in our network. There is no policy on file for us to check the request against. You are NOT deciding anything — you are drafting the packet the submitter will email to the insurer themselves and listing concrete improvements they could make to strengthen it.

## Inputs you are given
- The structured pre-auth packet the submitter typed into our form.
- The OCR'd text of every clinical document they attached.
- The free-text payer name (we do not know this insurer).

## OUTPUT
Respond ONLY with valid JSON, no commentary:
{{
  "cover_letter": "A short, professional cover letter (3-5 sentences) the submitter can paste into an email. Address it to the medical-review department; sign off with the ordering provider's name if known.",
  "clinical_summary": "A 1-paragraph clinical summary in plain professional English: patient (initials only, no full name), age/sex, presenting condition, ICD-10 diagnosis, requested CPT procedure, why the procedure is indicated, relevant prior treatments tried or contraindications.",
  "structured_packet": {{
    "patient": {{ "initials": "...", "age": "...", "sex": "...", "member_id_masked": "***last4 only" }},
    "diagnosis": "ICD-10 code(s) with description",
    "requested_procedure": "CPT code(s) with description",
    "place_of_service": "...",
    "anticipated_date_of_service": "...",
    "ordering_provider": "Name and NPI if available",
    "servicing_provider": "Facility name"
  }},
  "suggestions": [
    "Each suggestion is one specific, actionable thing the submitter should add or fix BEFORE sending — e.g. 'Add the most recent imaging report; the request references an MRI finding but no MRI report is attached.' Do NOT include generic advice like 'be thorough'."
  ],
  "completeness_score": 0.0
}}

`completeness_score` is between 0 and 1 — how complete and convincing the packet is right now. Suggestions should explain how to raise that score. Mask patient identifiers (full name, full member ID, national ID) — use initials and last-4 only.
"""


def _build_input_for_prompt(req: dict, doc_text: str, payer_name: str) -> dict:
    return {
        "payer_name": payer_name,
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
            "specialty": req.get("provider_specialty"),
        },
        "diagnoses_icd10": req.get("diagnosis_codes") or (
            [req["diagnosis_code"]] if req.get("diagnosis_code") else []
        ),
        "procedures_cpt": req.get("procedure_codes") or (
            [req["procedure_code"]] if req.get("procedure_code") else []
        ),
        "place_of_service": req.get("place_of_service"),
        "anticipated_date_of_service": req.get("anticipated_date_of_service"),
        "priority": req.get("priority"),
        "clinical_notes": (doc_text or "")[:10000],
    }


async def prepare_offline_packet(pre_auth_id: str) -> dict:
    """Top-level orchestrator for the out-of-network case. Never raises."""
    res = (supabase.table("pre_auth_requests")
           .select("*")
           .eq("id", pre_auth_id)
           .maybe_single()
           .execute())
    if not res or not getattr(res, "data", None):
        return {"ok": False, "error": "pre_auth_not_found"}
    req = res.data

    if req.get("insurer_id"):
        # Routed requests go through pre_auth_advisor, not this module.
        return {"ok": False, "error": "not_unrouted"}

    try:
        docs_res = (supabase.table("pre_auth_documents")
                    .select("file_name, extracted_text")
                    .eq("pre_auth_id", pre_auth_id)
                    .execute())
        docs = docs_res.data or []
    except Exception as e:
        logger.warning(f"offline_packet: could not load documents for {pre_auth_id}: {e}")
        docs = []
    doc_text = "\n\n".join(
        f"--- {d['file_name']} ---\n{d.get('extracted_text') or ''}"
        for d in docs if d.get("extracted_text")
    )

    payer_name = req.get("payer_name_raw") or "the insurer"
    started = time.time()
    messages = [
        SystemMessage(content=OFFLINE_PACKET_PROMPT),
        HumanMessage(content=(
            "Prepare an offline pre-authorisation packet for the following "
            "request and respond as JSON:\n\n"
            + json.dumps(_build_input_for_prompt(req, doc_text, payer_name), indent=2, default=str)
        )),
    ]
    try:
        llm = get_llm(json_mode=True)
        response = await llm.ainvoke(messages)
        packet = parse_llm_json(response.content)
        if not isinstance(packet, dict):
            raise ValueError("response was not a JSON object")
    except Exception as e:
        logger.error(f"offline_packet LLM failed for {pre_auth_id}: {e}")
        packet = {
            "cover_letter": "",
            "clinical_summary": "",
            "structured_packet": {},
            "suggestions": [
                "The AI assistant could not prepare a draft right now. "
                "Please review the attached documents and write the cover letter manually."
            ],
            "completeness_score": 0.0,
        }
    latency_ms = int((time.time() - started) * 1000)

    rationale = {
        "mode": "offline_packet",
        "packet": packet,
        "suggestions": packet.get("suggestions") or [],
        "completeness_score": packet.get("completeness_score"),
        "payer_name": payer_name,
        "model_version": Config.LLM_MODEL,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "latency_ms": latency_ms,
    }

    try:
        supabase.table("pre_auth_requests").update({
            "ai_rationale": rationale,
            "ai_decision_status": "advisory",  # never auto-decides for out-of-network
            "ai_recommendation": None,
            "ai_evaluated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", pre_auth_id).execute()
    except Exception as e:
        logger.error(f"offline_packet persist failed for {pre_auth_id}: {e}")

    audit.record_ai_inference(
        event_type="pre_auth_offline_packet",
        model_version=Config.LLM_MODEL,
        prompt_template_name="OFFLINE_PACKET_PROMPT",
        input_data={
            "pre_auth_id": pre_auth_id,
            "documents_attached": len(docs),
            "payer_name": payer_name,
        },
        output_data={
            "completeness_score": packet.get("completeness_score"),
            "suggestion_count": len(packet.get("suggestions") or []),
        },
        latency_ms=latency_ms,
        tenant_type=None,
        tenant_id=None,
        pre_auth_id=pre_auth_id,
        summary="Out-of-network pre-auth: offline packet drafted for submitter",
    )

    return {"ok": True, "packet": packet, "rationale": rationale}
