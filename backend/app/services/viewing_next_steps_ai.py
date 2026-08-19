"""AI Post-Viewing Assistant ("Ask myMakan What Next?", Prompt 6, brief
§17). Same try/except-with-deterministic-fallback shape as
viewing_checklist_ai.py / home_finder_ai.explain_match: build a plain-text
facts block strictly from deterministic inputs (property fields, the
customer's own checklist completion + private note text, their feedback,
and optional Property Intelligence/Trust/search-criteria summaries the
caller passes in), never invent a fact, never block on AI failure.
"""
import json
import logging
import re
from dataclasses import dataclass

from app.core.ai import gateway
from app.core.ai.prompts import VIEWING_NEXT_STEPS
from app.models.property import Property
from app.models.property_viewing import PropertyViewing

logger = logging.getLogger("app.services.viewing_next_steps_ai")


@dataclass
class NextStepsResult:
    visit_summary: str
    next_steps: list[str]
    generated_by: str  # "ai" | "fallback"


def _extract_json(raw: str) -> dict:
    match = re.search(r"\{.*\}", raw.strip(), re.DOTALL)
    if not match:
        raise ValueError("AI did not return a JSON object")
    return json.loads(match.group(0))


def _deterministic_fallback(
    prop: Property | None,
    checklist_state: dict | None,
    private_notes: list | None,
    feedback: dict | None,
) -> NextStepsResult:
    """A short templated summary built from whichever fields are present —
    no AI wording, still useful, never blocks."""
    parts = [f"You visited {prop.title}." if prop else "Here's a recap of your visit."]

    interest = (feedback or {}).get("interest_level")
    if interest:
        parts.append(f"You marked this property as '{interest}'.")

    sections = (checklist_state or {}).get("sections") or []
    checked = (checklist_state or {}).get("checked") or {}
    total_items = sum(len(s.get("items", [])) for s in sections)
    checked_count = sum(1 for v in checked.values() if v)
    if total_items:
        parts.append(f"You checked {checked_count} of {total_items} visit checklist items.")

    if private_notes:
        parts.append(f"You left {len(private_notes)} private note(s) during the visit.")

    next_steps: list[str] = []
    if interest == "Very Interested":
        next_steps.append("Contact the mediator to discuss next steps.")
        next_steps.append("Compare this property with your other saved properties.")
    elif interest == "Maybe":
        next_steps.append("Confirm any open questions with the mediator before deciding.")
        next_steps.append("Compare this property with your other saved properties.")
    else:
        next_steps.append("Compare this property with your other saved properties.")

    return NextStepsResult(visit_summary=" ".join(parts), next_steps=next_steps[:3], generated_by="fallback")


def _facts_block(
    viewing: PropertyViewing,
    prop: Property | None,
    checklist_state: dict | None,
    private_notes: list | None,
    feedback: dict | None,
    property_intelligence_summary: str | None,
    trust_summary: str | None,
    search_criteria: str | None,
) -> str:
    lines: list[str] = []
    if prop:
        lines.append(f"Property: {prop.title}, {prop.area}, {prop.city}, listing_type={prop.listing_type}")
    lines.append(f"Viewing status: {viewing.status}")

    sections = (checklist_state or {}).get("sections") or []
    checked = (checklist_state or {}).get("checked") or {}
    if sections:
        lines.append("Checklist items and completion (real, from this customer's own visit):")
        for section in sections:
            for item in section.get("items", []):
                state = "checked" if checked.get(item.get("id")) else "unchecked"
                lines.append(f"  - [{state}] {item.get('text', '')}")

    if private_notes:
        lines.append("Customer's own private notes from the visit:")
        for note in private_notes:
            text = note.get("text") if isinstance(note, dict) else None
            if text:
                lines.append(f"  - {text}")

    if feedback:
        lines.append(
            f"Feedback: interest_level={feedback.get('interest_level')}, "
            f"reason={feedback.get('reason')}, note={feedback.get('note')}"
        )

    if property_intelligence_summary:
        lines.append(f"Property Intelligence summary:\n{property_intelligence_summary}")
    if trust_summary:
        lines.append(f"Trust Center summary:\n{trust_summary}")
    if search_criteria:
        lines.append(f"Customer's current search criteria:\n{search_criteria}")

    return "\n".join(lines)


def generate_next_steps(
    viewing: PropertyViewing,
    prop: Property | None,
    checklist_state: dict | None,
    private_notes: list | None,
    feedback: dict | None,
    *,
    property_intelligence_summary: str | None = None,
    trust_summary: str | None = None,
    search_criteria: str | None = None,
    language: str = "en",
    user_id: int | None = None,
) -> NextStepsResult:
    fallback = _deterministic_fallback(prop, checklist_state, private_notes, feedback)
    facts = _facts_block(viewing, prop, checklist_state, private_notes, feedback, property_intelligence_summary, trust_summary, search_criteria)

    status = "error"
    result = None
    try:
        result = gateway.run_chat(
            model=gateway.DEFAULT_MODEL,
            system=VIEWING_NEXT_STEPS.template,
            tools=[],
            messages=[{"role": "user", "content": f"Language: {language}\n\n{facts}"}],
            max_tokens=500,
        )
        status = "ok"
        data = _extract_json(result.reply)
        visit_summary = str(data.get("visit_summary", "")).strip()[:800]
        raw_steps = data.get("next_steps")
        steps: list[str] = []
        if isinstance(raw_steps, list):
            for step in raw_steps[:3]:
                if isinstance(step, str) and step.strip():
                    steps.append(step.strip()[:300])
        if not visit_summary or not steps:
            raise ValueError("AI returned an incomplete next-steps result")
        return NextStepsResult(visit_summary=visit_summary, next_steps=steps, generated_by="ai")
    except Exception as exc:  # noqa: BLE001 — must degrade to the deterministic fallback, never block
        logger.warning("generate_next_steps: AI call failed, using deterministic fallback: %s", exc)
        status = "error"
        return fallback
    finally:
        gateway.log_ai_call(
            feature="viewing_next_steps",
            model=gateway.DEFAULT_MODEL,
            prompt=VIEWING_NEXT_STEPS,
            latency_ms=result.latency_ms if result else 0.0,
            status=status,
            user_id=user_id,
            input_tokens=result.input_tokens if result else None,
            output_tokens=result.output_tokens if result else None,
        )
