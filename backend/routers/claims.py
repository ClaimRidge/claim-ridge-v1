import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import json
import time
import random
import string
from core.security import get_current_user
from core.database import supabase

# Updated imports matching the new ai_services.py
from services.ai_services import extract_claim_from_document, scrub_claim

logger = logging.getLogger(__name__)

# --- Pydantic Models ---
class ExtractRequest(BaseModel):
    fileBase64: str
    mediaType: str
    fileName: str

class ClaimFormData(BaseModel):
    patient_name: str
    patient_id: str
    date_of_service: str
    provider_name: str
    provider_id: str
    payer_name: str
    payer_id: str
    diagnosis_codes: List[str]
    procedure_codes: List[str]
    billed_amount: float
    notes: Optional[str] = ""

# --- Router ---
router = APIRouter(prefix="/api/claims", tags=["claims"])

def generate_claim_number():
    timestamp = str(int(time.time() * 1000))
    rand_str = ''.join(random.choices(string.ascii_uppercase + string.digits, k=4))
    return f"CLM-{timestamp}-{rand_str}"

@router.post("/extract")
async def extract_claim(payload: ExtractRequest, current_user = Depends(get_current_user)):
    logger.info(f"Extract claim request from user {current_user.id}, file: {payload.fileName}")
    if not payload.fileBase64 or not payload.mediaType:
        logger.warning("Extract claim request missing file data or media type")
        raise HTTPException(status_code=400, detail="Missing file data or media type")

    try:
        logger.debug(f"Processing document extraction with media type: {payload.mediaType}")
        # Calls the updated function with base64 and mediaType
        extracted = await extract_claim_from_document(payload.fileBase64, payload.mediaType)
        logger.info(f"Successfully extracted claim data from {payload.fileName}")
        return {"extracted": extracted, "fileName": payload.fileName}
    except Exception as e:
        logger.error(f"Document extraction failed: {str(e)}")
        raise HTTPException(status_code=422, detail=f"Could not parse the document: {str(e)}")

@router.post("/scrub")
async def scrub_claim_endpoint(claim_data: ClaimFormData, current_user = Depends(get_current_user)):
    user_id = current_user.id
    logger.info(f"Scrub claim request from user {user_id}, patient: {claim_data.patient_name}")
    
    # 1. Save Initial Draft Claim to DB
    claim_payload = claim_data.model_dump()
    claim_number = generate_claim_number()
    claim_payload.update({
        "user_id": user_id,
        "clinic_id": user_id,
        "status": "pending",
        "claim_number": claim_number
    })
    
    logger.debug(f"Saving draft claim {claim_number} to database")
    insert_res = supabase.table("claims").insert(claim_payload).execute()
    if not insert_res.data:
        logger.error("Failed to save draft claim to database")
        raise HTTPException(status_code=500, detail="Failed to save claim")
    
    claim_id = insert_res.data[0]["id"]
    logger.info(f"Draft claim saved with ID: {claim_id}, claim number: {claim_number}")
    
    # 2. Process via AI Service
    try:
        logger.debug(f"Starting AI scrub for claim {claim_id}")
        # Calls the updated scrub function and passes the dictionary directly
        scrub_result = await scrub_claim(claim_data.model_dump())
        logger.info(f"AI scrub completed for claim {claim_id}, status: {scrub_result.get('status')}, score: {scrub_result.get('overall_score')}")
    except Exception as e:
        logger.error(f"AI scrub failed for claim {claim_id}: {str(e)}")
        scrub_result = {
            "status": "warnings", 
            "overall_score": 70, 
            "issues": [{
                "field": "general", 
                "severity": "warning", 
                "message": f"AI scrubbing completed but response parsing failed. Error: {str(e)}", 
                "suggestion": "Please review the claim manually or try re-scrubbing."
            }],
            "corrected_claim": claim_data.model_dump(),
            "recommendations": ["Manual review recommended due to processing irregularity."]
        }
    
    # 3. Update the Claim with Scrub Results
    logger.debug(f"Updating claim {claim_id} with scrub results")
    supabase.table("claims").update({
        "status": "submitted",
        "scrub_result": scrub_result,
        "scrub_passed": scrub_result.get("status") == "clean",
        "scrub_warnings": len(scrub_result.get("issues", []))
    }).eq("id", claim_id).execute()
    logger.info(f"Claim {claim_id} marked as submitted")

    # 4. Trigger Internal Auto-Adjudicate
    logger.debug(f"Triggering auto-adjudication for claim {claim_id}")
    from routers.insurer import run_auto_adjudicate
    await run_auto_adjudicate(claim_id, user_id)
    
    # 5. Insert Audit Trail
    claim_reference = f"CR-{claim_id[:8].upper()}"
    audit_payload = {
        "user_id": user_id,
        "claim_reference_number": claim_reference,
        "patient_name": claim_data.patient_name,
        "date_of_service": claim_data.date_of_service or None,
        "provider_name": claim_data.provider_name,
        "payer_name": claim_data.payer_name,
        "diagnosis_codes": [c for c in claim_data.diagnosis_codes if c],
        "procedure_codes": [c for c in claim_data.procedure_codes if c],
        "billed_amount": claim_data.billed_amount,
        "ai_flags": scrub_result.get("issues", []),
        "ai_corrections": scrub_result.get("corrected_claim", {}),
        "export_count": 0,
    }
    
    try:
        logger.debug(f"Creating audit trail for claim {claim_reference}")
        supabase.table("claims_audit").insert(audit_payload).execute()
        logger.info(f"Audit trail created for claim {claim_reference}")
    except Exception as e:
        logger.error(f"Failed to create audit trail for claim {claim_reference}: {e}")
    
    logger.info(f"Claim scrubbing process completed for {claim_id}")
    return {"id": claim_id, **scrub_result}

@router.post("/{id}/track-export")
async def track_export(id: str, current_user = Depends(get_current_user)):
    logger.info(f"Track export request from user {current_user.id} for claim {id}")
    reference = f"CR-{id[:8].upper()}"
    res = supabase.table("claims_audit").select("id, export_count").eq("claim_reference_number", reference).eq("user_id", current_user.id).execute()
    
    if not res.data:
        logger.warning(f"Audit row not found for claim {reference}")
        raise HTTPException(status_code=404, detail="Audit row not found")
        
    row = res.data[0]
    new_count = (row.get("export_count") or 0) + 1
    
    logger.debug(f"Updating export count to {new_count} for claim {reference}")
    supabase.table("claims_audit").update({"export_count": new_count}).eq("id", row["id"]).execute()
    logger.info(f"Export tracked for claim {reference}, count: {new_count}")
    return {"export_count": new_count}