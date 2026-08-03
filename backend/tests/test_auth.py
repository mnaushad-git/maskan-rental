def test_signup_then_me(client, unique_email):
    resp = client.post("/api/auth/signup", json={"email": unique_email, "password": "S3cret!23", "full_name": "Test User"})
    assert resp.status_code == 201
    body = resp.json()
    assert body["user"]["email"] == unique_email
    token = body["access_token"]

    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["email"] == unique_email


def test_signup_duplicate_email_rejected(client, unique_email):
    payload = {"email": unique_email, "password": "S3cret!23"}
    first = client.post("/api/auth/signup", json=payload)
    assert first.status_code == 201

    second = client.post("/api/auth/signup", json=payload)
    assert second.status_code == 409


def test_login_wrong_password_rejected(client, unique_email):
    client.post("/api/auth/signup", json={"email": unique_email, "password": "S3cret!23"})

    resp = client.post("/api/auth/login", json={"email": unique_email, "password": "wrong-password"})
    assert resp.status_code == 401


def test_me_requires_auth(client):
    resp = client.get("/api/auth/me")
    assert resp.status_code == 401
