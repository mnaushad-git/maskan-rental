# Deploying as maskan.trunexus.ai on Hostinger

This guide is for adding the app as a subdomain of your existing
trunexus.ai domain on Hostinger. Written for someone doing this for
the first time.

**Total time:** About 1.5–2 hours.
**Cost:** Uses your existing Hostinger VPS — no extra server needed.

---

## Before you start — one thing you MUST check

This app requires a **VPS** (Virtual Private Server) — a real Linux
machine where you have full control. It cannot run on shared hosting.

Log in to Hostinger → look at what plan trunexus.ai is on:

| Plan type | Can run this app? |
|---|---|
| **VPS** (any size) | Yes — follow this guide |
| **Cloud Hosting** | Yes — it's a VPS underneath |
| **Shared Hosting / Business Hosting** | No — you cannot install Docker on it |

If you are on shared hosting, you have two options:
- Upgrade to Hostinger VPS (KVM 2 or higher, ~$10/month)
- Or use a separate AWS Lightsail server and follow `DEPLOY.md` instead

**Assuming you have a VPS — continue below.**

---

## Why this guide is different from DEPLOY.md

In `DEPLOY.md` we used Caddy to handle HTTPS. But your Hostinger VPS
already has Nginx running on ports 80 and 443 for trunexus.ai. Two
programs cannot share the same port — so instead:

- The app runs in Docker on **internal ports only** (not exposed to internet)
- Your existing **Nginx** handles the HTTPS padlock for maskan.trunexus.ai
- Nginx forwards requests to the app behind the scenes

Think of it like this:

```
Internet → Nginx (port 443, handles SSL)
               ├── trunexus.ai       → serves your existing site
               └── maskan.trunexus.ai → forwards to Docker app (port 3000)
                                            ├── Frontend  (port 3000)
                                            └── Backend   (port 8000)
                                                └── Database (internal)
```

---

## Step 1 — Add the subdomain in Hostinger (10 minutes)

This tells the internet that maskan.trunexus.ai points to your server.

1. Log in to **hpanel.hostinger.com**

2. Click **Domains** in the left menu

3. Click on **trunexus.ai**

4. Click **DNS / Nameservers** tab

5. Scroll down to **DNS Records** — click **Add Record**

6. Fill in:
   ```
   Type:  A
   Name:  maskan
   Value: (your VPS IP address)
   TTL:   3600
   ```
   The VPS IP is shown in Hostinger → **VPS** section, on your server card.

7. Click **Save**

**Check progress:** Go to **dnschecker.org**, type `maskan.trunexus.ai`
and watch for your server IP to appear. Usually takes 5–30 minutes.

---

## Step 2 — Connect to your server (5 minutes)

You need to type commands on your Hostinger VPS.

**Option A — Hostinger browser terminal (easiest):**
1. Hostinger hPanel → **VPS**
2. Click your server
3. Click **"Terminal"** or **"Connect"** → opens a terminal in the browser

**Option B — PowerShell on your Windows laptop:**
```powershell
ssh root@your-vps-ip
```
Replace `your-vps-ip` with the IP shown in Hostinger.
Type `yes` when asked about the connection, then enter your root password.

You are now inside the server. The prompt looks like:
```
root@your-server:~#
```

---

## Step 3 — Check what web server is running (2 minutes)

Type this command and press Enter:

```bash
nginx -v
```

If you see a version number like `nginx version: nginx/1.24.0` — great,
Nginx is installed. This guide is written for Nginx.

If you see `apache2 -v` output instead, let me know — the Nginx config
steps below will be slightly different.

---

## Step 4 — Install Docker (10 minutes)

Type these commands one at a time, press Enter after each, wait for it
to finish before typing the next:

```bash
curl -fsSL https://get.docker.com | sudo sh
```
*Installs Docker — takes about 1 minute.*

```bash
sudo usermod -aG docker $USER
```
*Gives your user permission to run Docker.*

```bash
newgrp docker
```
*Applies the permission immediately.*

```bash
docker --version
```
You should see: `Docker version 26.x.x` — means it worked.

---

## Step 5 — Copy your code onto the server (5 minutes)

```bash
git clone https://github.com/mnaushad-git/maskan-rental.git
```
*Downloads the app from GitHub onto the server.*

