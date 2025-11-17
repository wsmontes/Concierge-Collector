"""
app/core/config.py

Purpose: Application settings and configuration management
Responsibilities:
  - Load environment variables
  - Validate configuration
  - Provide settings singleton
Dependencies: pydantic-settings
"""

from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List


class Settings(BaseSettings):
    """Application settings loaded from environment variables"""

    # Environment
    environment: str = "development"

    # MongoDB
    mongodb_url: str = "mongodb://localhost:27017"
    mongodb_db_name: str = "concierge_collector_v4"
    mongodb_atlas_username: str = ""
    mongodb_atlas_password: str = ""

    # API
    api_v4_url: str = "http://localhost:8000"
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    api_reload: bool = True

    # Security
    secret_key: str
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 10080  # 7 days

    # CORS
    cors_origins: str = "http://localhost:3000,http://localhost:5500,http://127.0.0.1:5500"
    
    @property
    def cors_origins_list(self) -> List[str]:
        """Parse CORS origins from comma-separated string"""
        return [origin.strip() for origin in self.cors_origins.split(",")]

    # Development Mode
    dev_mode: bool = False
    dev_user_id: str = "dev_curator"
    dev_user_email: str = "dev@example.com"

    # Logging
    log_level: str = "INFO"

    # MongoDB Indexes
    create_indexes_on_startup: bool = True

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )


# Create settings singleton
settings = Settings()
