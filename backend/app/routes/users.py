from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.middleware.deps import require_admin
from app.models.activity_log import ActorType
from app.models.user import Role, User
from app.schemas import PasswordReset, UserCreate, UserResponse, UserUpdate
from app.services import users as users_service
from app.services.activity import log_activity
from app.services.auth import assert_password_policy, hash_password, invalidate_all_sessions

router = APIRouter(prefix="/api/v1/users", tags=["users"])

_USER_NOT_FOUND = "User not found"
_LAST_ADMIN_MSG = "Cannot remove the last admin account"


@router.get("/")
async def list_users(
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_admin)],
) -> list[UserResponse]:
    all_users = await users_service.list_all(db)
    return [UserResponse.model_validate(u) for u in all_users]


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_user(
    body: UserCreate,
    db: Annotated[AsyncSession, Depends(get_session)],
    current_user: Annotated[User, Depends(require_admin)],
) -> UserResponse:
    existing = await users_service.get(db, body.username)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"error": "USERNAME_TAKEN", "message": f"Username '{body.username}' is already taken"},
        )
    assert_password_policy(body.password, body.username)
    user = await users_service.create(
        db,
        username=body.username,
        password_hash=hash_password(body.password),
        display_name=body.display_name,
        role=body.role,
    )
    await log_activity(
        db,
        actor_type=ActorType.human,
        actor_username=current_user.username,
        action="user.create",
        resource_type="user",
        resource_id=body.username,
        details={"role": body.role.value, "display_name": body.display_name},
    )
    return UserResponse.model_validate(user)


@router.put("/{username}")
async def update_user(
    username: str,
    body: UserUpdate,
    db: Annotated[AsyncSession, Depends(get_session)],
    current_user: Annotated[User, Depends(require_admin)],
) -> UserResponse:
    if body.role is not None and username == current_user.username:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": "SELF_DEMOTE", "message": "You cannot change your own role"},
        )
    if body.role is not None and body.role != Role.admin:
        target = await users_service.get(db, username)
        if target and target.role == Role.admin:
            if await users_service.count_by_role(db, Role.admin) <= 1:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail={"error": "LAST_ADMIN", "message": _LAST_ADMIN_MSG},
                )
    user = await users_service.update(
        db, username, body.model_fields_set,
        display_name=body.display_name, role=body.role,
    )
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_USER_NOT_FOUND)
    all_fields = {"display_name": body.display_name, "role": body.role.value if body.role else None}
    changed = {k: v for k, v in all_fields.items() if k in body.model_fields_set}
    await log_activity(
        db,
        actor_type=ActorType.human,
        actor_username=current_user.username,
        action="user.update",
        resource_type="user",
        resource_id=username,
        details=changed,
    )
    return UserResponse.model_validate(user)


@router.delete("/{username}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    username: str,
    db: Annotated[AsyncSession, Depends(get_session)],
    current_user: Annotated[User, Depends(require_admin)],
) -> None:
    if username == current_user.username:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": "SELF_DELETE", "message": "You cannot delete your own account"},
        )
    user = await users_service.get(db, username)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_USER_NOT_FOUND)
    if user.role == Role.admin and await users_service.count_by_role(db, Role.admin) <= 1:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": "LAST_ADMIN", "message": _LAST_ADMIN_MSG},
        )
    await invalidate_all_sessions(db, username)
    await users_service.delete(db, username)
    await log_activity(
        db,
        actor_type=ActorType.human,
        actor_username=current_user.username,
        action="user.delete",
        resource_type="user",
        resource_id=username,
    )


@router.post("/{username}/reset-password", status_code=status.HTTP_204_NO_CONTENT)
async def reset_password(
    username: str,
    body: PasswordReset,
    db: Annotated[AsyncSession, Depends(get_session)],
    current_user: Annotated[User, Depends(require_admin)],
) -> None:
    if username == current_user.username:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": "SELF_RESET", "message": "Use change-password to update your own password"},
        )
    user = await users_service.get(db, username)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_USER_NOT_FOUND)
    assert_password_policy(body.new_password, username)
    await invalidate_all_sessions(db, username)
    await users_service.set_password(db, username, hash_password(body.new_password))
    await log_activity(
        db,
        actor_type=ActorType.human,
        actor_username=current_user.username,
        action="user.reset_password",
        resource_type="user",
        resource_id=username,
    )
