import uuid
import enum
from datetime import datetime, timezone
from sqlalchemy import (
    String, Integer, Float, Boolean, DateTime, Enum as SAEnum,
    ForeignKey, Text, JSON
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


def now_utc():
    return datetime.now(timezone.utc)


def gen_uuid():
    return str(uuid.uuid4())


# ─── Enums ────────────────────────────────────────────────────────────────────

class UserRole(str, enum.Enum):
    admin = "admin"
    motoboy = "motoboy"


class DeliveryStatus(str, enum.Enum):
    pending = "pending"
    in_transit = "in_transit"
    arrived = "arrived"
    completed = "completed"
    cancelled = "cancelled"


# ─── Store (white-label tenant) ───────────────────────────────────────────────

class Store(Base):
    __tablename__ = "stores"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)

    # White-label customisation
    primary_color: Mapped[str] = mapped_column(String(7), default="#1E1B4B")
    secondary_color: Mapped[str] = mapped_column(String(7), default="#10B981")
    logo_path: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # WhatsApp message templates (JSON)
    whatsapp_templates: Mapped[dict] = mapped_column(
        JSON,
        default=lambda: {
            "dispatched": "Olá {customer_name}! Seu pedido da {store_name} saiu para entrega. 🛵 Acompanhe em tempo real: {tracking_url}",
            "arrived": "🎉 O motoboy chegou! Pode descer para receber seu pedido da {store_name}. O seu código de entrega é: *{delivery_code}*",
        },
    )
    
    # Store Settings
    require_delivery_code: Mapped[bool] = mapped_column(Boolean, default=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)

    # Relationships
    users: Mapped[list["User"]] = relationship("User", back_populates="store")
    deliveries: Mapped[list["Delivery"]] = relationship("Delivery", back_populates="store")


# ─── User (Admin + Motoboy) ───────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    store_id: Mapped[str] = mapped_column(String(36), ForeignKey("stores.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    email: Mapped[str] = mapped_column(String(300), unique=True, nullable=False)
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    hashed_password: Mapped[str] = mapped_column(String(500), nullable=False)
    role: Mapped[UserRole] = mapped_column(SAEnum(UserRole), default=UserRole.motoboy)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)

    store: Mapped["Store"] = relationship("Store", back_populates="users")
    deliveries: Mapped[list["Delivery"]] = relationship("Delivery", back_populates="motoboy")


# ─── Delivery ─────────────────────────────────────────────────────────────────

class Delivery(Base):
    __tablename__ = "deliveries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    store_id: Mapped[str] = mapped_column(String(36), ForeignKey("stores.id"), nullable=False)
    motoboy_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)

    # Customer data (masked after completion)
    customer_name: Mapped[str] = mapped_column(String(200), nullable=False)
    customer_phone: Mapped[str] = mapped_column(String(20), nullable=False)
    customer_address: Mapped[str] = mapped_column(Text, nullable=False)

    # Destination coords
    dest_lat: Mapped[float] = mapped_column(Float, nullable=False)
    dest_lng: Mapped[float] = mapped_column(Float, nullable=False)

    # Status
    status: Mapped[DeliveryStatus] = mapped_column(
        SAEnum(DeliveryStatus), default=DeliveryStatus.pending
    )

    # Tracking link (ephemeral UUID)
    tracking_token: Mapped[str] = mapped_column(String(36), unique=True, default=gen_uuid)
    tracking_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Security
    delivery_code: Mapped[str | None] = mapped_column(String(10), nullable=True)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    dispatched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    arrived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Last known GPS position
    last_lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_position_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # WhatsApp notification state
    notified_dispatched: Mapped[bool] = mapped_column(Boolean, default=False)
    notified_arrived: Mapped[bool] = mapped_column(Boolean, default=False)

    # Relationships
    store: Mapped["Store"] = relationship("Store", back_populates="deliveries")
    motoboy: Mapped["User | None"] = relationship("User", back_populates="deliveries")
