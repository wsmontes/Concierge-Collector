"""
Smart Environment Configuration for Concierge Collector API V3
Automatically detects and configures for different deployment environments:
- Local development (localhost)
- PythonAnywhere production
- Docker containers
- Other cloud platforms

No manual configuration needed - just set one environment variable!
"""

from pydantic_settings import BaseSettings
from pydantic import field_validator
from typing import List
import json
import os
import socket


class EnvironmentDetector:
    """Automatically detects the current deployment environment"""
    
    @staticmethod
    def detect() -> str:
        """
        Detect environment based on various indicators
        
        Returns:
            str: 'development', 'pythonanywhere', 'docker', or 'production'
        """
        # Check explicit environment variable first
        env = os.getenv('ENVIRONMENT', '').lower()
        if env in ['development', 'pythonanywhere', 'docker', 'production']:
            return env
        
        # Auto-detect PythonAnywhere
        if EnvironmentDetector.is_pythonanywhere():
            return 'pythonanywhere'
        
        # Auto-detect Docker
        if EnvironmentDetector.is_docker():
            return 'docker'
        
        # Check for common production indicators
        if EnvironmentDetector.is_production():
            return 'production'
        
        # Default to development
        return 'development'
    
    @staticmethod
    def is_pythonanywhere() -> bool:
        """Detect if running on PythonAnywhere"""
        indicators = [
            os.path.exists('/home/wsmontes'),  # User home directory
            'pythonanywhere' in socket.gethostname().lower(),
            'PYTHONANYWHERE_SITE' in os.environ,
            'PYTHONANYWHERE_DOMAIN' in os.environ,
        ]
        return any(indicators)
    
    @staticmethod
    def is_docker() -> bool:
        """Detect if running in Docker container"""
        indicators = [
            os.path.exists('/.dockerenv'),
            os.path.exists('/run/.containerenv'),
            os.getenv('DOCKER_CONTAINER') == 'true',
        ]
        return any(indicators)
    
    @staticmethod
    def is_production() -> bool:
        """Detect if running in production (non-local) environment"""
        indicators = [
            os.getenv('PROD') == 'true',
            os.getenv('NODE_ENV') == 'production',
            not os.getenv('DEBUG'),
        ]
        return any(indicators)
    
    @staticmethod
    def get_base_url() -> str:
        """Get the base URL for API based on environment"""
        env = EnvironmentDetector.detect()
        
        if env == 'pythonanywhere':
            return 'https://wsmontes.pythonanywhere.com'
        elif env == 'docker':
            return os.getenv('API_BASE_URL', 'http://localhost:8000')
        elif env == 'production':
            return os.getenv('API_BASE_URL', 'https://api.example.com')
        else:  # development
            return 'http://localhost:8000'
    
    @staticmethod
    def get_frontend_url() -> str:
        """Get the frontend URL based on environment"""
        env = EnvironmentDetector.detect()
        
        if env == 'pythonanywhere':
            return 'https://wsmontes.github.io/Concierge-Collector'
        elif env == 'docker':
            return os.getenv('FRONTEND_URL', 'http://localhost:8080')
        elif env == 'production':
            return os.getenv('FRONTEND_URL', 'https://example.com')
        else:  # development
            return 'http://localhost:8080'


