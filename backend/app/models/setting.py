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
