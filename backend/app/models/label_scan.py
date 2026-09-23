"""Queued label photos — see #134."""

from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    Numeric,
    String,
    func,
)
from sqlalchemy.orm import Mapped, deferred, mapped_column

from app.db.base import Base


class LabelScanStatus(StrEnum):
    """Where the photo's own reading stands — separate from resolved_at,
    which is whether the user has dealt with it."""

    pending = "pending"
    read = "read"
    failed = "failed"


class LabelScan(Base):
    """One label photo, read in the background and then turned into a
    product (or dropped) by the user, one at a time.

    A flat queue, not grouped into batches like ShoppingTrip: every photo
    stands on its own (one label, one product), so photos taken now and more
    taken while the first are still being read simply join the same list.
    Same as a trip item, nothing here is a Product until it's resolved.
    """

    __tablename__ = "label_scans"
    __table_args__ = (
        CheckConstraint("status IN ('pending', 'read', 'failed')", name="ck_label_scans_status"),
        CheckConstraint("quantity > 0", name="ck_label_scans_quantity_positive"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    # Kept until the scan is resolved or dropped: the checklist shows it so a
    # photo the model couldn't read is still recognizable, and a failed read
    # can be retried without asking for the photo again. Deferred so listing
    # the queue never loads every photo.
    image: Mapped[bytes | None] = deferred(mapped_column(LargeBinary, nullable=True))
    image_type: Mapped[str] = mapped_column(String(100), nullable=False, server_default="image/jpeg")
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default=LabelScanStatus.pending, server_default=LabelScanStatus.pending
    )
    # What the model read — same fields and same meaning as LabelExtraction,
    # any of them null when it wasn't confident.
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    expires_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    quantity: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    unit: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # Same convention as ShoppingTripItem: set once dealt with, product_id
    # says which way — still null means dropped, not added.
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    product_id: Mapped[int | None] = mapped_column(
        ForeignKey("products.id", ondelete="SET NULL"), nullable=True
    )

    def __repr__(self) -> str:
        return f"<LabelScan id={self.id} status={self.status} resolved={self.resolved_at is not None}>"
