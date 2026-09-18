"""AI Transaction Assistant (Prompt 6). See
docs/implementation/mymakan-transaction-workspace.md. Same
try/except-with-deterministic-fallback shape as negotiation_ai.py /
viewing_next_steps_ai.py: build a plain-text facts block strictly from
deterministic inputs (this transaction's own checklist/progress/documents/
property/terms/trust — never a raw DB row handed straight to the model),
never invent a fact, never change transaction state, never give a legal
interpretation, never block on AI failure.

Two quick-action vocabularies, one per caller role — the customer set and
the mediator set the brief lists are deliberately disjoint (a mediator
never sees "what should I ask the mediator", a customer never sees "draft
a polite update request"), so `generate_response()` validates the
requested `quick_action` against whichever set matches `actor_role` before
ever building a prompt or calling the gateway.
"""
import logging
from dataclasses import dataclass

from app.core.ai import gateway
from app.core.ai.prompts import TRANSACTION_ASSISTANT
from app.models.property_transaction import PropertyTransaction
from app.services import property_transaction as transaction_service
from app.services import transaction_progress

logger = logging.getLogger("app.services.transaction_ai")

_LANGUAGE_NAMES = {"en": "English", "ar": "Arabic"}

CUSTOMER_QUICK_ACTIONS: dict[str, str] = {
    "whats_next": "What's next?",
    "whats_missing": "What's missing?",
    "explain_step": "Explain this step",
    "what_to_prepare": "What should I prepare?",
    "summarize": "Summarize my transaction",
    "what_to_ask_mediator": "What should I ask the mediator?",
}

MEDIATOR_QUICK_ACTIONS: dict[str, str] = {
    "summarize_outstanding": "Summarize outstanding items",
    "whats_blocking": "What's blocking this transaction?",
    "draft_update_request": "Draft a polite update request to the customer",
    "summarize_customer_progress": "Summarize the customer's progress",
}


class InvalidQuickAction(Exception):
    """A quick_action key that doesn't exist, or doesn't belong to the
    caller's role's own vocabulary — the route layer translates this into a
    422, never a 500."""


@dataclass
class TransactionAssistantResult:
    reply: str
    generated_by: str  # "ai" | "fallback"


def _quick_actions_for_role(actor_role: str) -> dict[str, str]:
    return MEDIATOR_QUICK_ACTIONS if actor_role == "mediator" else CUSTOMER_QUICK_ACTIONS


def validate_quick_action(actor_role: str, quick_action: str) -> None:
    if quick_action not in _quick_actions_for_role(actor_role):
        raise InvalidQuickAction(f"Unknown quick action '{quick_action}' for role '{actor_role}'")


# ── Grounding: a small structured context, never raw DB rows ───────────────


def _property_facts_block(transaction: PropertyTransaction) -> str:
    prop = transaction.property
    lines = [
        f"Transaction reference: {transaction.reference}",
        f"Transaction type: {transaction.transaction_type}",
        f"Transaction status: {transaction.status}",
    ]
    if prop:
        lines.append(f"Property: {prop.title}, {prop.area}, {prop.city}")
    return "\n".join(lines)


def _checklist_facts_block(progress: transaction_progress.TransactionProgress) -> str:
    lines = [f"Progress: {progress.progress_percentage}%", f"Readiness: {progress.readiness_label}"]
    lines.append(f"Next best action (deterministic — explain it, never override it): {progress.next_best_action.message}")
    lines.append("Checklist:")
    for step in progress.checklist:
        detail = f" ({step.detail})" if step.detail else ""
        lines.append(f"  - {step.label}: {step.status}{detail}")
    return "\n".join(lines)


def _documents_facts_block(transaction: PropertyTransaction) -> str:
    lines = ["Documents:"]
    for document in transaction.documents:
        requirement = "required" if document.required else "optional"
        note = f", mediator note: {document.review_note}" if document.review_note else ""
        lines.append(f"  - {document.label} ({requirement}): {document.status}{note}")
    return "\n".join(lines)


def _terms_facts_block(transaction: PropertyTransaction) -> str:
    terms = transaction_service._terms_snapshot(transaction)
    if not terms:
        return "Agreed terms: not available."
    return (
        f"Agreed amount: {transaction.currency} {float(terms['final_agreed_amount']):,.0f}\n"
        f"Agreed at: {terms['agreed_at']}\n"
        f"Negotiation reference: {terms['negotiation_reference']}"
    )


