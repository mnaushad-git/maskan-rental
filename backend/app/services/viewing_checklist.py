"""AI Viewing Checklist — deterministic generator (Prompt 5, brief §11-13).
No LLM here; this is the fallback that must always work even if AI is down
(see viewing_checklist_ai.py for the AI-enhanced layer built on top).

Every conditional item traces to a concrete field value or a concrete
missing field on the listing — never an invented defect or claim, mirroring
app/services/property_highlights.py's evidence-based approach and
app/services/smart_questions.py's skip-if-known bank pattern.
"""
from dataclasses import dataclass, field
from typing import Callable

from app.models.property import Property

QuestionSkip = Callable[[Property], bool]


@dataclass
class ChecklistItem:
    id: str
    text: str
    why_it_matters: str | None = None


@dataclass
class ChecklistSection:
    key: str
    title: str
    items: list[ChecklistItem] = field(default_factory=list)


@dataclass
class ViewingChecklist:
    sections: list[ChecklistSection] = field(default_factory=list)
    visit_plan_summary: str | None = None
    generated_by: str = "deterministic"  # "deterministic" | "ai"


# ── Verify During Visit (brief §11) — fixed core list, always included ─────

_VERIFY_DURING_VISIT_ITEMS: list[tuple[str, str]] = [
    ("verify_parking", "Confirm parking availability and exactly where it is."),
    ("verify_room_sizes", "Check that actual room sizes match what's listed."),
    ("verify_water_pressure", "Check water pressure in the bathroom(s) and kitchen."),
    ("verify_network_coverage", "Check mobile network and WiFi coverage inside the unit."),
    ("verify_furnishings_included", "Confirm exactly which furnishings, if any, are included."),
    ("verify_natural_lighting", "Check natural lighting at the time of your visit."),
    ("verify_maintenance_issues", "Look for visible maintenance issues (cracks, leaks, damage)."),
]


def generate_verify_during_visit_items(prop: Property) -> list[ChecklistItem]:
    return [ChecklistItem(id=item_id, text=text) for item_id, text in _VERIFY_DURING_VISIT_ITEMS]


# ── Property-specific (brief §11) — conditional, grounded in real fields ───

def generate_property_specific_items(prop: Property) -> list[ChecklistItem]:
    items: list[ChecklistItem] = []

    if prop.furnished:
        items.append(ChecklistItem(
            "confirm_furnishing_items",
            f"Furnishing is listed as '{prop.furnished}' — confirm exactly which items are included.",
        ))
    else:
        items.append(ChecklistItem(
            "ask_furnishing_status",
            "Furnishing status isn't listed — ask whether the unit is furnished, unfurnished, or semi-furnished.",
        ))

    if prop.property_age_years is None:
        items.append(ChecklistItem("ask_property_age", "Property age isn't listed — ask when it was built."))

    if prop.size_sq_m is None:
        items.append(ChecklistItem("verify_dimensions", "Listed size is missing — verify the actual square meterage during the visit."))

    if prop.listing_type == "sale" and prop.deed_area is None:
        items.append(ChecklistItem("verify_deed_area", "Deed area isn't listed — ask for it and compare against the unit's actual size."))

    if prop.has_private_roof:
        items.append(ChecklistItem("confirm_roof_access", "A private roof is listed — confirm access and its condition."))

    if prop.in_villa:
        items.append(ChecklistItem("confirm_villa_layout", "Listed as within a villa — confirm what's included in your unit vs. shared villa areas."))

    if prop.has_elevator:
        items.append(ChecklistItem("confirm_elevator", "An elevator is listed — confirm it's in working order."))

    if prop.has_two_entrances:
        items.append(ChecklistItem("confirm_two_entrances", "Two entrances are listed — confirm both are usable and secure."))

    if prop.has_separate_electrical_meter:
        items.append(ChecklistItem("confirm_electrical_meter", "A separate electrical meter is listed — confirm it's functioning and billed correctly."))

    return items


# ── Rent / Buy transaction-specific (brief §12-13) — skip-if-known, mirrors
# smart_questions.py's bank pattern (a distinct list from that feature's own
# pre-viewing questions — this one is framed for during-viewing use) ───────

_RENT_CHECKLIST_BANK: list[tuple[str, str, QuestionSkip]] = [
    ("rent_negotiable", "Ask whether the rent is negotiable.", lambda p: False),
    ("rent_payment_schedule", "Ask how many payments per year the rent requires (e.g. 1, 2, or 4).", lambda p: False),
    ("rent_maintenance_contact", "Ask who handles maintenance requests — the owner or a property manager.", lambda p: False),
    ("rent_move_in_date", "Confirm the earliest move-in / availability date.", lambda p: False),
    ("rent_deposit", "Confirm the security deposit amount.", lambda p: bool(p.insurance_amount)),
]

_BUY_CHECKLIST_BANK: list[tuple[str, str, QuestionSkip]] = [
    ("buy_negotiable", "Ask whether the asking price is negotiable.", lambda p: False),
    ("buy_service_charges", "Ask about any service charges, HOA, or community fees.", lambda p: False),
    ("buy_occupancy", "Confirm whether the property is currently vacant or occupied.", lambda p: False),
    ("buy_inclusions", "Confirm what's included in the sale (fixtures, appliances, furnishings).", lambda p: False),
    ("buy_recent_repairs", "Ask about any major renovations or repairs done recently.", lambda p: False),
]


def generate_rent_items(prop: Property) -> list[ChecklistItem]:
    return [ChecklistItem(id=item_id, text=text) for item_id, text, skip in _RENT_CHECKLIST_BANK if not skip(prop)]


def generate_buy_items(prop: Property) -> list[ChecklistItem]:
    return [ChecklistItem(id=item_id, text=text) for item_id, text, skip in _BUY_CHECKLIST_BANK if not skip(prop)]


# ── Assembly ─────────────────────────────────────────────────────────────

def build_checklist(prop: Property) -> ViewingChecklist:
    """Deterministic fallback — must always work even if AI is down."""
    sections = [
        ChecklistSection("verify_during_visit", "Verify During Visit", generate_verify_during_visit_items(prop)),
        ChecklistSection("property_specific", "Property-Specific", generate_property_specific_items(prop)),
    ]
    if prop.listing_type == "sale":
        sections.append(ChecklistSection("buy_questions", "Buying Questions", generate_buy_items(prop)))
    else:
        sections.append(ChecklistSection("rent_questions", "Rental Questions", generate_rent_items(prop)))
    return ViewingChecklist(sections=sections, generated_by="deterministic")
