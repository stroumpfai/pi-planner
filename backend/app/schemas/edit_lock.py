from pydantic import BaseModel

from app.schemas.common import UtcDatetime


class EditLockResponse(BaseModel):
    project_id: str
    locked_by_username: str | None
    locked_at: UtcDatetime | None
    expires_at: UtcDatetime | None
    is_locked: bool

    model_config = {"from_attributes": True}
