import logging
from core.config import Config
from supabase import create_client, Client

logger = logging.getLogger(__name__)

logger.info("Initializing Supabase client")
supabase: Client = create_client(Config.SUPABASE_URL, Config.SUPABASE_KEY)
logger.info("Supabase client initialized successfully")