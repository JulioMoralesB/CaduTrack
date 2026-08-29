"""Category request and response schemas."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class CategoryCreate(BaseModel):
    """Payload for creating a category."""

    name: str = Field(min_length=1, max_length=100)


class CategoryRead(BaseModel):
    """A category as returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    created_at: datetime
