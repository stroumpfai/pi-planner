from pydantic import BaseModel, field_validator

from app.schemas.pbi import ValidEffort


class CsvRow(BaseModel):
    row_number: int
    item_type: str          # "feature" | "story" | "bug"  — validated in service
    user_id: int | None = None
    title: str
    effort: ValidEffort = None
    parent_id: int | None = None  # CSV user_id of the parent Feature row
    state: str | None = None      # raw State cell; "" clears the item's State, None means absent

    @field_validator('effort', mode='before')
    @classmethod
    def parse_effort_string(cls, v: object) -> object:
        """Normalise string inputs; accept comma decimal separator (e.g. "0,5")."""
        if v is None:
            return None
        if isinstance(v, (int, float)):
            return float(v)
        if isinstance(v, str):
            s = v.strip()
            if s == '':
                return None
            try:
                return float(s.replace(',', '.'))
            except ValueError:
                return v  # pass through; the membership validator will raise
        return v


class CsvImportRequest(BaseModel):
    rows: list[CsvRow]
    removals: list[str] = []  # system_ids of existing items to delete (resolved by the client)
    # False when the file had no State column at all, in which case State is left
    # untouched on every row rather than cleared.
    has_state_column: bool = False
    # Off by default: a story whose Parent has changed in the source is left where
    # planning put it unless the user opts in, because moving it can pull it off a
    # board and out of its sprint.
    apply_reparenting: bool = False


class CsvImportError(BaseModel):
    row: int
    message: str


class OrphanLocation(BaseModel):
    """Where orphan rows that matched an existing story already live."""
    feature_title: str
    location: str       # "backlog" | "pi"
    count: int


class CsvImportResult(BaseModel):
    created_features: int
    created_stories: int
    updated_features: int
    updated_stories: int
    removed_features: int
    removed_stories: int
    orphan_stories: int          # rows in the file with no resolvable parent
    # Of those, the ones newly created under the "Unassigned" placeholder. The rest
    # matched stories already in the project and were updated where they sit, which
    # may be under a feature on the PI board rather than in the backlog.
    orphan_stories_placed: int = 0
    orphan_stories_existing: list[OrphanLocation] = []
    # Stories created under a feature the project already held but the file did not
    # list. These would have become orphans before Parent resolved against the
    # project, so naming them explains why the orphan count came out below the
    # preview's estimate.
    stories_parented_from_project: int = 0
    # Existing stories whose Parent names a different feature than the one holding
    # them. Moved when the import was asked to; counted as skipped when it was not,
    # so a divergence between the two systems is reported either way.
    stories_reparented: int = 0
    stories_reparent_skipped: int = 0
    created_states: int = 0  # State List entries discovered by this import