```bash
cd maskan-rental
```
*Moves into the app folder.*

---

## Step 6 — Create your secrets file (15 minutes)

### 6a — Generate a secure secret key

```bash
openssl rand -hex 32
```
Copy the long string it outputs — you will paste it in the next step.

### 6b — Create the file

```bash
cp .env.production.example .env.production
nano .env.production
```

Use arrow keys to move around the file and edit these values:

```
FRONTEND_ORIGIN=https://maskan.trunexus.ai
DOMAIN=maskan.trunexus.ai
ACME_EMAIL=mnaushad.aws@gmail.com

SECRET_KEY=paste-the-long-key-from-step-6a-here

DB_PASSWORD=make-up-a-strong-password-like-Xk9mP2vQ8r
DB_USER=maskan_app
DB_NAME=maskan

ADMIN_EMAILS=mnaushad.aws@gmail.com

ANTHROPIC_API_KEY=sk-ant-your-key-here
```

Save and exit:
- Press **Ctrl + X**
- Press **Y**
- Press **Enter**

---

## Step 7 — Start the app (25 minutes)

This version does **not** use Caddy — Nginx handles SSL instead.
Use the special Hostinger compose file:

```bash
docker compose -f docker-compose.hostinger.yml --env-file .env.production up -d --build
```

The first run downloads and compiles everything — takes 15–25 minutes.
A lot of text will scroll by; this is normal.

When finished, check that all services are running:

```bash
docker compose -f docker-compose.hostinger.yml ps
```

You should see:
```
NAME                          STATUS
maskanrental-db-1             running (healthy)
maskanrental-redis-1          running (healthy)
maskanrental-backend-1        running (healthy)
maskanrental-worker-1         running (healthy)
maskanrental-frontend-1       running
```

`redis` backs the cache/rate-limiting/job-queue infrastructure and `worker`
processes background jobs (lead matching, area-intelligence refresh, the
outbox publisher) — both are internal-only, nothing new to open in Nginx.
If either shows `unhealthy` after a minute, check its logs (`docker compose
-f docker-compose.hostinger.yml logs redis` / `logs worker`) — but note the
app keeps working without them (degraded: no caching/rate-limiting, jobs run
inline in the `backend` container instead), so this is not launch-blocking.

### Verify the app is listening internally

```bash
curl http://localhost:3000
```
If you see HTML output — the frontend is up.

```bash
curl http://localhost:8000/api/health
```
If you see `{"status":"ok"}` — the backend is up.

```bash
curl http://localhost:8000/api/health/ready
```
Shows `{"status":"ready","checks":{"database":"ok","redis":"ok"}}` once both
dependencies are reachable — `redis: "unavailable"` here is informational
only and never blocks readiness.

---

## Step 8 — Seed the database (5 minutes)

```bash
docker compose -f docker-compose.hostinger.yml --env-file .env.production exec backend python seed.py
```
*Creates 66 sample properties and your admin account.*

```bash
docker compose -f docker-compose.hostinger.yml --env-file .env.production exec backend python seed_areas.py
```
*Loads 16 area intelligence profiles.*

---

## Step 9 — Configure Nginx for maskan.trunexus.ai (15 minutes)

This tells Nginx "when someone visits maskan.trunexus.ai, forward
the request to the app running on port 3000."

### 9a — Create the Nginx config file

```bash
sudo nano /etc/nginx/sites-available/maskan.trunexus.ai
```

Paste this entire block (copy carefully, every character matters):

```nginx
server {
    listen 80;
    server_name maskan.trunexus.ai;

    # Redirect all HTTP to HTTPS
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name maskan.trunexus.ai;

    # SSL certificates — filled in by Certbot in Step 10
    ssl_certificate /etc/letsencrypt/live/maskan.trunexus.ai/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/maskan.trunexus.ai/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # Increase max upload size
    client_max_body_size 20M;

    # API requests → FastAPI backend
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Everything else → SSR frontend
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
    }
}
```

Save and exit (Ctrl+X → Y → Enter).

### 9b — Enable the config

```bash
sudo ln -s /etc/nginx/sites-available/maskan.trunexus.ai /etc/nginx/sites-enabled/
```
*Creates a shortcut so Nginx loads this config.*

### 9c — Test the config for errors

