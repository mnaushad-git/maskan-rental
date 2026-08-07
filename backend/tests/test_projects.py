from app.models.project import Project, ProjectImage, ProjectUnit


def _make_project(db, **overrides) -> Project:
    defaults = dict(
        title="Test Towers",
        city="Riyadh",
        area="Al Yasmin",
        status="Available",
        completion_status="Ready",
        property_category="Apartment",
        price_min=1000000.0,
        price_max=1500000.0,
        area_min=120,
        area_max=180,
        unit_count=10,
        developer_name="Test Developer",
    )
    defaults.update(overrides)
    project = Project(**defaults)
    db.add(project)
    db.flush()
    return project


def test_list_projects_returns_items(client, db_session):
    _make_project(db_session, title="Alpha Project")
    db_session.commit()

    resp = client.get("/api/projects/", params={"limit": 500})
    assert resp.status_code == 200
    items = resp.json()
    assert isinstance(items, list)
    assert "X-Total-Count" in resp.headers
    assert any(item["title"] == "Alpha Project" for item in items)


def test_list_projects_city_filter(client, db_session):
    _make_project(db_session, title="Riyadh Project", city="Riyadh", external_id="PRJ-TEST-1")
    _make_project(db_session, title="Jeddah Project", city="Jeddah", external_id="PRJ-TEST-2")
    db_session.commit()

    resp = client.get("/api/projects/", params={"city": "Jeddah", "limit": 500})
    assert resp.status_code == 200
    items = resp.json()
    assert all(item["city"] == "Jeddah" for item in items)
    assert any(item["title"] == "Jeddah Project" for item in items)


def test_get_project_returns_units_and_images_and_increments_views(client, db_session):
    project = _make_project(db_session, views_count=0)
    db_session.add(ProjectUnit(project_id=project.id, unit_type="Floor", price=2000000.0, area_sq_m=300, bedrooms=4, bathrooms=4))
    db_session.add(ProjectImage(project_id=project.id, url="https://example.com/1.jpg", display_order=0))
    db_session.commit()

    resp = client.get(f"/api/projects/{project.id}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["views_count"] == 1
    assert len(body["units"]) == 1
    assert body["units"][0]["unit_type"] == "Floor"
    assert len(body["images"]) == 1

    resp2 = client.get(f"/api/projects/{project.id}")
    assert resp2.json()["views_count"] == 2


def test_get_project_not_found(client):
    resp = client.get("/api/projects/999999999")
    assert resp.status_code == 404


def test_similar_projects_excludes_self_and_orders_by_price(client, db_session):
    base = _make_project(db_session, title="Base Project", city="Riyadh", area="Al Yasmin", price_min=1000000.0)
    close = _make_project(db_session, title="Close Project", city="Riyadh", area="Al Yasmin", price_min=1050000.0)
    far = _make_project(db_session, title="Far Project", city="Riyadh", area="Al Malqa", price_min=5000000.0)
    other_city = _make_project(db_session, title="Other City Project", city="Jeddah", area="Al Yasmin", price_min=1000000.0)
    db_session.commit()

    # Real seeded demo projects also live in this city/price range (tests run
    # against the shared local DB, see conftest.py), so use a high limit —
    # otherwise "far" can be pushed out of a small top-N by seed data rather
    # than by this test's own fixtures.
    resp = client.get(f"/api/projects/{base.id}/similar", params={"limit": 20})
    assert resp.status_code == 200
    items = resp.json()
    ids = [item["id"] for item in items]
    assert base.id not in ids
    assert other_city.id not in ids
    assert close.id in ids
    assert far.id in ids
    assert ids.index(close.id) < ids.index(far.id)


def test_similar_projects_not_found(client):
    resp = client.get("/api/projects/999999999/similar")
    assert resp.status_code == 404
