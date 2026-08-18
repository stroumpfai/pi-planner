from typing import Any

from pydantic import BaseModel, Field

from app.models.activity_log import ActorType
from app.models.user import Role
from app.schemas.common import UtcDatetime


class APIKeyResponse(BaseModel):
    id: str
    username: str
    name: str
    purpose: str | None
    created_at: UtcDatetime
    expires_at: UtcDatetime | None
    last_used_at: UtcDatetime | None
    is_active: bool

    model_config = {"from_attributes": True}


class APIKeyCreateResponse(BaseModel):
    id: str
    full_token: str
    username: str
    name: str
    created_at: UtcDatetime
    expires_at: UtcDatetime | None


class APIKeyCreate(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    name: str = Field(..., min_length=1, max_length=128)
    purpose: str | None = Field(None, max_length=512)
    expires_in_days: int | None = Field(None, ge=1, le=3650)


class APIKeyVerifyRequest(BaseModel):
    token: str


class APIKeyVerifyResponse(BaseModel):
    username: str
    role: Role
    key_id: str


class ActivityLogResponse(BaseModel):
    id: int
    actor_type: ActorType
    actor_username: str
    api_key_id: str | None
    action: str
    resource_type: str | None
    resource_id: str | None
    project_id: str | None
    details: dict[str, Any] | None
    timestamp: UtcDatetime
    status: str

    model_config = {"from_attributes": True}
