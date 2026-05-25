from typing import Literal

from pydantic import BaseModel, Field

from app.models.user import Role


class LoginRequest(BaseModel):
    username: str
    password: str
    remember_me: bool = False


class UserResponse(BaseModel):
    username: str
    display_name: str | None
    role: Literal["admin", "editor", "reader"]

    model_config = {"from_attributes": True}


class TokenResponse(BaseModel):
    user: UserResponse
    session_id: str


class UserCreate(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    display_name: str | None = Field(None, max_length=128)
    role: Role
    password: str = Field(..., min_length=8)


class UserUpdate(BaseModel):
    display_name: str | None = Field(None, max_length=128)
    role: Role | None = None


class PasswordReset(BaseModel):
    new_password: str = Field(..., min_length=8)


class ChangePassword(BaseModel):
    old_password: str
    new_password: str = Field(..., min_length=8)
