"""App deep-link builder — the single place the backend names the mobile
app's URL scheme.

Every notification `deep_link` is built through `app_link()` so the scheme
can never drift between notification types again (historically leads /
saved searches / property requests emitted `myhome://` while viewings /
negotiations / transactions emitted `mymakan://`).

`maskan://` is the permanent primary scheme. The mobile app (app.json
`scheme`) and the web resolver (frontend/src/lib/notificationDisplay.ts)
still accept the legacy `myhome://` and `mymakan://` schemes, so
notification rows already stored in the database keep routing correctly —
nothing here rewrites existing data.
"""

DEEP_LINK_SCHEME = "maskan"
LEGACY_DEEP_LINK_SCHEMES = ("myhome", "mymakan")


def app_link(path: str) -> str:
    """`app_link("property/5")` -> `"maskan://property/5"`."""
    return f"{DEEP_LINK_SCHEME}://{path.lstrip('/')}"
