def test_response_echoes_request_id_header(client):
    resp = client.get("/api/health", headers={"X-Request-ID": "abc-123"})
    assert resp.headers["X-Request-ID"] == "abc-123"


def test_response_generates_request_id_when_absent(client):
    resp = client.get("/api/health")
    assert resp.headers["X-Request-ID"]  # non-empty, generated


def test_error_envelope_preserves_detail_and_adds_code_and_trace_id(client):
    resp = client.get("/api/auth/me")  # no auth header -> 401
    assert resp.status_code == 401
    body = resp.json()
    assert body["detail"] == "Not authenticated"
    assert body["code"] == "unauthorized"
    assert body["trace_id"]


def test_validation_error_keeps_default_detail_shape(client):
    resp = client.post("/api/auth/signup", json={"email": "not-an-email", "password": "x"})
    assert resp.status_code == 422
    body = resp.json()
    assert isinstance(body["detail"], list)
    assert body["code"] == "validation_error"


def test_v1_alias_matches_legacy_path(client):
    legacy = client.get("/api/properties/", params={"limit": 1})
    v1 = client.get("/api/v1/properties/", params={"limit": 1})
    assert legacy.status_code == v1.status_code == 200


def test_readiness_reports_database_ok(client):
    resp = client.get("/api/health/ready")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ready"
    assert body["checks"]["database"] == "ok"
    # Redis is optional infra: reported for visibility, never blocks readiness.
    assert body["checks"]["redis"] in {"ok", "unavailable"}
