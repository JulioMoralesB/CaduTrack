"""Barcode lookup model — see #30."""

from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class BarcodeLookup(Base):
    """What a scanned code was called last time.

    Keyed on the item code — a GTIN or EAN — never the raw scanned string,
    which for a GS1-128 label also carries a weight that has nothing to do
    with what the product is called. Populated the first time a product is
    actually created from this code, not on scan: a scan the user abandons
    or types straight over must not remember anything.
    """

    __tablename__ = "barcode_lookups"

    code: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    # An icon override kept against the code, same reasoning as the name —
    # see #30's own "this is also where an icon override is kept".
    icon: Mapped[str | None] = mapped_column(String(16), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    def __repr__(self) -> str:
        return f"<BarcodeLookup code={self.code!r} name={self.name!r}>"
