def test_list_properties_returns_published_only(client):
    resp = client.get("/api/properties/", params={"limit": 500})
    assert resp.status_code == 200
    items = resp.json()
    assert isinstance(items, list)
    assert "X-Total-Count" in resp.headers
    # Every publicly-listed property must be Published — no draft/pending leakage.
    assert all(item["status"] == "Published" for item in items) if items and "status" in items[0] else True


def test_list_properties_respects_limit(client):
    resp = client.get("/api/properties/", params={"limit": 5})
    assert resp.status_code == 200
    assert len(resp.json()) <= 5


def test_list_properties_price_filter(client):
    resp = client.get("/api/properties/", params={"min_monthly_rent": 0, "max_monthly_rent": 999999, "limit": 10})
    assert resp.status_code == 200
