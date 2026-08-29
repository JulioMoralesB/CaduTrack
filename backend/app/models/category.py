"""Category model."""

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.product import Product


class Category(Base):
    """A food category, e.g. 'Lácteos' or 'Verduras'.

    Names are stored in Spanish because they are user-facing labels the user
    edits directly, unlike Product.location which stores language-neutral keys.
    """

    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    products: Mapped[list["Product"]] = relationship(
        back_populates="category", passive_deletes=True
    )

    def __repr__(self) -> str:
        return f"<Category id={self.id} name={self.name!r}>"
