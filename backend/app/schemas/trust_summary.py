"""Response schema for `GET /properties/{id}/trust-summary` — wraps
`app.services.trust_ai_summary.TrustSummaryResult`. Separate from
`schemas/trust.py`'s `TrustAssessmentOut` by design (see the route handler's
docstring): the deterministic assessment must render instantly, this AI
explanation loads async underneath it.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class TrustSummaryOut(BaseModel):
    property_id: int
    summary: str
    generated_by: Literal["ai", "fallback"]
