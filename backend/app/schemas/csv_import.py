from datetime import date

from pydantic import BaseModel, Field, field_validator

from app.schemas.pbi import ValidEffort


class CsvRow(BaseModel):
    row_number: int
    item_type: str          # "feature" | "story" | "bug"  — validated in service
    user_id: int | None = None
    title: str
    effort: ValidEffort = None
    parent_id: int | None = None  # CSV user_id of the parent Feature row
    state: str | None = None      # raw State cell; "" clears the item's State, None means absent
    # Closed Date, else Resolved Date, already converted to ISO by the client, which
    # owns format detection (team-achievement.md §4.3). Only read when the request's
    # has_completion_columns is true. None means both cells were blank, which changes
    # nothing: the item keeps its date, or the stamp its State change earns.
    completed_on: date | None = None
    # Raw Iteration Path cell. Only read when the request's has_iteration_column and
    # apply_iterations are both true.
    iteration: str | None = Field(None, max_length=500)

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
    # False when the file had neither a Closed Date nor a Resolved Date column, in
    # which case no item's completed_on is touched (§4.3) — the State column's rule.
    has_completion_columns: bool = False
    # Off by default: a story whose Parent has changed in the source is left where
    # planning put it unless the user opts in, because moving it can pull it off a
    # board and out of its sprint.
    apply_reparenting: bool = False
    # Off by default: promoting a story to a Feature deletes the story, taking its
    # sprint placement with it.
    apply_type_changes: bool = False
    # Place items on the PI board from their Iteration Path. Off unless asked for;
    # the import dialog asks by default. A file without the column places nothing.
    has_iteration_column: bool = False
    apply_iterations: bool = False


class PlannedChange(BaseModel):
    """One thing an import would do, as worked out by actually doing it.

    Produced by the same code path that performs the import, run inside a
    transaction that is then rolled back — so this is what will happen, not a
    second implementation's opinion of what should.
    """

    action: str
    """created | updated | deleted | moved | retyped | placed | skipped"""
    item_type: str          # feature | story | bug
    user_id: int | None
    title: str
    row: int | None = None
    """CSV row this came from. None for items pulled in by a cascade, which no row
    mentions — the continuations and stories that go with a deleted feature."""
    changes: list[str] = []
    """Field names an update touches, so a re-import that changes nothing reads as
    changing nothing."""
    detail: str | None = None
    """Where the change lands, when that is the point of it: "Auth → Payments" for
    a move, the PIs a deletion reaches."""


class CsvImportError(BaseModel):
    row: int
    message: str


class OrphanLocation(BaseModel):
    """Where orphan rows that matched an existing story already live."""
    feature_title: str
    location: str       # "backlog" | "pi"
    count: int


class UnmatchedIteration(BaseModel):
    """An Iteration Path value that matched no PI or sprint, and how many rows had it."""
    path: str
    rows: int


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
    # IDs the project holds under the other entity type. Promotions (story → Feature)
    # are applied on request; demotions are only ever reported, because a Feature can
    # hold stories, groups and continuations with nowhere to go.
    items_retyped: int = 0
    items_retype_skipped: int = 0
    items_retype_blocked: int = 0
    # Only populated for a dry run, where seeing the changes is the whole point.
    plan: list[PlannedChange] = []
    plan_truncated: bool = False
    """True when the plan was capped — the counts above still cover everything."""
    created_states: int = 0  # State List entries discovered by this import
    # Completion dates (team-achievement.md §4.3). "Set" counts rows whose date was
    # written from the file. A date on a row whose State is not done-category is a
    # contradiction in the source: ignored, and its CSV row number listed rather than
    # silently reconciled. Blank cells change nothing, so there is nothing to count.
    completion_dates_set: int = 0
    completion_date_contradiction_rows: list[int] = []
    # Iteration placement (docs/csv-import-logic.md). Unmatched paths are listed once
    # each rather than per row: a refresh often has dozens of rows under a PI that is
    # simply not mapped yet, and the fix is the same for all of them.
    items_placed: int = 0
    placements_skipped: int = 0
    unmatched_iterations: list[UnmatchedIteration] = []
