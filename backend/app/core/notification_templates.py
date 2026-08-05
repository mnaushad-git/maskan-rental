"""Bilingual notification content rendering.

Every other user-facing string in this codebase is owned by the frontend's
i18n dictionaries (see Phase 1 research) because it's rendered at request
time. Notifications are different: they're generated asynchronously, hours
or days before anyone views them, by a background job that has no request
context to render into — something has to bake the text once, at creation
time, in the recipient's saved-search locale. This module is that "something",
kept deliberately small (a handful of template functions, not a full i18n
engine) and isolated so it's the only place in the backend that ships
user-facing copy.

`render()` returns (title, body, deep_link). Deep links use the same
`myhome://` / web route shapes the mobile and web apps already use for
property/search navigation.
"""
from app.models.property import Property
from app.models.property_request import PropertyRequest
from app.models.saved_search import SavedSearch

_CHANGE_TITLES = {
    "en": {
        "new_listing": "New match for '{name}'",
        "back_on_market": "Back on the market: '{name}'",
        "price_drop": "Price dropped on a property you're watching",
        "price_increase": "Price changed on a property you're watching",
        "verified": "A matching property is now verified",
        "detail_updated": "A matching property was updated",
        "digest": "{count} new matches for your saved searches",
    },
    "ar": {
        "new_listing": "تطابق جديد مع '{name}'",
        "back_on_market": "عاد للسوق: '{name}'",
        "price_drop": "انخفض سعر عقار تتابعه",
        "price_increase": "تغيّر سعر عقار تتابعه",
        "verified": "تم توثيق عقار مطابق لبحثك",
        "detail_updated": "تم تحديث عقار مطابق لبحثك",
        "digest": "{count} تطابقات جديدة لعمليات البحث المحفوظة",
    },
}

_PROPERTY_TYPE_LABEL = {
    "en": {"apartment": "apartment", "villa": "villa", "townhouse": "townhouse", "studio": "studio"},
    "ar": {"apartment": "شقة", "villa": "فيلا", "townhouse": "تاون هاوس", "studio": "استوديو"},
}


def _fmt_sar(value: float | None, locale: str) -> str:
    if value is None:
        return ""
    n = f"{value:,.0f}"
    return f"SAR {n}" if locale == "en" else f"{n} ريال"


def _property_label(prop: Property, locale: str) -> str:
    kind = _PROPERTY_TYPE_LABEL.get(locale, {}).get((prop.property_type or "").lower(), prop.property_type or ("Property" if locale == "en" else "عقار"))
    if locale == "ar":
        return f"{kind} في {prop.area}"
    return f"{kind.capitalize()} in {prop.area}"


def render(
    *,
    change_type: str,
    prop: Property,
    saved_search: SavedSearch,
    change_context: dict | None = None,
) -> tuple[str, str, str]:
    locale = saved_search.locale if saved_search.locale in ("en", "ar") else "en"
    change_context = change_context or {}
    titles = _CHANGE_TITLES.get(locale, _CHANGE_TITLES["en"])
    title = titles.get(change_type, titles["new_listing"]).format(name=saved_search.name, count=change_context.get("count", 1))

    property_label = _property_label(prop, locale)
    if change_type == "price_drop":
        old_p, new_p = change_context.get("old_price"), change_context.get("new_price")
        drop = (old_p - new_p) if (old_p and new_p) else None
        if locale == "ar":
            body = f"{property_label} — انخفض السعر من {_fmt_sar(old_p, locale)} إلى {_fmt_sar(new_p, locale)}" + (f" (توفير {_fmt_sar(drop, locale)})" if drop else "")
        else:
            body = f"{property_label} — price dropped from {_fmt_sar(old_p, locale)} to {_fmt_sar(new_p, locale)}" + (f" (save {_fmt_sar(drop, locale)})" if drop else "")
    elif change_type == "price_increase":
        old_p, new_p = change_context.get("old_price"), change_context.get("new_price")
        body = (
            f"{property_label} — تغيّر السعر من {_fmt_sar(old_p, locale)} إلى {_fmt_sar(new_p, locale)}"
            if locale == "ar"
            else f"{property_label} — price changed from {_fmt_sar(old_p, locale)} to {_fmt_sar(new_p, locale)}"
        )
    elif change_type == "back_on_market":
        body = f"{property_label} متاح مجددًا وطابق بحثك '{saved_search.name}'" if locale == "ar" else f"{property_label} is available again and matches your '{saved_search.name}' search."
    elif change_type == "verified":
        body = f"{property_label} تم توثيقه الآن من قبل المنصة." if locale == "ar" else f"{property_label} is now verified by the platform."
    elif change_type == "detail_updated":
        body = f"تم تحديث تفاصيل {property_label} لتطابق بحثك." if locale == "ar" else f"{property_label}'s details were updated to match your search."
    elif change_type == "digest":
        count = change_context.get("count", 1)
        body = (
            f"{count} عقارات جديدة تطابق '{saved_search.name}'. اضغط لعرض الكل." if locale == "ar" else f"{count} new properties match '{saved_search.name}'. Tap to view all."
        )
    else:  # new_listing
        body = f"{property_label} يطابق بحثك '{saved_search.name}'." if locale == "ar" else f"{property_label} matches your '{saved_search.name}' search."

    deep_link = f"myhome://property/{prop.id}" if change_type != "digest" else f"myhome://saved-searches/{saved_search.id}/matches"
    return title, body, deep_link


