from pydantic import BaseModel


class LoginRequest(BaseModel):
    username: str
    password: str
    remember_me: bool = False


class UserResponse(BaseModel):
    username: str
    display_name: str | None
    is_admin: bool

    model_config = {"from_attributes": True}


class TokenResponse(BaseModel):
    user: UserResponse
    session_id: str
