import logging
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from core.database import supabase
from core.security import get_current_user
from services import audit

logger = logging.getLogger(__name__)

class ReviewRequest(BaseModel):
    action: str
    reason: str
    # Optional free-text reason a reviewer can leave when they override an
    # auto-decision (or just want to leave a note for the submitter). The
    # submitter sees this on their pre-auth history page.
    override_reason: Optional[str] = None

# Dedicated router for Pre-Auth management and dashboard operations
router = APIRouter(prefix="/api/pre-auth", tags=["pre-auth"])

# Statuses that the AI pre-auth advisor has set automatically. When a reviewer
# decides differently we record `pre_auth_ai_override` and notify the submitter.
_AUTO_STATUSES = {"auto_approved", "auto_denied"}


@router.get("/queue")
async def get_pre_auth_queue(current_user = Depends(get_current_user)):
    """
    Fetches the Pre-Authorisation queue for the currently logged-in insurer.
    Used by the Medical Officers to see incoming cases and SLA timers. Each row
    carries the AI advisor's recommendation/confidence/status so the queue can
    surface auto-decisions and shadow-mode signals next to the manual list.
    """
    profile_res = supabase.table("profiles").select("insurer_id, role").eq("id", current_user.id).execute()

    if not profile_res.data or not profile_res.data[0].get("insurer_id"):
        raise HTTPException(status_code=403, detail="User is not associated with an insurer.")

    insurer_id = profile_res.data[0]["insurer_id"]

    try:
        queue_res = supabase.table("pre_auth_requests").select(
            "id, reference_number, provider_name, patient_name, patient_id, "
            "claim_amount, status, sla_deadline, created_at, "
            "ai_recommendation, ai_confidence, ai_decision_status, ai_evaluated_at"
        ).eq("insurer_id", insurer_id).order("created_at", desc=True).execute()

        return {"status": "success", "data": queue_res.data}
    except Exception as e:
        logger.error(f"Failed to fetch pre-auth queue for insurer {insurer_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch pre-auth queue.")


@router.get("/{id}")
async def get_pre_auth_detail(id: str, current_user = Depends(get_current_user)):
    """Returns a single pre-auth request plus its documents, scoped to the
    caller's insurer. The insurer review page uses this instead of a direct
    Supabase read: `pre_auth_requests` has no RLS read policy, so a browser
    query returns zero rows. Running it here with the service role (and a
    tenant check in code) is consistent with the queue endpoint.

    The AI advisor's full rationale + cited policy chunks come back on the
    request row (`ai_rationale`, etc.) — the reviewer UI renders them as the
    AI panel."""
    profile_res = supabase.table("profiles").select("insurer_id").eq("id", current_user.id).execute()
    if not profile_res.data or not profile_res.data[0].get("insurer_id"):
        raise HTTPException(status_code=403, detail="User is not associated with an insurer.")
    insurer_id = profile_res.data[0]["insurer_id"]

    req_res = (
        supabase.table("pre_auth_requests")
        .select("*")
        .eq("id", id)
        .eq("insurer_id", insurer_id)
        .maybe_single()
        .execute()
    )
    if not req_res or not getattr(req_res, "data", None):
        raise HTTPException(status_code=404, detail="Pre-authorisation request not found.")

    try:
        docs_res = (
            supabase.table("pre_auth_documents")
            .select("*")
            .eq("pre_auth_id", id)
            .execute()
        )
        documents = docs_res.data or []
    except Exception as e:
        logger.error(f"Failed to fetch documents for pre-auth {id}: {e}")
        documents = []

    return {"request": req_res.data, "documents": documents}


@router.get("/{id}/offline-packet")
async def get_offline_packet(id: str, current_user = Depends(get_current_user)):
    """Returns the offline-submission packet prepared for an out-of-network
    pre-auth request. Accessible to the submitter or anyone in their provider
    org. The packet itself lives on `pre_auth_requests.ai_rationale`."""
    req_res = (
        supabase.table("pre_auth_requests")
        .select("id, insurer_id, submitted_by, submitter_org, "
                "reference_number, ai_rationale, payer_name_raw")
        .eq("id", id)
        .maybe_single()
        .execute()
    )
    if not req_res or not getattr(req_res, "data", None):
        raise HTTPException(status_code=404, detail="Pre-authorisation request not found.")
    row = req_res.data

    if row.get("insurer_id"):
        raise HTTPException(
            status_code=400,
            detail="This request is in-network. The offline packet is only generated for out-of-network insurers.",
        )

    # Submitter or anyone in their org may download.
    profile_res = supabase.table("profiles").select(
        "provider_org_id, account_type"
    ).eq("id", current_user.id).maybe_single().execute()
    profile = (profile_res.data if profile_res else None) or {}
    submitter_id = row.get("submitted_by")
    submitter_org = row.get("submitter_org")
    is_submitter = submitter_id and str(submitter_id) == str(current_user.id)
    same_org = submitter_org and profile.get("provider_org_id") and str(profile["provider_org_id"]) == str(submitter_org)
    if not (is_submitter or same_org):
        raise HTTPException(status_code=403, detail="Not authorised to view this packet.")

    rationale = row.get("ai_rationale") or {}
    if rationale.get("mode") != "offline_packet":
        raise HTTPException(status_code=404, detail="Offline packet has not been generated yet for this request.")

    audit.record_event(
        action="pre_auth_offline_packet_downloaded",
        category="pre_auth_offline_packet",
        actor_id=current_user.id,
        target_type="pre_auth",
        target_id=id,
        summary=f"Offline packet downloaded for pre-auth {row.get('reference_number')}",
        metadata={"reference_number": row.get("reference_number")},
    )

    return {
        "reference_number": row.get("reference_number"),
        "payer_name": row.get("payer_name_raw"),
        "packet": rationale.get("packet") or {},
        "suggestions": rationale.get("suggestions") or [],
        "completeness_score": rationale.get("completeness_score"),
        "generated_at": rationale.get("generated_at"),
    }