_PROPERTY_REQUEST_TITLES = {
    "en": {
        "activated": "Your property request is now active",
        "new_match": "New match for '{title}'",
        "improved_match": "A match for '{title}' just got better",
        "mediator_response": "A partner responded to '{title}'",
        "clarification_received": "Maskan AI has a question about '{title}'",
        "expiring": "Your request '{title}' is expiring soon",
        "expired": "Your request '{title}' has expired",
        "no_match_suggestion": "No matches yet for '{title}' — here's why",
        "fulfilled": "'{title}' marked as fulfilled",
    },
    "ar": {
        "activated": "طلبك العقاري أصبح نشطًا الآن",
        "new_match": "تطابق جديد مع '{title}'",
        "improved_match": "تحسّن تطابق مع '{title}'",
        "mediator_response": "قام أحد الشركاء بالرد على '{title}'",
        "clarification_received": "لدى Maskan AI سؤال بخصوص '{title}'",
        "expiring": "طلبك '{title}' سينتهي قريبًا",
        "expired": "انتهت صلاحية طلبك '{title}'",
        "no_match_suggestion": "لا توجد تطابقات بعد لـ '{title}' — إليك السبب",
        "fulfilled": "تم تحديد '{title}' كمكتمل",
    },
}

_PROPERTY_REQUEST_BODIES = {
    "en": {
        "activated": "We're now monitoring the market and will notify you as soon as matching properties appear.",
        "new_match": "{property_label} matches your request. Tap to view the details.",
        "improved_match": "{property_label} now fits your request even better than before.",
        "mediator_response": "A verified partner has properties or information for your request. Tap to review.",
        "clarification_received": "Answer a quick question to help us find better matches for you.",
        "expiring": "It expires in {days} day(s). Extend it to keep monitoring the market.",
        "expired": "This request stopped monitoring the market. You can reactivate it anytime.",
        "no_match_suggestion": "Your criteria may be too narrow. See suggestions to widen your search.",
        "fulfilled": "Glad we could help! This request is now marked as fulfilled.",
    },
    "ar": {
        "activated": "نراقب السوق الآن وسنُعلمك فور توفر عقارات مطابقة.",
        "new_match": "{property_label} يطابق طلبك. اضغط لعرض التفاصيل.",
        "improved_match": "{property_label} أصبح يطابق طلبك بشكل أفضل من ذي قبل.",
        "mediator_response": "لدى أحد الشركاء الموثوقين عقارات أو معلومات بخصوص طلبك. اضغط للمراجعة.",
        "clarification_received": "أجب عن سؤال سريع لمساعدتنا في إيجاد تطابقات أفضل لك.",
        "expiring": "سينتهي خلال {days} يوم/أيام. مدّده لمواصلة مراقبة السوق.",
        "expired": "توقف هذا الطلب عن مراقبة السوق. يمكنك إعادة تفعيله في أي وقت.",
        "no_match_suggestion": "قد تكون معاييرك ضيقة جدًا. اطّلع على اقتراحات لتوسيع بحثك.",
        "fulfilled": "يسعدنا أننا ساعدناك! تم تحديد هذا الطلب كمكتمل.",
    },
}


def render_property_request(
    *,
    change_type: str,
    request: PropertyRequest,
    prop: Property | None = None,
    match_id: int | None = None,
    context: dict | None = None,
) -> tuple[str, str, str]:
    """Bilingual copy for property_request.* notifications (Phase 11). Same
    "bake once at creation time" rationale as `render()` above — these are
    generated by background matching/lifecycle jobs, not request handlers."""
    locale = request.locale if request.locale in ("en", "ar") else "en"
    context = context or {}
    titles = _PROPERTY_REQUEST_TITLES.get(locale, _PROPERTY_REQUEST_TITLES["en"])
    bodies = _PROPERTY_REQUEST_BODIES.get(locale, _PROPERTY_REQUEST_BODIES["en"])

    title = titles.get(change_type, titles["new_match"]).format(title=request.title)
    property_label = _property_label(prop, locale) if prop else ("This property" if locale == "en" else "هذا العقار")
    body = bodies.get(change_type, bodies["new_match"]).format(property_label=property_label, days=context.get("days", 0))

    if match_id is not None:
        deep_link = f"myhome://property-requests/{request.id}/matches/{match_id}"
    else:
        deep_link = f"myhome://property-requests/{request.id}"
    return title, body, deep_link
