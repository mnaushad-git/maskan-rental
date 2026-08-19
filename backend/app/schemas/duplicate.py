"""Response schema for `GET /properties/{id}/duplicate-check` — wraps
`app.services.duplicate_detection.DuplicateAwarenessResult`.
"""
from pydantic import BaseModel, Field

from app.services.duplicate_detection import DuplicateAwarenessResult


class DuplicateMatchOut(BaseModel):
    property_id: int
    title: str
    reasons: list[str] = Field(default_factory=list)
    match_score: int


class DuplicateAwarenessOut(BaseModel):
    is_possible_duplicate: bool
    confidence: str  # "none" | "low" | "medium" | "high"
    matches: list[DuplicateMatchOut] = Field(default_factory=list)
    reasons: list[str] = Field(default_factory=list)

    @classmethod
    def from_result(cls, result: DuplicateAwarenessResult) -> "DuplicateAwarenessOut":
        return cls(
            is_possible_duplicate=result.is_possible_duplicate,
            confidence=result.confidence,
            matches=[
                DuplicateMatchOut(property_id=m.property_id, title=m.title, reasons=m.reasons, match_score=m.match_score)
                for m in result.matches
            ],
            reasons=result.reasons,
        )
