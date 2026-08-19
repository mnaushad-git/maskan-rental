"""Partner Listing Quality — deterministic image-quality signals (spec
section 9). No computer vision, no LLM: every signal is a plain presence/
format check over `Property.listing_images` (only `url` + `display_order`
exist on `ListingImage` today — see `app/models/listing_image.py`). The
low-resolution check is written against an optional `width`/`height`
attribute via `getattr(..., None)` so it is safe to call today (always
inert, no column exists yet) and activates automatically if a future
migration adds those columns — the same forward-compatible pattern Prompt 1
used for `Property.availability_confirmed_at` before Prompt 2 added it.

This is intentionally a standalone service, not a sixth Trust Model
component: the Trust Model's five components + weights are Prompt 1's
already-shipped, documented contract (`trust_config.TRUST_COMPONENT_WEIGHTS`)
and this prompt's scope is the partner-facing Listing Quality panel only —
`GET /partner/properties/{id}/quality` surfaces this result alongside (not
inside) the reused completeness score.
"""
from dataclasses import dataclass, field

from app.core.trust_config import (
    IMAGE_QUALITY_MIN_HEIGHT_PX,
    IMAGE_QUALITY_MIN_IMAGES,
    IMAGE_QUALITY_MIN_WIDTH_PX,
)
from app.models.property import Property


@dataclass
class ImageQualityIssue:
    code: str
    severity: str  # "info" | "warning" | "blocking"
    message: str


@dataclass
class ImageQualityResult:
    image_count: int
    issues: list[ImageQualityIssue] = field(default_factory=list)

    @property
    def has_blocking_issues(self) -> bool:
        return any(i.severity == "blocking" for i in self.issues)


def assess_image_quality(prop: Property) -> ImageQualityResult:
    images = sorted(prop.listing_images or [], key=lambda i: i.display_order)
    issues: list[ImageQualityIssue] = []

    if not images:
        issues.append(
            ImageQualityIssue(
                code="no_images",
                severity="blocking",
                message="No photos have been added yet. Listings with photos get significantly more interest.",
            )
        )
        return ImageQualityResult(image_count=0, issues=issues)

    if len(images) < IMAGE_QUALITY_MIN_IMAGES:
        issues.append(
            ImageQualityIssue(
                code="too_few_images",
                severity="warning",
                message=f"Only {len(images)} photo(s) added — add at least {IMAGE_QUALITY_MIN_IMAGES} for a stronger listing.",
            )
        )

    # Duplicate image references — same URL used more than once.
    seen: set[str] = set()
    duplicate_count = 0
    for img in images:
        url = (img.url or "").strip().lower()
        if not url:
            continue
        if url in seen:
            duplicate_count += 1
        else:
            seen.add(url)
    if duplicate_count:
        issues.append(
            ImageQualityIssue(
                code="duplicate_images",
                severity="info",
                message=f"{duplicate_count} photo(s) appear to be duplicated — consider replacing with different angles or rooms.",
            )
        )

    # Missing primary image — the first (display_order 0) photo has no valid
    # URL. Defensive today (property image-add endpoints always assign a
    # non-blank URL and a sequential display_order), but kept as an explicit
    # check rather than assumed, since nothing in this model enforces it at
    # the DB level.
    primary = images[0]
    if not (primary.url or "").strip():
        issues.append(
            ImageQualityIssue(
                code="missing_primary_image",
                severity="warning",
                message="The main (first) photo is missing a valid image — add a clear cover photo.",
            )
        )

    # Low resolution — inert until ListingImage gains width/height columns.
    low_res_count = sum(
        1
        for img in images
        if getattr(img, "width", None) is not None
        and getattr(img, "height", None) is not None
        and (img.width < IMAGE_QUALITY_MIN_WIDTH_PX or img.height < IMAGE_QUALITY_MIN_HEIGHT_PX)
    )
    if low_res_count:
        issues.append(
            ImageQualityIssue(
                code="low_resolution",
                severity="info",
                message=f"{low_res_count} photo(s) are below the recommended {IMAGE_QUALITY_MIN_WIDTH_PX}x{IMAGE_QUALITY_MIN_HEIGHT_PX}px resolution.",
            )
        )

    return ImageQualityResult(image_count=len(images), issues=issues)
