from datetime import datetime
from urllib.parse import urlparse

from pydantic import BaseModel, Field, field_validator


def _validate_azure_devops_url(value: str | None) -> str | None:
    """Normalize and validate an Azure DevOps base URL.

    Empty/whitespace values become ``None`` (clears the field). Otherwise the
    URL must use the http or https scheme and include a host; anything else
    (e.g. ``javascript:`` or ``data:``) is rejected to prevent stored XSS when
    the value is later rendered as a link.
    """
    if value is None:
        return None
    stripped = value.strip()
    if not stripped:
        return None
    parsed = urlparse(stripped)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError("azure_devops_url must be a valid http(s):// URL")
    return stripped


class ProjectCreate(BaseModel):
    name: str = Field(..., max_length=255)
    description: str | None = Field(None, max_length=2000)
    azure_devops_url: str | None = Field(None, max_length=2000)

    _normalize_url = field_validator("azure_devops_url")(_validate_azure_devops_url)


class ProjectUpdate(BaseModel):
    name: str | None = Field(None, max_length=255)
    description: str | None = Field(None, max_length=2000)
    azure_devops_url: str | None = Field(None, max_length=2000)
    effort_unit: str | None = Field(None, max_length=20)

    _normalize_url = field_validator("azure_devops_url")(_validate_azure_devops_url)


class ProjectResponse(BaseModel):
    system_id: str
    name: str
    description: str | None
    azure_devops_url: str | None
    effort_unit: str
    created_at: datetime
    modified_at: datetime

    model_config = {"from_attributes": True}
