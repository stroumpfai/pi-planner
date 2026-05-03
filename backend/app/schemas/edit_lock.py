from datetime import datetime

from pydantic import BaseModel


class EditLockResponse(BaseModel):
    project_id: str
    locked_by_username: str | None
    locked_at: datetime | None
    expires_at: datetime | None
    is_locked: bool

    model_config = {"from_attributes": True}
