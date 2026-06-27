"""
Add closure-request fields to the leads table.
Run once from the backend/ directory:
    python migrate_closure_fields.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from sqlalchemy import text
from app.db.session import engine

DDL = [
    "ALTER TABLE leads ADD COLUMN IF NOT EXISTS closure_outcome VARCHAR(30)",
    "ALTER TABLE leads ADD COLUMN IF NOT EXISTS closure_note TEXT",
    "ALTER TABLE leads ADD COLUMN IF NOT EXISTS closure_requested_at TIMESTAMPTZ",
    (
        "ALTER TABLE leads ADD COLUMN IF NOT EXISTS "
        "closure_requested_by_mediator_id INT "
        "REFERENCES mediators(id) ON DELETE SET NULL"
    ),
]

with engine.begin() as conn:
    for stmt in DDL:
        conn.execute(text(stmt))
        print(f"  OK: {stmt[:60]}…")

print("Migration complete.")
