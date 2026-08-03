"""Model gateway: the one place in the app that talks to an LLM provider
directly. Route handlers call `run_chat()` (or drive `get_client()` for the
streaming case, which needs to yield deltas as they arrive) instead of
constructing their own `Anthropic(...)` client — this is what lets a second
provider be added later, or the model swapped per use-case, without touching
every call site.

Token usage / cost / latency are logged via `log_ai_call()` for every call
(streaming or not). Costs are best-effort estimates from a hardcoded pricing
table (update `_PRICING_PER_MILLION_TOKENS_USD` if Anthropic's published
pricing changes) and usage extraction is defensive — a missing `.usage`
attribute degrades to `None` fields rather than breaking the actual chat
response, since that's a real, working, revenue-relevant feature and this
logging is diagnostic, not load-bearing.
"""
import logging
import time
from dataclasses import dataclass

from anthropic import Anthropic

from app.core.ai.prompts import PromptDefinition
from app.core.config import settings
from app.core.metrics import record_ai_call
from app.core.request_context import get_request_id
from app.db.session import SessionLocal
from app.models.ai_call_log import AICallLog

logger = logging.getLogger("app.ai.gateway")

DEFAULT_MODEL = "claude-sonnet-4-6"

# USD per 1M tokens. Unknown models simply return no cost estimate rather
# than guessing — never assert a cost figure that might be wrong.
_PRICING_PER_MILLION_TOKENS_USD = {
    "claude-sonnet-4-6": {"input": 3.0, "output": 15.0},
}

_client: Anthropic | None = None


def get_client() -> Anthropic:
    global _client
    if _client is None:
        _client = Anthropic(api_key=settings.ANTHROPIC_API_KEY, timeout=60.0, max_retries=2)
    return _client


def estimate_cost_usd(model: str, input_tokens: int | None, output_tokens: int | None) -> float | None:
    pricing = _PRICING_PER_MILLION_TOKENS_USD.get(model)
    if not pricing or input_tokens is None or output_tokens is None:
        return None
    return (input_tokens * pricing["input"] + output_tokens * pricing["output"]) / 1_000_000


@dataclass
class ChatResult:
    reply: str
    input_tokens: int | None = None
    output_tokens: int | None = None
    latency_ms: float = 0.0


def run_chat(
    *,
    model: str,
    system: str,
    tools: list,
    messages: list[dict],
    max_tokens: int = 1500,
) -> ChatResult:
    """Non-streaming chat completion via the Anthropic tool runner."""
    client = get_client()
    started = time.monotonic()
    runner = client.beta.messages.tool_runner(model=model, max_tokens=max_tokens, system=system, tools=tools, messages=messages)
    final = None
    for message in runner:
        final = message
    latency_ms = (time.monotonic() - started) * 1000

    if final is None:
        raise RuntimeError("AI error: no response generated")

    reply = "".join(block.text for block in final.content if block.type == "text")
    input_tokens = output_tokens = None
    try:
        usage = getattr(final, "usage", None)
        if usage is not None:
            input_tokens = getattr(usage, "input_tokens", None)
            output_tokens = getattr(usage, "output_tokens", None)
    except Exception as exc:  # noqa: BLE001 — usage extraction must never break a working chat reply
        logger.debug("run_chat: could not extract token usage: %s", exc)

    return ChatResult(reply=reply, input_tokens=input_tokens, output_tokens=output_tokens, latency_ms=latency_ms)


def log_ai_call(
    *,
    feature: str,
    model: str,
    prompt: PromptDefinition,
    latency_ms: float,
    status: str,
    user_id: int | None = None,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
) -> None:
    """Best-effort logging — runs in its own DB session so it can never
    interfere with (or be rolled back by) the request's own transaction, and
    never raises: a logging failure must not turn into a 500 for the user."""
    cost = estimate_cost_usd(model, input_tokens, output_tokens)
    record_ai_call(feature=feature, status=status, latency_ms=latency_ms, input_tokens=input_tokens, output_tokens=output_tokens, cost_usd=cost)

    db = SessionLocal()
    try:
        db.add(
            AICallLog(
                feature=feature,
                model=model,
                prompt_name=prompt.name,
                prompt_version=prompt.version,
                user_id=user_id,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                latency_ms=latency_ms,
                status=status,
                cost_estimate_usd=cost,
                trace_id=get_request_id(),
            )
        )
        db.commit()
    except Exception as exc:  # noqa: BLE001 — logging must never break the caller
        logger.warning("log_ai_call: failed to record AI call log: %s", exc)
    finally:
        db.close()
