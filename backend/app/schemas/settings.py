"""Alert settings request and response schemas."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class AlertSettingsUpdate(BaseModel):
    """Payload for changing the alert preferences."""

    enabled: bool
    # Validated here as well as by the database CHECK, so a bad value comes back
    # as a readable 422 rather than an integrity error.
    alert_time: str = Field(pattern=r"^([01][0-9]|2[0-3]):[0-5][0-9]$")
    days_ahead: int = Field(ge=1, le=365)


class AlertSettingsRead(BaseModel):
    """Alert settings as returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    enabled: bool
    alert_time: str
    days_ahead: int
    updated_at: datetime


class SettingsResponse(BaseModel):
    """Everything the settings screen needs."""

    alerts: AlertSettingsRead
    # Derived from the environment, never the token itself: the UI needs to know
    # whether delivery will work, not what the credential is.
    telegram_configured: bool
    # What the scheduler will actually do, which can differ from what the
    # settings say if Telegram is unconfigured.
    next_run_at: str | None
    # The zone alert_time is expressed in. Sent so the UI can render the next
    # run in the same zone as the input, instead of converting to whatever zone
    # the viewer's device happens to be in.
    timezone: str
