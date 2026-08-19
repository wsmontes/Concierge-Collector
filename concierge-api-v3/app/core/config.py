"""
Application configuration using Pydantic Settings
Loads from environment variables and .env file
Automatically detects localhost vs production environment
"""

from pydantic_settings import BaseSettings
from typing import List
import json
import logging
import os

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    """Application settings with validation"""

    # MongoDB
    mongodb_url: str
    mongodb_db_name: str = "concierge-collector"
    # Collections usa um banco lógico isolado, mas pode compartilhar o mesmo
    # cluster/URI operacional. A API o acessa somente para a projeção pública.
    cms_mongodb_db_name: str = "concierge-cms"
    # URI de leitura segregada para distribuição a consumidores. Em produção
    # esse usuário recebe apenas find no banco CMS; a API nunca é dona de
    # mutations nem de índices desse namespace.
    cms_mongodb_read_url: str = ""
    distribution_cursor_secret: str = ""
    # Distinct HMAC key for internal CMS catalog scans. It is unrelated to
    # JWTs, service authentication and consumer distribution cursors.
    catalog_cursor_secret: str = ""

    # API
    api_v3_host: str = "0.0.0.0"
    api_v3_port: int = 8000
    api_v3_reload: bool = True

    # CORS - parse JSON string from env
    cors_origins: str = (
        '["http://localhost:3000","http://localhost:5500","http://127.0.0.1:5500",'
        '"http://127.0.0.1:5501","http://localhost:8080","https://wsmontes.github.io"]'
    )

    # Environment (fail-safe default: production; dev-login e bypass de teste
    # só existem quando ENVIRONMENT=development explicitamente)
    environment: str = "production"

    # Google Places API
    google_places_api_key: str = ""

    # OpenAI API
    openai_api_key: str = ""

    # API Security
    api_secret_key: str = ""

    # Separação de segredos (2026-08-15, achado #11 do code review):
    # antes API_SECRET_KEY fazia papel duplo (chave do X-API-Key E segredo
    # HS256 dos JWTs). Agora cada poder tem sua config; o fallback legado
    # mantém transição com zero downtime (Render seta as novas vars).
    jwt_signing_secret: str = ""  # assina access/refresh/oauth state
    admin_api_keys: str = ""  # CSV de chaves válidas do X-API-Key
    admin_emails: str = ""  # CSV — substitui a regra automática @lotier.com

    # Google OAuth
    google_oauth_client_id: str = ""
    google_oauth_client_secret: str = ""
    google_oauth_redirect_uri: str = ""  # Will be auto-detected

    # Frontend URLs (localhost and production)
    frontend_url: str = "http://127.0.0.1:5500"
    frontend_url_production: str = "https://wsmontes.github.io/Concierge-Collector"

    # OAuth callback URL allowlist (JSON list of trusted frontend origins)
    trusted_callback_origins: str = "[]"

    # CMS / Payload handoff. These credentials are deliberately distinct from
    # both JWT signing and X-API-Key authorization.
    cms_admin_origin: str = ""
    cms_admin_callback_url: str = ""
    cms_service_key: str = ""
    cms_handoff_ttl_seconds: int = 120

    # Métricas são uma superfície operacional separada. Nunca reutilizar uma
    # API key, JWT ou credencial de serviço para expô-las.
    metrics_key: str = ""

    # JWT Token Settings
    access_token_expire_minutes: int = 60  # 1 hour
    refresh_token_expire_days: int = 30  # 30 days for refresh token

    def model_post_init(self, __context):
        """Called after model initialization - auto-detect environment"""
        # Check for deployment environment
        hostname = os.getenv("HOSTNAME", "")
        render_service = os.getenv("RENDER_SERVICE_NAME", "")

        is_pythonanywhere = "pythonanywhere" in hostname.lower() or os.path.exists("/home/wsmontes")
        is_render = bool(render_service) or "render" in hostname.lower()

        # Set redirect_uri based on environment if not already set
        if not self.google_oauth_redirect_uri:
            if is_render:
                object.__setattr__(
                    self,
                    "google_oauth_redirect_uri",
                    "https://concierge-collector.onrender.com/api/v3/auth/callback",
                )
            elif is_pythonanywhere:
                object.__setattr__(
                    self,
                    "google_oauth_redirect_uri",
                    "https://wsmontes.pythonanywhere.com/api/v3/auth/callback",
                )
            else:
                object.__setattr__(
                    self,
                    "google_oauth_redirect_uri",
                    "http://localhost:8000/api/v3/auth/callback",
                )

    @property
    def cors_origins_list(self) -> List[str]:
        """Parse CORS origins from comma-separated string or JSON"""
        try:
            # Try JSON first
            return json.loads(self.cors_origins)
        except Exception:
            # Fall back to comma-separated string
            origins = [origin.strip() for origin in self.cors_origins.split(",")]
            return origins if origins else ["http://localhost:3000"]

    @property
    def jwt_secret(self) -> str:
        """Segredo de assinatura dos JWTs — JWT_SIGNING_SECRET.

        O fallback legado no API_SECRET_KEY (poder duplo: quem tem a chave
        forja JWT de admin) agora só existe em development — achado #7 da
        auditoria 2026-08-18. Em produção, faltar JWT_SIGNING_SECRET é
        RuntimeError → 500 fail-closed (verificado no Render em 2026-08-18:
        a var está setada)."""
        if self.jwt_signing_secret:
            return self.jwt_signing_secret
        if self.environment == "development":
            logger.warning(
                "JWT_SIGNING_SECRET não configurado — usando API_SECRET_KEY como "
                "fallback (SOMENTE development; em produção isso é erro)"
            )
            return self.api_secret_key
        raise RuntimeError("JWT_SIGNING_SECRET não configurado em produção — configure no dashboard do Render")

    def _required_cms_setting(self, value: str, setting_name: str) -> str:
        if value:
            return value
        if self.environment == "production":
            raise RuntimeError(f"{setting_name} não configurado em produção")
        return value

    @property
    def cms_admin_origin_value(self) -> str:
        return self._required_cms_setting(self.cms_admin_origin, "CMS_ADMIN_ORIGIN")

    @property
    def cms_admin_callback_url_value(self) -> str:
        return self._required_cms_setting(self.cms_admin_callback_url, "CMS_ADMIN_CALLBACK_URL")

    @property
    def cms_service_key_value(self) -> str:
        return self._required_cms_setting(self.cms_service_key, "CMS_SERVICE_KEY")

    @property
    def cms_mongodb_read_url_value(self) -> str:
        return self._required_cms_setting(self.cms_mongodb_read_url, "CMS_MONGODB_READ_URL")

    @property
    def catalog_cursor_secret_value(self) -> str:
        return self._required_cms_setting(self.catalog_cursor_secret, "CATALOG_CURSOR_SECRET")

    @property
    def metrics_key_value(self) -> str:
        return self._required_cms_setting(self.metrics_key, "METRICS_KEY")

    @property
    def admin_api_key_list(self) -> List[str]:
        """Lista de chaves válidas do X-API-Key — ADMIN_API_KEYS (CSV).

        Fallback no API_SECRET_KEY só em development; em produção a lista
        fica vazia e get_admin_api_keys devolve 500 (fail-closed)."""
        if self.admin_api_keys:
            return [k.strip() for k in self.admin_api_keys.split(",") if k.strip()]
        if self.environment == "development":
            logger.warning(
                "ADMIN_API_KEYS não configurado — usando API_SECRET_KEY como " "chave única (SOMENTE development)"
            )
            return [self.api_secret_key] if self.api_secret_key else []
        logger.error("ADMIN_API_KEYS não configurado em produção — X-API-Key " "desabilitado (fail-closed)")
        return []

    def is_admin_email(self, email: str) -> bool:
        """ADMIN_EMAILS (allowlist explícita) é a única fonte de admin.

        A regra legada de domínio @lotier.com só existe em development
        (achado #7 da auditoria 2026-08-18) — em produção, sem allowlist
        configurada, NINGUÉM é admin por domínio (fail-closed; verificado:
        ADMIN_EMAILS está setada no Render)."""
        if self.admin_emails:
            allowlist = {e.strip().lower() for e in self.admin_emails.split(",") if e.strip()}
            return (email or "").lower() in allowlist
        if self.environment == "development":
            logger.warning("ADMIN_EMAILS não configurado — usando regra legada @lotier.com " "(SOMENTE development)")
            return bool(email) and email.lower().endswith("@lotier.com")
        logger.error("ADMIN_EMAILS não configurado em produção — nenhum email é admin " "por domínio (fail-closed)")
        return False

    @property
    def trusted_callback_origins_list(self) -> List[str]:
        """Parse trusted callback origins from JSON string, merge with frontend URLs."""
        try:
            explicit = json.loads(self.trusted_callback_origins)
        except (json.JSONDecodeError, TypeError):
            explicit = []
        # Always include the configured frontend URLs
        merged = set(explicit)
        if self.frontend_url:
            merged.add(self.frontend_url)
        if self.frontend_url_production:
            merged.add(self.frontend_url_production)
        return sorted(merged)

    class Config:
        env_file = ".env"
        case_sensitive = False
        extra = "ignore"  # Ignore extra fields from .env


settings = Settings()
