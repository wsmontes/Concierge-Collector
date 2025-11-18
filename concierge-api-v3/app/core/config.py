"""
Application configuration using Pydantic Settings
Loads from environment variables and .env file
"""

from pydantic_settings import BaseSettings
from typing import List
import json


class Settings(BaseSettings):
    """Application settings with validation"""
    
    # MongoDB
    mongodb_url: str
    mongodb_db_name: str = "concierge-collector"
    
    # API
    api_v3_host: str = "0.0.0.0"
    api_v3_port: int = 8000
    api_v3_reload: bool = True
    
    # CORS - parse JSON string from env
    cors_origins: str = '["http://localhost:3000","http://localhost:5500","http://127.0.0.1:5500","http://127.0.0.1:5501"]'
    
    # Environment
    environment: str = "development"
    
    # Google Places API
    google_places_api_key: str = ""
    
    # OpenAI API
    openai_api_key: str = ""
    
    # API Security
    api_secret_key: str = ""
    
    @property
    def cors_origins_list(self) -> List[str]:
        """Parse CORS origins from comma-separated string or JSON"""
        try:
            # Try JSON first
            return json.loads(self.cors_origins)
        except:
            # Fall back to comma-separated string
            origins = [origin.strip() for origin in self.cors_origins.split(',')]
            return origins if origins else ["http://localhost:3000"]
    
    class Config:
        env_file = ".env"
        case_sensitive = False
        extra = "ignore"  # Ignore extra fields from .env


settings = Settings()
