from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import settings

# Small pool for a small test VM: recycle connections after 60s of age and
# pre-ping before use so a connection Postgres has already timed out (see
# idle_in_transaction_session_timeout / idle_session_timeout) is silently
# replaced instead of raising, and fail fast on checkout instead of the
# default 30s so a saturated pool surfaces immediately rather than hanging.
engine = create_engine(
    settings.DATABASE_URL,
    future=True,
    pool_size=5,
    max_overflow=5,
    pool_timeout=10,
    pool_recycle=60,
    pool_pre_ping=True,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

from app.core.db_metrics import register_engine_metrics  # noqa: E402

register_engine_metrics(engine)
