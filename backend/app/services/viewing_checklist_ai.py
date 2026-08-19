"""AI-enhanced layer on top of the deterministic checklist
(app/services/viewing_checklist.py). Mirrors home_finder_ai.explain_match's
grounded-narration-with-fallback pattern exactly: build a plain-text facts
block strictly from the deterministic items already generated (plus
optional Property Intelligence / Trust Center summaries), `try: gateway.run_chat
except: fallback`, never raises, never blocks the checklist from rendering.
"""
import json
import logging
import re

from app.core.ai import gateway
from app.core.ai.prompts import VIEWING_CHECKLIST_SUMMARY
from app.services.viewing_checklist import ChecklistItem, ChecklistSection, ViewingChecklist

logger = logging.getLogger("app.services.viewing_checklist_ai")


def _extract_json(raw: str) -> dict:
    match = re.search(r"\{.*\}", raw.strip(), re.DOTALL)
    if not match:
        raise ValueError("AI did not return a JSON object")
    return json.loads(match.group(0))


def _facts_block(checklist: ViewingChecklist, property_intelligence_summary: str | None, trust_summary: str | None) -> str:
    lines = ["Checklist items (annotate ONLY these ids, do not invent new ones):"]
    for section in checklist.sections:
        lines.append(f"Section '{section.title}' ({section.key}):")
        for item in section.items:
            lines.append(f"  - id={item.id}: {item.text}")
    if property_intelligence_summary:
        lines.append(f"\nProperty Intelligence summary:\n{property_intelligence_summary}")
    if trust_summary:
        lines.append(f"\nTrust Center summary:\n{trust_summary}")
    return "\n".join(lines)


def enhance_checklist(
    checklist: ViewingChecklist,
    *,
    property_intelligence_summary: str | None = None,
    trust_summary: str | None = None,
    language: str = "en",
    user_id: int | None = None,
) -> ViewingChecklist:
    """Returns a new ViewingChecklist with 'why this matters' annotations +
    a visit-plan summary, or the ORIGINAL checklist unchanged on any AI
    failure — mirrors explain_match exactly (never raises, never blocks)."""
    known_ids = {item.id for section in checklist.sections for item in section.items}
    facts = _facts_block(checklist, property_intelligence_summary, trust_summary)

    status = "error"
    result = None
    try:
        result = gateway.run_chat(
            model=gateway.DEFAULT_MODEL,
            system=VIEWING_CHECKLIST_SUMMARY.template,
            tools=[],
            messages=[{"role": "user", "content": f"Language: {language}\n\n{facts}"}],
            max_tokens=900,
        )
        status = "ok"
        data = _extract_json(result.reply)

        summary = str(data.get("visit_plan_summary", "")).strip()[:400] or None

        why_map: dict[str, str] = {}
        raw_items = data.get("items")
        if isinstance(raw_items, list):
            for entry in raw_items[:60]:
                if not isinstance(entry, dict):
                    continue
                item_id = str(entry.get("id", "")).strip()
                # Never trust raw model output directly — an id the model
                # invented (not one of the ones we sent) is silently dropped,
                # never applied to any item.
                if item_id not in known_ids:
                    continue
                why = str(entry.get("why_it_matters", "")).strip()[:200]
                if why:
                    why_map[item_id] = why

        if not why_map and not summary:
            raise ValueError("AI returned no usable annotations")

        new_sections = [
            ChecklistSection(
                key=section.key,
                title=section.title,
                items=[
                    ChecklistItem(id=item.id, text=item.text, why_it_matters=why_map.get(item.id))
                    for item in section.items
                ],
            )
            for section in checklist.sections
        ]
        return ViewingChecklist(sections=new_sections, visit_plan_summary=summary, generated_by="ai")
    except Exception as exc:  # noqa: BLE001 — must degrade to the deterministic checklist, never block rendering
        logger.warning("enhance_checklist: AI call failed, using deterministic checklist: %s", exc)
        status = "error"
        return checklist
    finally:
        gateway.log_ai_call(
            feature="viewing_checklist_summary",
            model=gateway.DEFAULT_MODEL,
            prompt=VIEWING_CHECKLIST_SUMMARY,
            latency_ms=result.latency_ms if result else 0.0,
            status=status,
            user_id=user_id,
            input_tokens=result.input_tokens if result else None,
            output_tokens=result.output_tokens if result else None,
        )
