import logging
from fastapi import APIRouter, Depends, HTTPException
from core.security import get_current_user
from core.database import supabase

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/user", tags=["user"])

@router.delete("/account")
async def delete_account(current_user = Depends(get_current_user)):
    user_id = current_user.id
    logger.info(f"Delete account request for user {user_id}")
    
    try:
        # 1. Nullify parent_org_id for any doctors linked to this provider
        supabase.table("profiles").update({"parent_org_id": None}).eq("parent_org_id", user_id).execute()
        
        # 2. Delete claims associated with this user (as doctor, clinic, or payer)
        supabase.table("claims").delete().or_(f"doctor_id.eq.{user_id},clinic_id.eq.{user_id},payer_id.eq.{user_id}").execute()
        
        # 3. Delete audit logs (if they exist separately or cascade from claims)
        # Note: If claims_audit cascades from claims, this might be redundant but safe
        supabase.table("claims_audit").delete().eq("user_id", user_id).execute()
        
        # 4. Delete the profile record
        supabase.table("profiles").delete().eq("id", user_id).execute()
        
        # 5. Delete from auth.users
        res = supabase.auth.admin.delete_user(user_id)
        if res.error:
            raise HTTPException(status_code=500, detail=f"Failed to delete account: {res.error}")
        return {"status": "success", "message": "Account deleted successfully"}
        
    except Exception as e:
        logger.error(f"Failed to delete account for user {user_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to delete account: {str(e)}")
