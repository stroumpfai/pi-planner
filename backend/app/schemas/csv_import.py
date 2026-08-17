from pydantic import BaseModel, field_validator

from app.schemas.pbi import ValidEffort


class CsvRow(BaseModel):
    row_number: int
    item_type: str          # "feature" | "story" | "bug"  — validated in service
    user_id: int | None = None
    title: str
    effort: ValidEffort = None
    parent_id: int | None = None  # CSV user_id of the parent Feature row

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


class CsvImportError(BaseModel):
    row: int
    message: str


class CsvImportResult(BaseModel):
    created_features: int
    created_stories: int
    updated_features: int
    updated_stories: int
    removed_features: int
    removed_stories: int
    orphan_stories: int
