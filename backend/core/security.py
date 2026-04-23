import logging
from fastapi import Request, HTTPException, Security
from fastapi.security import HTTPBearer
from core.database import supabase

logger = logging.getLogger(__name__)
security = HTTPBearer()

async def get_current_user(credentials = Security(security)):
    token = credentials.credentials
    try:
        logger.debug("Attempting to authenticate user with JWT token")
        # Verify the JWT using Supabase
        user = supabase.auth.get_user(token)
        if not user:
            logger.warning("Authentication failed: Invalid or expired token")
            raise HTTPException(status_code=401, detail="Invalid authentication credentials")
        logger.info(f"User authenticated successfully: {user.user.id}")
        return user.user
    except Exception as e:
        logger.error(f"Authentication error: {str(e)}")
        raise HTTPException(status_code=401, detail=str(e))