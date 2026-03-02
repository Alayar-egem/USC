from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parents[2]  # backend/

class Settings(BaseSettings):
    """
    All values are read from environment variables (see backend/.env).

    Minimal SMTP for real emails:
      - SMTP_HOST: e.g. smtp.gmail.com
      - SMTP_PORT: usually 587 (STARTTLS) or 465 (SSL)
      - SMTP_USER: your mailbox login (often the full email)
      - SMTP_PASSWORD: mailbox password or (recommended) an *App Password*
      - SMTP_FROM: sender email shown in письме (often same as SMTP_USER)
    """
    DATABASE_URL: str
    API_PREFIX: str = "/api"

    JWT_SECRET_KEY: str = "dev-jwt-secret"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRES_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRES_DAYS: int = 30

    REDIS_URL: str = ""
    REDIS_PREFIX: str = "usc"
    REDIS_TIMEOUT_SECONDS: float = 1.5

    CACHE_TTL_CATEGORIES: int = 180
    CACHE_TTL_PRODUCTS: int = 45
    CACHE_TTL_COMPANIES: int = 60
    CACHE_TTL_MEMBERSHIPS: int = 60
    CACHE_TTL_SUPPLIERS: int = 60
    CACHE_TTL_PROFILE_ME: int = 60
    CACHE_TTL_NOTIFICATIONS: int = 45
    CACHE_TTL_ORDERS_LIST: int = 30
    CACHE_TTL_ORDER_DETAIL: int = 30
    CACHE_TTL_ORDERS_BOX: int = 30
    CACHE_TTL_DELIVERIES: int = 45
    CACHE_TTL_ANALYTICS_SUMMARY: int = 45
    CACHE_TTL_ANALYTICS_INSIGHTS: int = 120
    CACHE_TTL_ANALYTICS_ASSISTANT: int = 45

    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = ""
    SMTP_STARTTLS: bool = True
    SMTP_USE_SSL: bool = False
    EMAIL_CODE_EXPIRES_SECONDS: int = 300
    EMAIL_CODE_LENGTH: int = 6
    EMAIL_CODE_DEV_FALLBACK: bool = True

    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = "gpt-4o-mini"
    OPENAI_BASE_URL: str = "https://api.openai.com/v1"
    OPENAI_TIMEOUT_SECONDS: float = 20.0

    # Auth security controls
    RATE_LIMIT_ENABLED: bool = True
    RATE_LIMIT_FAIL_CLOSED: bool = False
    CAPTCHA_PROVIDER: str = "stub"
    CAPTCHA_STUB_TOKEN: str = "pass-captcha"
    CAPTCHA_REQUIRED_TTL_SECONDS: int = 86400
    AUTH_FAIL_WINDOW_SECONDS: int = 86400
    AUTH_FAIL_THRESHOLD: int = 5
    AUTH_LOCKOUT_STEP1_SECONDS: int = 900
    AUTH_LOCKOUT_STEP2_SECONDS: int = 3600
    AUTH_LOCKOUT_STEP3_SECONDS: int = 86400
    IDEMPOTENCY_TTL_HOURS: int = 24
    METRICS_ENABLED: bool = True

    SENTRY_DSN_BACKEND: str = ""
    SENTRY_ENVIRONMENT: str = "dev"
    SENTRY_RELEASE: str = ""
    SENTRY_TRACES_SAMPLE_RATE: float = 0.0

    model_config = SettingsConfigDict(
        env_file=str(BASE_DIR / ".env"),
        extra="ignore",
    )

settings = Settings()