class Settings(BaseSettings):
    """
    Smart application settings with automatic environment detection
    
    Priority order for configuration:
    1. Explicit environment variables
    2. .env file
    3. Auto-detected defaults based on environment
    """
    
    # Environment (auto-detected if not set)
    environment: str = EnvironmentDetector.detect()
    
    # MongoDB - Required in all environments
    mongodb_url: str
    mongodb_db_name: str = "concierge-collector"
    
    # API Configuration - Auto-configured based on environment
    api_v3_host: str = "0.0.0.0"
    api_v3_port: int = 8000
    api_v3_reload: bool = True  # Auto-set to False in production
    
    # CORS - Auto-configured based on environment
    cors_origins: str = ""  # Auto-populated if empty
    
    # Google Places API
    google_places_api_key: str = ""
    
    # OpenAI API
    openai_api_key: str = ""
    
    # API Security - Required in production
    api_secret_key: str = ""
    
    # Google OAuth - Auto-configured redirect URI
    google_oauth_client_id: str = ""
    google_oauth_client_secret: str = ""
    google_oauth_redirect_uri: str = ""  # Auto-populated
    
    # Frontend URLs - Auto-configured
    frontend_url: str = ""  # Auto-populated
    frontend_url_production: str = ""  # Auto-populated
    
    # JWT Token Settings
    access_token_expire_minutes: int = 60
    refresh_token_expire_days: int = 30
    
    def model_post_init(self, __context):
        """Auto-configure settings based on detected environment"""
        
        # Disable reload in production environments
        if self.environment in ['pythonanywhere', 'production']:
            object.__setattr__(self, 'api_v3_reload', False)
        
        # Auto-configure OAuth redirect URI
        if not self.google_oauth_redirect_uri:
            base_url = EnvironmentDetector.get_base_url()
            redirect_uri = f"{base_url}/api/v3/auth/callback"
            object.__setattr__(self, 'google_oauth_redirect_uri', redirect_uri)
        
        # Auto-configure frontend URLs
        if not self.frontend_url:
            if self.environment == 'development':
                object.__setattr__(self, 'frontend_url', 'http://localhost:8080')
            else:
                object.__setattr__(self, 'frontend_url', EnvironmentDetector.get_frontend_url())
        
        if not self.frontend_url_production:
            object.__setattr__(self, 'frontend_url_production', EnvironmentDetector.get_frontend_url())
        
        # Auto-configure CORS origins
        if not self.cors_origins:
            origins = self._get_default_cors_origins()
            object.__setattr__(self, 'cors_origins', ','.join(origins))
    
    def _get_default_cors_origins(self) -> List[str]:
        """Get default CORS origins based on environment"""
        if self.environment == 'development':
            return [
                'http://localhost:3000',
                'http://localhost:5500',
                'http://localhost:8080',
                'http://127.0.0.1:5500',
                'http://127.0.0.1:5501',
                'http://127.0.0.1:8080',
            ]
        elif self.environment == 'pythonanywhere':
            return [
                'https://wsmontes.github.io',
                'https://wsmontes.pythonanywhere.com',
                'http://localhost:8080',  # Still allow local testing
            ]
        elif self.environment == 'docker':
            return [
                'http://localhost:8080',
                'http://frontend:8080',
                os.getenv('FRONTEND_URL', 'http://localhost:8080'),
            ]
        else:  # production
            return [
                self.frontend_url_production,
                os.getenv('FRONTEND_URL', 'https://example.com'),
            ]
    
    @property
    def cors_origins_list(self) -> List[str]:
        """Parse CORS origins to list"""
        if not self.cors_origins:
            return self._get_default_cors_origins()
        
        # Handle both comma-separated and JSON formats
        try:
            return json.loads(self.cors_origins)
        except:
            return [origin.strip() for origin in self.cors_origins.split(',') if origin.strip()]
    
    @property
    def is_development(self) -> bool:
        """Check if running in development mode"""
        return self.environment == 'development'
    
    @property
    def is_production(self) -> bool:
        """Check if running in any production environment"""
        return self.environment in ['pythonanywhere', 'production', 'docker']
    
    @field_validator('api_secret_key')
    def validate_secret_key(cls, v, info):
        """Validate secret key in production environments"""
        environment = info.data.get('environment', 'development')
        if environment in ['pythonanywhere', 'production'] and len(v) < 32:
            raise ValueError(
                'API_SECRET_KEY must be at least 32 characters in production. '
                'Generate one with: python -c "import secrets; print(secrets.token_urlsafe(32))"'
            )
        return v
    
    @field_validator('mongodb_url')
    def validate_mongodb_url(cls, v):
        """Validate MongoDB URL is set"""
        if not v or v == 'mongodb://localhost:27017':
            raise ValueError(
                'MONGODB_URL must be configured. '
                'Use MongoDB Atlas or a local MongoDB instance.'
            )
        return v
    
    def get_log_level(self) -> str:
        """Get appropriate log level for environment"""
        if self.is_development:
            return os.getenv('LOG_LEVEL', 'DEBUG')
        else:
            return os.getenv('LOG_LEVEL', 'INFO')
    
    def get_db_pool_config(self) -> dict:
        """Get MongoDB connection pool configuration for environment"""
        if self.is_development:
            return {
                'maxPoolSize': 5,
                'minPoolSize': 1,
                'maxIdleTimeMS': 30000,
            }
        else:  # production
            return {
                'maxPoolSize': 10,
                'minPoolSize': 2,
                'maxIdleTimeMS': 45000,
                'serverSelectionTimeoutMS': 5000,
            }
    
    def display_config(self) -> str:
        """Display current configuration (sanitized)"""
        def sanitize(value: str, show_chars: int = 10) -> str:
            """Show only first N characters of sensitive values"""
            if not value or len(value) <= show_chars:
                return value
            return f"{value[:show_chars]}...({len(value)} chars)"
        
        return f"""
╔══════════════════════════════════════════════════════════════╗
║          Concierge Collector API V3 Configuration            ║
╚══════════════════════════════════════════════════════════════╝

Environment: {self.environment.upper()}
Base URL: {EnvironmentDetector.get_base_url()}
Frontend URL: {self.frontend_url}

MongoDB:
  URL: {sanitize(self.mongodb_url, 30)}
  Database: {self.mongodb_db_name}

API:
  Host: {self.api_v3_host}
  Port: {self.api_v3_port}
  Reload: {self.api_v3_reload}
  Log Level: {self.get_log_level()}

CORS Origins:
{chr(10).join(f'  - {origin}' for origin in self.cors_origins_list[:5])}
{f'  ... and {len(self.cors_origins_list) - 5} more' if len(self.cors_origins_list) > 5 else ''}

OAuth:
  Client ID: {sanitize(self.google_oauth_client_id, 20)}
  Redirect URI: {self.google_oauth_redirect_uri}

APIs:
  Google Places: {'✓ Configured' if self.google_places_api_key else '✗ Not configured'}
  OpenAI: {'✓ Configured' if self.openai_api_key else '✗ Not configured'}
  Secret Key: {'✓ Configured' if self.api_secret_key else '✗ Not configured'}

JWT:
  Access Token Expiry: {self.access_token_expire_minutes} minutes
  Refresh Token Expiry: {self.refresh_token_expire_days} days

╚══════════════════════════════════════════════════════════════╝
"""
    
    class Config:
        env_file = ".env"
        case_sensitive = False
        extra = "ignore"


# Create settings instance
settings = Settings()

# Print configuration on import (only in development)
if settings.is_development:
    print(settings.display_config())
