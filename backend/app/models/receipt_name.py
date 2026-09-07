"""Receipt line name lookup — see #126."""

from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ReceiptNameLookup(Base):
    """What a raw, abbreviated receipt line was named last time it was
    actually turned into (or matched to) a product.

    Keyed on the raw printed text, not the model's own guess at what it
    means: app/receipt_client.py's extraction step no longer expands or
    corrects a name, precisely so this key stays the one stable thing
    across two photos of the same store's receipt — the model's own
    expansion can vary slightly between reads, but the printed abbreviation
    for a given item does not. Same shape and reasoning as BarcodeLookup,
    recorded only once a trip item actually resolves, never on read.
    """

    __tablename__ = "receipt_name_lookup"

    raw_text: Mapped[str] = mapped_column(String(255), primary_key=True)
    product_name: Mapped[str] = mapped_column(String(255), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    def __repr__(self) -> str:
        return f"<ReceiptNameLookup {self.raw_text!r} -> {self.product_name!r}>"
