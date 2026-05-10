from datetime import datetime
from typing import Optional, Any
from pydantic import BaseModel, EmailStr, field_validator
from app.models import UserRole, DeliveryStatus


# ─── Auth ─────────────────────────────────────────────────────────────────────

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: UserRole
    user_id: str
    store_id: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


# ─── Store ────────────────────────────────────────────────────────────────────

class StoreCreate(BaseModel):
    name: str
    slug: str
    primary_color: str = "#1E1B4B"
    secondary_color: str = "#10B981"

    @field_validator("slug")
    @classmethod
    def slug_lower(cls, v: str) -> str:
        return v.lower().strip().replace(" ", "-")


class StoreUpdate(BaseModel):
    name: Optional[str] = None
    primary_color: Optional[str] = None
    secondary_color: Optional[str] = None
    whatsapp_templates: Optional[dict] = None
    require_delivery_code: Optional[bool] = None


class StoreOut(BaseModel):
    id: str
    name: str
    slug: str
    primary_color: str
    secondary_color: str
    logo_path: Optional[str]
    whatsapp_templates: dict
    require_delivery_code: bool
    created_at: datetime

    model_config = {"from_attributes": True}


# ─── User ─────────────────────────────────────────────────────────────────────

class UserCreate(BaseModel):
    name: str
    email: EmailStr
    phone: Optional[str] = None
    password: str
    role: UserRole = UserRole.motoboy


class UserOut(BaseModel):
    id: str
    store_id: str
    name: str
    email: str
    phone: Optional[str]
    role: UserRole
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


# ─── Delivery ─────────────────────────────────────────────────────────────────

class DeliveryCreate(BaseModel):
    customer_name: str
    customer_phone: str
    customer_address: str
    dest_lat: float
    dest_lng: float
    motoboy_id: Optional[str] = None


class DeliveryOut(BaseModel):
    id: str
    store_id: str
    motoboy_id: Optional[str]
    customer_name: str
    # Masked phone/address if completed
    customer_phone: Optional[str]
    customer_address: Optional[str]
    dest_lat: float
    dest_lng: float
    status: DeliveryStatus
    tracking_token: str
    tracking_expires_at: Optional[datetime]
    created_at: datetime
    dispatched_at: Optional[datetime]
    arrived_at: Optional[datetime]
    completed_at: Optional[datetime]
    last_lat: Optional[float]
    last_lng: Optional[float]
    last_position_at: Optional[datetime]
    notified_dispatched: bool
    notified_arrived: bool
    delivery_code: Optional[str] = None

    model_config = {"from_attributes": True}


class DeliveryPublicOut(BaseModel):
    """Safe model returned to the customer tracking page."""
    id: str
    status: DeliveryStatus
    store_name: str
    store_primary_color: str
    store_secondary_color: str
    store_logo: Optional[str]
    dest_lat: float
    dest_lng: float
    last_lat: Optional[float]
    last_lng: Optional[float]
    last_position_at: Optional[datetime]
    dispatched_at: Optional[datetime]
    arrived_at: Optional[datetime]
    motoboy_name: Optional[str]

    model_config = {"from_attributes": True}


# ─── Delivery Actions ─────────────────────────────────────────────────────────

class DeliveryCompleteRequest(BaseModel):
    code: Optional[str] = None


# ─── GPS Position Update ───────────────────────────────────────────────────────

class GPSUpdate(BaseModel):
    lat: float
    lng: float
    accuracy: Optional[float] = None


# ─── WhatsApp Notification ────────────────────────────────────────────────────

class NotifyRequest(BaseModel):
    delivery_id: str
    event: str  # "dispatched" | "arrived"
