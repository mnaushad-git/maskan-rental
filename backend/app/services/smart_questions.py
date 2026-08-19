"""Property Intelligence — Smart Questions. Deterministic, no LLM. Two fixed
question banks (rent / buy); a question is skipped only when the listing
already records the answer on a real `Property` field — never a guess about
what the user already knows.
"""
from typing import Callable

from app.models.property import Property

QuestionSkip = Callable[[Property], bool]

_RENT_QUESTION_BANK: list[tuple[str, QuestionSkip]] = [
    ("Is the rent negotiable?", lambda p: False),
    ("How many payments per year does the rent require (e.g. 1, 2, or 4)?", lambda p: False),
    ("Who handles maintenance requests — the owner or a property manager?", lambda p: False),
    ("Is a dedicated parking spot assigned to this unit?", lambda p: False),
    ("What is the earliest move-in / availability date?", lambda p: False),
    ("Are furnishings included, and which items specifically?", lambda p: p.furnished is not None),
    ("Is a security deposit required, and how much?", lambda p: bool(p.insurance_amount)),
]

_BUY_QUESTION_BANK: list[tuple[str, QuestionSkip]] = [
    ("What is the property's exact age / year built?", lambda p: p.property_age_years is not None),
    ("Are there any service charges, HOA, or community fees?", lambda p: False),
    ("Is the property currently occupied or vacant?", lambda p: False),
    ("Have there been any major renovations or repairs recently?", lambda p: False),
    ("What's included in the sale (fixtures, appliances, furnishings)?", lambda p: False),
    ("Is the asking price negotiable?", lambda p: False),
    ("What is the deed area, and does it match the listed size?", lambda p: p.deed_area is not None),
]


def generate_smart_questions(prop: Property) -> list[str]:
    bank = _BUY_QUESTION_BANK if prop.listing_type == "sale" else _RENT_QUESTION_BANK
    return [question for question, skip in bank if not skip(prop)]