def _trust_facts_block(transaction: PropertyTransaction) -> str:
    mediator = transaction.mediator
    if mediator is None:
        return "Trust: no mediator assigned to this transaction."
    return f"Mediator verification: {'Verified by myMakan' if mediator.is_verified else 'Not yet verified by myMakan'}"


def _customer_facts_block(transaction: PropertyTransaction) -> str:
    info = transaction_service.customer_info_snapshot(transaction.customer)
    return f"Customer info on file: full name={info['full_name'] or 'not set'}, phone={info['phone'] or 'not set'}"


def _build_facts(transaction: PropertyTransaction, actor_role: str) -> str:
    progress = transaction_progress.compute_transaction_progress(transaction)
    blocks = [
        _property_facts_block(transaction),
        _checklist_facts_block(progress),
        _documents_facts_block(transaction),
        _terms_facts_block(transaction),
        _trust_facts_block(transaction),
    ]
    if actor_role == "mediator":
        # Deliberately narrower than the customer's own facts block — no
        # email/phone, mirrors PartnerTransactionCustomerOut's own privacy
        # bar (Prompt 5).
        blocks.append(f"Customer name: {transaction.customer.full_name if transaction.customer else 'unknown'}")
    else:
        blocks.append(_customer_facts_block(transaction))
    return "\n\n".join(blocks)


# ── Deterministic fallback ──────────────────────────────────────────────────


def _deterministic_fallback(transaction: PropertyTransaction, actor_role: str, quick_action: str) -> str:
    progress = transaction_progress.compute_transaction_progress(transaction)
    action_label = _quick_actions_for_role(actor_role).get(quick_action, quick_action)
    return (
        f"{action_label} — your transaction ({transaction.reference}) is currently {progress.readiness_label} "
        f"at {progress.progress_percentage}% complete. {progress.next_best_action.message}."
    )


# ── Entry point ──────────────────────────────────────────────────────────────


def generate_response(
    transaction: PropertyTransaction,
    *,
    actor_role: str,
    quick_action: str,
    language: str = "en",
    user_id: int | None = None,
) -> TransactionAssistantResult:
    """Never mutates `transaction` or anything reachable from it — this
    function only reads. Never raises on an AI failure: degrades to a short
    deterministic fallback built from Prompt 3's own engine, same "AI must
    not block" rule as every other AI service in this app. Raises
    `InvalidQuickAction` only for a genuinely unknown/wrong-role quick
    action key — that's a caller bug, not an AI failure, so it's the one
    case this function does raise for the route layer to turn into a 422."""
    validate_quick_action(actor_role, quick_action)
    fallback = _deterministic_fallback(transaction, actor_role, quick_action)
    facts = _build_facts(transaction, actor_role)
    action_label = _quick_actions_for_role(actor_role)[quick_action]
    language_name = _LANGUAGE_NAMES.get(language, "English")

    status = "error"
    result = None
    try:
        result = gateway.run_chat(
            model=gateway.DEFAULT_MODEL,
            system=TRANSACTION_ASSISTANT.template,
            tools=[],
            messages=[
                {
                    "role": "user",
                    "content": (
                        f"Language: {language_name}\n"
                        f"Caller role: {actor_role}\n"
                        f"Requested quick action: {action_label}\n\n"
                        f"Facts (use ONLY these — do not add anything not listed here):\n{facts}"
                    ),
                }
            ],
            max_tokens=400,
        )
        status = "ok"
        reply = result.reply.strip()[:1200]
        if not reply:
            raise ValueError("AI returned an empty response")
        return TransactionAssistantResult(reply=reply, generated_by="ai")
    except Exception as exc:  # noqa: BLE001 — must degrade to the deterministic fallback, never block the caller
        logger.warning("generate_response: AI call failed, using deterministic fallback: %s", exc)
        status = "error"
        return TransactionAssistantResult(reply=fallback, generated_by="fallback")
    finally:
        gateway.log_ai_call(
            feature="transaction_assistant",
            model=gateway.DEFAULT_MODEL,
            prompt=TRANSACTION_ASSISTANT,
            latency_ms=result.latency_ms if result else 0.0,
            status=status,
            user_id=user_id,
            input_tokens=result.input_tokens if result else None,
            output_tokens=result.output_tokens if result else None,
        )