@router.post("/{id}/review")
async def review_pre_auth(id: str, payload: ReviewRequest, current_user = Depends(get_current_user)):
    """Records the insurer reviewer's binding decision on a pre-auth request.

    The decision is binary — approve or deny. Approval activates the
    authorisation (stamps the validity window + approved-procedure scope onto
    the request's existing reference); denial revokes any authorisation that
    was activated earlier.

    When the AI advisor has previously auto-decided this request (status was
    `auto_approved` or `auto_denied`) and the reviewer's decision differs, we
    record an `pre_auth_ai_override` audit event, mark the row's
    `ai_decision_status` as `overridden`, store the override_reason, and stamp
    `sender_notified_at` so the submitter's history page surfaces the change.
    """
    profile_res = supabase.table("profiles").select("insurer_id").eq("id", current_user.id).execute()
    if not profile_res.data or not profile_res.data[0].get("insurer_id"):
        raise HTTPException(status_code=403, detail="Unauthorized")

    insurer_id = profile_res.data[0]["insurer_id"]

    raw = (payload.action or "").strip().lower()
    if raw in {"approve", "approved"}:
        decision, new_status = "approve", "approved"
    elif raw in {"deny", "denied", "reject", "rejected"}:
        decision, new_status = "deny", "denied"
    else:
        raise HTTPException(status_code=400, detail="action must be 'approve' or 'deny'.")

    # Load the current row so we know whether this is an override of an
    # AI auto-decision.
    existing_res = (supabase.table("pre_auth_requests")
                    .select("status, ai_decision_status, ai_recommendation, ai_rationale, submitted_by")
                    .eq("id", id)
                    .eq("insurer_id", insurer_id)
                    .maybe_single()
                    .execute())
    if not existing_res or not getattr(existing_res, "data", None):
        raise HTTPException(status_code=404, detail="Request not found or unauthorized.")
    existing = existing_res.data
    prev_ai_status = existing.get("ai_decision_status")
    prev_status = existing.get("status")
    is_override = (
        prev_ai_status in _AUTO_STATUSES
        and prev_status != new_status
    )

    now_iso = datetime.now(timezone.utc).isoformat()
    # The reviewer's reason feeds back to the submitter's pre-auth history page
    # on EVERY manual decision — not only on AI overrides (migration 019).
    updates: dict = {
        "status": new_status,
        "review_notes": (payload.reason or payload.override_reason or "").strip() or None,
        "reviewed_by": str(current_user.id),
        "reviewed_at": now_iso,
        "updated_at": now_iso,
    }
    if is_override:
        # Fold the override notice into ai_rationale so the submitter's history
        # page can render it without a separate notifications table.
        rationale = existing.get("ai_rationale") or {}
        if not isinstance(rationale, dict):
            rationale = {}
        rationale["override_notice"] = {
            "at": now_iso,
            "reason": (payload.override_reason or payload.reason or "").strip() or None,
            "overridden_from": prev_ai_status,
            "overridden_to": new_status,
            "reviewer_id": str(current_user.id),
        }
        updates["ai_rationale"] = rationale
        updates["ai_decision_status"] = "overridden"
        updates["decision_override_reason"] = payload.override_reason or None
        updates["sender_notified_at"] = now_iso

    update_res = (supabase.table("pre_auth_requests")
                  .update(updates)
                  .eq("id", id)
                  .eq("insurer_id", insurer_id)
                  .execute())
    if not update_res.data:
        raise HTTPException(status_code=404, detail="Request not found or unauthorized.")

    authorization: dict | None = None
    try:
        from services.authorization import activate_authorization, revoke_authorization
        if decision == "approve":
            authorization = activate_authorization(id)
        else:
            revoke_authorization(id)
    except Exception as e:
        logger.error(f"Authorization handling failed for pre-auth {id}: {e}")

    audit.record_event(
        action=f"pre_auth_{new_status}",
        category="decision",
        actor_id=current_user.id,
        tenant_type="insurer",
        tenant_id=insurer_id,
        target_type="pre_auth",
        target_id=id,
        summary=f"Pre-auth manually {new_status} by reviewer",
        metadata={
            "decision": decision,
            "reason": payload.reason,
            "authorization_activated": bool(authorization),
            "override_of_ai": is_override,
        },
    )
    if is_override:
        audit.record_event(
            action="pre_auth_ai_override",
            category="pre_auth_ai_override",
            actor_id=current_user.id,
            tenant_type="insurer",
            tenant_id=insurer_id,
            target_type="pre_auth",
            target_id=id,
            summary=f"Reviewer overrode AI {prev_ai_status} → {new_status}",
            metadata={
                "previous_ai_status": prev_ai_status,
                "new_status": new_status,
                "override_reason": payload.override_reason,
            },
        )

    return {
        "status": "success",
        "message": f"Request {new_status}.",
        "authorization": authorization,
        "ai_override_recorded": is_override,
    }
