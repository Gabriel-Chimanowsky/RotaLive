from pydantic_settings import BaseSettings
from typing import List
import os


class Settings(BaseSettings):
    # Security
    SECRET_KEY: str = "dev-secret-key-change-in-production-!!!"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440

    # Database
    DATABASE_URL: str = "sqlite+aiosqlite:///./rotalive.db"

    # WhatsApp
    WHATSAPP_API_URL: str = ""
    WHATSAPP_API_KEY: str = ""
    WHATSAPP_PHONE_NUMBER_ID: str = ""

    # App
    APP_BASE_URL: str = "http://localhost:8000"
    FRONTEND_URL: str = "http://localhost:5173"
    ALLOWED_ORIGINS: str = "http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173"

    # Rate Limiting
    RATE_LIMIT_NOTIFY: str = "10/minute"

    @property
    def cors_origins(self) -> List[str]:
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",")]

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
