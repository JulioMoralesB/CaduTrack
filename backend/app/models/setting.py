"""Runtime settings the user can change without a redeploy."""

from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AlertSettings(Base):
    """Alert preferences, held in a single row.

    A one-row table rather than a key/value store: these settings are a fixed,
    typed set, and key/value would trade real columns and constraints for
    stringly-typed lookups.
    """

    __tablename__ = "alert_settings"
    __table_args__ = (
        # Belt and braces on the single row, so a second one cannot appear.
        CheckConstraint("id = 1", name="ck_alert_settings_singleton"),
        CheckConstraint("days_ahead >= 1", name="ck_alert_settings_days_ahead"),
        CheckConstraint(
            r"alert_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'",
            name="ck_alert_settings_time_format",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    alert_time: Mapped[str] = mapped_column(String(5), nullable=False)
    days_ahead: Mapped[int] = mapped_column(Integer, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    def __repr__(self) -> str:
        return f"<AlertSettings time={self.alert_time} days={self.days_ahead} enabled={self.enabled}>"


class IconSettings(Base):
    """Whether the icon-assignment model fallback is on, held in a single row.

    Its own table rather than a column on AlertSettings: that table is scoped
    to alert preferences by name and by its own docstring, and this toggle has
    nothing to do with alerts. Same single-row shape, same reason for it.
    """

    __tablename__ = "icon_settings"
    __table_args__ = (CheckConstraint("id = 1", name="ck_icon_settings_singleton"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    ai_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    def __repr__(self) -> str:
        return f"<IconSettings ai_enabled={self.ai_enabled}>"


class IconNameCache(Base):
    """A model-resolved icon, keyed by normalized product name.

    Exists only to stop the same name costing a second model call — a local
    table hit needs no cache, since app.icons's dict lookup is already free.
    A barcode is the other cache key #85 calls for; it plugs in here once #30
    adds a barcode column to Product, as its own lookup ahead of this one
    rather than a second column on this table, since a product can be found by
    either key independently of whether the other was ever recorded.
    """

    __tablename__ = "icon_name_cache"

    normalized_name: Mapped[str] = mapped_column(String(255), primary_key=True)
    icon: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    def __repr__(self) -> str:
        return f"<IconNameCache {self.normalized_name!r} -> {self.icon}>"
