"""FastAPI lifespan — startup/shutdown hooks."""
from contextlib import asynccontextmanager
from fastapi import FastAPI
import logging

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Connect to MongoDB, create indexes, and warm caches on startup."""
    from app.core.database import connect_to_mongo, close_mongo_connection, get_database

    # Startup
    try:
        connect_to_mongo()
    except Exception as e:
        print(f"⚠️  MongoDB connection failed (continuing without it): {e}")
        print("⚠️  Only Places API endpoints will work")
        yield
        return

    db = get_database()

    # Ensure TTL index on capture_sessions (auto-delete after 48h)
    try:
        db["capture_sessions"].create_index(
            "createdAt", expireAfterSeconds=172800, background=True
        )
        logger.info("capture_sessions TTL index ensured")
    except Exception as e:
        logger.warning(f"Failed to create capture_sessions TTL index: {e}")

    yield  # App runs here

    # Shutdown
    close_mongo_connection()
    logger.info("Shutting down")