```bash
sudo nginx -t
```
You should see: `nginx: configuration file /etc/nginx/nginx.conf test is successful`

If you see errors, check that you copied the config block exactly.

### 9d — Reload Nginx to apply it

```bash
sudo systemctl reload nginx
```

---

## Step 10 — Get the HTTPS certificate (10 minutes)

Certbot gets a free SSL certificate from Let's Encrypt for your
subdomain — this is what gives you the padlock in the browser.

### 10a — Install Certbot (if not already installed)

```bash
sudo apt install certbot python3-certbot-nginx -y
```

### 10b — Get the certificate

```bash
sudo certbot --nginx -d maskan.trunexus.ai
```

Certbot will:
1. Ask for your email address — type it and press Enter
2. Ask you to agree to terms — type `Y`
3. Ask if you want to share email with EFF — type `N`
4. Automatically get the certificate and update your Nginx config

**Important:** This step only works AFTER the DNS from Step 1 has
propagated. If it fails with "DNS problem", wait 30 more minutes
and try again.

### 10c — Verify auto-renewal works

```bash
sudo certbot renew --dry-run
```
Should show `Congratulations, all simulated renewals succeeded.`

The certificate renews automatically every 90 days — no action needed.

---

## Step 11 — Final check (10 minutes)

1. Open your browser and go to **https://maskan.trunexus.ai**

2. You should see the padlock and the Maskan home page with properties.

3. Test these things:
   - Home page loads
   - Search for "Riyadh" — results appear
   - Go to `/areas` — Area Intelligence page loads with district cards
   - Go to `/admin` — sign in with `mnaushad.aws@gmail.com` / `Admin@1234`
   - **Change your password immediately**
   - Go to `/partner/register` — create a test partner account

4. Check that trunexus.ai still works normally — this confirms you
   haven't broken your existing site.

---

## If something goes wrong

### App not loading — check Docker is still running:
```bash
docker compose -f docker-compose.hostinger.yml ps
```

### See the app's error messages:
```bash
docker compose -f docker-compose.hostinger.yml logs --tail=50
```

### Nginx errors:
```bash
sudo tail -50 /var/log/nginx/error.log
```

### Certificate errors in browser:
```bash
sudo certbot certificates
```
Check that maskan.trunexus.ai is listed and not expired.

### Test app is reachable internally:
```bash
curl -v http://localhost:3000
curl -v http://localhost:8000/api/health
```
Both should return responses. If not — the Docker containers stopped.

### Most common problems:

| Problem | Likely cause | Fix |
|---|---|---|
| "502 Bad Gateway" | Docker stopped | `docker compose -f docker-compose.hostinger.yml up -d` |
| "SSL certificate invalid" | Certbot step not done | Re-run Step 10 |
| "DNS problem" during Certbot | DNS not propagated yet | Wait 30 min, retry |
| trunexus.ai broken | Nginx config error | `sudo nginx -t` to find the error |
| "Permission denied" for Docker | Group not applied | Run `newgrp docker` |

---

## Keeping it running

### Update after code changes:

```bash
cd ~/maskan-rental
git pull
docker compose -f docker-compose.hostinger.yml --env-file .env.production up -d --build
```

### App auto-restarts on server reboot

Docker is configured with `restart: always` — all containers come
back automatically when the VPS restarts.

### Hostinger VPS auto-backups

Enable in hPanel → VPS → your server → **Backups** → turn on weekly
snapshots. This saves everything including the database.

---

## Quick reference — useful commands

```bash
# Check all services running
docker compose -f docker-compose.hostinger.yml ps

# View live logs
docker compose -f docker-compose.hostinger.yml logs -f

# Restart app
docker compose -f docker-compose.hostinger.yml restart

# Stop app
docker compose -f docker-compose.hostinger.yml down

# Start app (after stopping)
docker compose -f docker-compose.hostinger.yml --env-file .env.production up -d

# Re-seed database
docker compose -f docker-compose.hostinger.yml --env-file .env.production exec backend python seed.py
docker compose -f docker-compose.hostinger.yml --env-file .env.production exec backend python seed_areas.py

# Nginx — test and reload config
sudo nginx -t
sudo systemctl reload nginx

# Renew SSL certificate manually (usually auto-renews)
sudo certbot renew
```
