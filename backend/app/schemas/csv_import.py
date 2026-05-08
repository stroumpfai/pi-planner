from pydantic import BaseModel


class CsvRow(BaseModel):
    row_number: int
    item_type: str          # "feature" | "story" | "bug"  — validated in service
    user_id: int | None = None
    title: str
    effort: int | None = None
    parent_id: int | None = None  # CSV user_id of the parent Feature row


class CsvImportRequest(BaseModel):
    rows: list[CsvRow]


class CsvImportError(BaseModel):
    row: int
    message: str


class CsvImportResult(BaseModel):
    created_features: int
    created_stories: int
    updated_features: int
    updated_stories: int
    orphan_stories: int
