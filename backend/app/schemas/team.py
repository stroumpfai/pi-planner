from pydantic import BaseModel, Field

from app.schemas.common import UtcDatetime

# spec/teams.md §9. A hard stop, not a soft one: 50 teams is far past the point
# where the landing page is still readable, and the list is not paginated.
MAX_TEAMS = 50


class TeamCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: str | None = Field(None, max_length=2000)
    # The divisor that turns hours into person-days (§5.2). A team field rather
    # than a hardcoded 8 because a 37.5 h week is ordinary, and a 7.5 h day would
    # otherwise inflate every headline figure by 6.7%.
    normal_day_hours: float = Field(8.0, ge=1.0, le=24.0)


class TeamUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    description: str | None = Field(None, max_length=2000)
    normal_day_hours: float | None = Field(None, ge=1.0, le=24.0)


class TeamResponse(BaseModel):
    """A team, with the two counts the landing page reads.

    Teams are not planning items: the dual-ID system does not apply, so there is
    no ``id`` beside ``system_id`` here (§3.1).
    """

    system_id: str
    name: str
    description: str | None
    normal_day_hours: float
    member_count: int = 0
    # The projects this team serves. The home page builds the reverse map from it
    # to fill each project row's Team column, so a project never has to carry a
    # team field of its own.
    project_ids: list[str] = []
    created_at: UtcDatetime
    modified_at: UtcDatetime

    model_config = {"from_attributes": True}
