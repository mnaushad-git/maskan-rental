"""Find (and optionally remove) orphaned listing-photo files.

An orphan is a file under uploads/listings/{property_id}/{key} whose key no
`listing_images` row references any more (e.g. left behind by the former
admin hard-delete). Transaction documents (uploads/transactions) are NEVER
touched.

Safe by design:
  * dry-run by default — prints counts and candidate paths, deletes nothing;
  * only files named like an upload key (32 hex chars + .jpg/.png/.webp);
  * a file is kept if ANY listing_images row, for any property, references
    its key — re-checked immediately before each deletion;
  * files younger than --min-age-hours (default 24) are kept, so a photo
    whose upload is still in progress is never removed.

Usage (inside the backend container, or locally from backend/):
    python cleanup_orphan_listing_photos.py              # dry run
    python cleanup_orphan_listing_photos.py --delete     # remove orphans
"""
import argparse
import time

from sqlalchemy import func, select

from app.db.session import SessionLocal
from app.models.listing_image import ListingImage
from app.services import listing_media


def referenced(db, key: str) -> bool:
    return bool(
        db.scalar(
            select(func.count(ListingImage.id)).where(
                (ListingImage.url == listing_media.MEDIA_PREFIX + key)
                | ListingImage.url.contains(f"/listing-images/{key}")
            )
        )
    )


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--delete", action="store_true", help="remove orphaned files (default: dry run)")
    ap.add_argument("--min-age-hours", type=float, default=24.0)
    args = ap.parse_args()

    root = listing_media.LISTING_UPLOAD_ROOT
    if not root.is_dir():
        print(f"no listing uploads directory at {root} — nothing to do")
        return 0
    cutoff = time.time() - args.min_age_hours * 3600
    scanned = kept_ref = kept_young = kept_name = removed = 0
    orphans = []
    db = SessionLocal()
    try:
        for prop_dir in sorted(p for p in root.iterdir() if p.is_dir()):
            for f in sorted(prop_dir.iterdir()):
                if not f.is_file():
                    continue
                scanned += 1
                if not prop_dir.name.isdigit() or not listing_media.valid_key(f.name):
                    kept_name += 1
                    continue
                if referenced(db, f.name):
                    kept_ref += 1
                    continue
                if f.stat().st_mtime > cutoff:
                    kept_young += 1
                    continue
                orphans.append(f)
        for f in orphans:
            if args.delete:
                if referenced(db, f.name):  # re-check right before deleting
                    kept_ref += 1
                    continue
                f.unlink(missing_ok=True)
                removed += 1
                print(f"removed {f.relative_to(root)}")
            else:
                print(f"orphan  {f.relative_to(root)}")
    finally:
        db.close()
    print(
        f"scanned={scanned} referenced(kept)={kept_ref} too_new(kept)={kept_young} "
        f"unrecognised_name(kept)={kept_name} orphans={len(orphans)} removed={removed}"
        + ("" if args.delete else "  [dry run — nothing deleted; re-run with --delete]")
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
