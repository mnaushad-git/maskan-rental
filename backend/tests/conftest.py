"""
Shared test fixtures.

Tests run against the real local Postgres database (there is no separate
test DB in this project yet). Isolation is achieved by wrapping each test in
an outer transaction that is always rolled back, using SQLAlchemy's
"join an external transaction" recipe (`join_transaction_mode="create_savepoint"`)
so that `db.commit()` calls inside route handlers only commit a SAVEPOINT,
never the outer transaction. Seeded data (properties, admin user, etc.) is
therefore never mutated by the test suite.
"""
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import get_db
from app.db.session import engine
from app.main import app


@pytest.fixture()
def db_session():
    connection = engine.connect()
    trans = connection.begin()
    TestSessionLocal = sessionmaker(bind=connection, join_transaction_mode="create_savepoint")
    session: Session = TestSessionLocal()
    try:
        yield session
    finally:
        session.close()
        trans.rollback()
        connection.close()


@pytest.fixture()
def client(db_session):
    def _override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    try:
        # Deliberately not using `with TestClient(app) as c` — that would run
        # the app's lifespan and start the real APScheduler jobs (nightly area
        # refresh, assignment expiry), which we don't want firing in tests.
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.fixture()
def unique_email() -> str:
    return f"test-{uuid.uuid4().hex[:12]}@example.com"
