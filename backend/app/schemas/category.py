"""Category request and response schemas."""

from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, StringConstraints


class CategoryCreate(BaseModel):
    """Payload for creating a category."""

    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class CategoryUpdate(CategoryCreate):
    """Payload for renaming a category."""


class CategoryRead(BaseModel):
    """A category as returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    created_at: datetime
