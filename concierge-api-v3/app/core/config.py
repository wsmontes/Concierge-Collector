"""
Application configuration using Pydantic Settings
Loads from environment variables and .env file
Automatically detects localhost vs production environment
"""

from pydantic_settings import BaseSettings
from typing import List
import json
import os


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
    cors_origins: str = '["http://localhost:3000","http://localhost:5500","http://127.0.0.1:5500","http://127.0.0.1:5501","http://localhost:8080","https://wsmontes.github.io"]'
    
    # Environment
    environment: str = "development"
    
    # Google Places API
    google_places_api_key: str = ""
    
    # OpenAI API
    openai_api_key: str = ""
    
    # API Security
    api_secret_key: str = ""
    
    # Google OAuth
    google_oauth_client_id: str = ""
    google_oauth_client_secret: str = ""
    google_oauth_redirect_uri: str = ""  # Will be auto-detected
    
    # Frontend URLs (localhost and production)
    frontend_url: str = "http://127.0.0.1:5500"
    frontend_url_production: str = "https://wsmontes.github.io/Concierge-Collector"
    
    # JWT Token Settings
    access_token_expire_minutes: int = 60  # 1 hour
    refresh_token_expire_days: int = 30  # 30 days for refresh token
    
    def model_post_init(self, __context):
        """Called after model initialization - auto-detect environment"""
        # Check for PythonAnywhere environment
        hostname = os.getenv('HOSTNAME', '')
        is_pythonanywhere = 'pythonanywhere' in hostname.lower() or os.path.exists('/home/wsmontes')
        
        # Set redirect_uri based on environment if not already set
        if not self.google_oauth_redirect_uri:
            if is_pythonanywhere:
                object.__setattr__(self, 'google_oauth_redirect_uri', 
                                 "https://wsmontes.pythonanywhere.com/api/v3/auth/callback")
            else:
                object.__setattr__(self, 'google_oauth_redirect_uri',
                                 "http://localhost:8000/api/v3/auth/callback")
    
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
