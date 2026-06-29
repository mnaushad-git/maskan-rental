# Deployment Guide — Step by Step

This guide takes you from zero to a live production website.
Written for someone doing this for the first time.

**Total time:** About 2–3 hours of active work.
**Cost:** Around $10–20 / month for the server.

---

## Before you start — what you need

- [ ] A domain name (e.g. `dhaki.sa` or `dhaki.ai`) — we will buy this in Step 2
- [ ] An AWS account — create one free at aws.amazon.com if you don't have one
- [ ] Your Anthropic API key (for the AI advisor feature)
- [ ] This code already on GitHub (done — it's at github.com/mnaushad-git/maskan-rental)

---

## Overview — what we are doing

Think of it like opening a shop:

1. **Rent a building** — get a server in the cloud (your 24/7 computer)
2. **Get a street address** — buy a domain name
3. **Put up a sign** — point the domain at your server
4. **Unlock the building** — connect to the server remotely
5. **Set up the shop** — install the software needed to run the app
6. **Put stock on shelves** — copy your code onto the server
7. **Fill in the secrets** — passwords, API keys
8. **Open the doors** — start the app and go live

---

## Step 1 — Get a server (15 minutes)

We will use **AWS Lightsail** — it is the simplest AWS service,
like renting a computer that runs 24/7 in the cloud.
We will pick the **Bahrain** region so the site is fast for Saudi users.

1. Go to **lightsail.aws.amazon.com** and sign in

2. Click the orange **"Create instance"** button

3. Under **"Instance location"** click **"Change"**
   - Select region: **Middle East (Bahrain) — me-south-1**

4. Under **"Select a platform"** choose **Linux / Unix**

5. Under **"Select a blueprint"** choose **OS Only → Ubuntu 24.04 LTS**

6. Under **"Choose your instance plan"** select the **$20/month** plan
   - This gives you 4 GB RAM — enough for the app, database, and Caddy all together
   - (The $10 plan works too but can be tight during the first build)

7. Under **"Identify your instance"** type a name like `maskan-production`

8. Click **"Create instance"** — it takes about 2 minutes to start

9. Once it shows a green "Running" status, note down the **Public IP address**
   shown on the instance card (looks like `123.456.789.0`)

---

## Step 2 — Buy a domain name (15 minutes)

If you already have a domain, skip to Step 3.

Go to one of these registrars and search for your chosen name:
- **namecheap.com** — easy to use, good prices
- **godaddy.com** — very common, slightly pricier
- For `.sa` domains, you must go through **nic.sa** (Saudi NIC) — requires CR number

**Tip:** If you want to launch quickly without a `.sa` domain,
buy a `.com` or `.ai` version of your name to start.
You can always add `.sa` later once the business is registered.

Buy the domain and come back here.

---

## Step 3 — Point your domain at the server (10 minutes + waiting)

This tells the internet "when someone types my domain, send them to my server."

1. Log in to wherever you bought the domain (Namecheap, GoDaddy, etc.)

2. Find the **DNS settings** or **Nameservers** section for your domain

3. Find where it says **"A Record"** and set it like this:
   ```
   Type:  A
   Host:  @          (this means the root domain — yoursite.com)
   Value: 123.456.789.0   (paste YOUR server's public IP from Step 1)
   TTL:   Automatic or 3600
   ```

4. Add a second A record for `www`:
   ```
   Type:  A
   Host:  www
   Value: 123.456.789.0   (same IP)
   TTL:   Automatic or 3600
   ```

5. Save the settings

**Important:** DNS changes can take anywhere from 5 minutes to 48 hours
to spread across the internet. Usually it is under 30 minutes.
You can check progress at **dnschecker.org** — type your domain and
you should start seeing your server IP appear.

---

## Step 4 — Connect to your server (10 minutes)

This opens a "command line" window directly into your server — like
sitting in front of it, typing commands.

### On Windows (you are on Windows):

1. Open **PowerShell** (press Windows key, type PowerShell, hit Enter)

2. In Lightsail, click on your instance name, then click the
   **"Connect using SSH"** button — this opens a browser-based terminal.
   Use this for now — it works without any extra setup.

   Or, to use PowerShell directly:
   - In Lightsail, go to your instance → **"Account"** → **"SSH keys"**
   - Download the default key (a `.pem` file)
   - In PowerShell type:
     ```powershell
     ssh -i "C:\path\to\your-key.pem" ubuntu@123.456.789.0
     ```
     Replace with your actual key path and server IP.

3. When asked "Are you sure you want to continue connecting?" type `yes` and press Enter

4. You are now inside your server. The prompt will look like:
   ```
   ubuntu@ip-123-456-789-0:~$
   ```
   Everything you type now runs on the server, not your laptop.

---

## Step 5 — Set up the server (20 minutes)

Type these commands one by one. Each line is a separate command —
press Enter after each one and wait for it to finish before typing the next.

### 5a — Update the server's software

```bash
sudo apt update && sudo apt upgrade -y
```
*This updates the server like Windows Update — takes 2–3 minutes.*

### 5b — Install Docker

Docker is the software that runs your app. Think of it as the engine
that powers everything.

```bash
curl -fsSL https://get.docker.com | sudo sh
```
*Downloads and installs Docker — takes about 1 minute.*

```bash
sudo usermod -aG docker ubuntu
```
*Gives your user permission to run Docker.*

```bash
newgrp docker
```
*Applies the permission without needing to log out.*

### 5c — Verify Docker is working

```bash
docker --version
```
You should see something like: `Docker version 26.x.x`

### 5d — Open the firewall ports

In Lightsail, your server has a firewall. You need to open the doors
for web traffic:

1. Go back to Lightsail in your browser
2. Click your instance name
3. Click the **"Networking"** tab
4. Under **"Firewall"** click **"Add rule"**
5. Add these two rules:
   ```
   Application: HTTPS    Port: 443    Protocol: TCP
   Application: HTTP     Port: 80     Protocol: TCP
   ```
6. Click **Create** for each one

SSH (port 22) should already be open — that is how you are connected.

---

## Step 6 — Copy your code onto the server (10 minutes)

Still in the server terminal, type:

```bash
git clone https://github.com/mnaushad-git/maskan-rental.git
```
*Downloads your entire app from GitHub onto the server.*

```bash
cd maskan-rental
```
*Moves into the app folder.*

---

## Step 7 — Fill in your secrets (15 minutes)

Your app needs passwords and API keys to work. We set these in a file
that stays on the server only — it is never uploaded to GitHub.

### 7a — Generate a secure secret key

```bash
openssl rand -hex 32
```
Copy the long string it outputs — you will paste it in the next step.
It looks like: `a3f8b2c1d4e5...`

### 7b — Create the secrets file

```bash
cp .env.production.example .env.production
nano .env.production
```
*Opens a text editor in the terminal.*

You will see the template file. Use arrow keys to navigate and type
to edit. Change these values:

```
FRONTEND_ORIGIN=https://yourdomain.com     ← your actual domain with https://
DOMAIN=yourdomain.com                       ← same domain WITHOUT https://
ACME_EMAIL=your@email.com                   ← your email (for SSL certificate notices)

SECRET_KEY=paste-the-long-string-from-step-7a-here

DB_PASSWORD=choose-a-strong-password-here   ← make up something strong, e.g. Xk9#mP2$vQ
DB_USER=maskan_app                          ← leave as-is
DB_NAME=maskan                              ← leave as-is

ADMIN_EMAILS=mnaushad.aws@gmail.com         ← your email — gives you admin access

ANTHROPIC_API_KEY=sk-ant-your-key-here      ← paste your Anthropic key
```

The optional ones (SendGrid, Moyasar, Google Maps) can be left blank
for now — the app works fine without them.

To save and exit the editor:
- Press **Ctrl + X**
- Press **Y** to confirm saving
- Press **Enter**

### 7c — Verify the file looks right

```bash
cat .env.production
```
Check that your domain, email, and keys are all filled in correctly.

---

## Step 8 — Launch the app (30 minutes)

This builds and starts everything — database, backend, frontend, and
the HTTPS layer. The first build takes time because it downloads and
compiles everything.

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

**What this does:**
- `--build` — compiles your code into a production app
- `-d` — runs everything in the background (so it keeps running after you close the terminal)
- `--env-file .env.production` — uses your secret values

**What you will see:** A lot of text scrolling by showing download and
build progress. This is normal. The first time takes 15–25 minutes.

When it finishes you will see something like:
```
✔ Container maskanrental-db-1        Started
✔ Container maskanrental-backend-1   Started
✔ Container maskanrental-frontend-1  Started
✔ Container maskanrental-caddy-1     Started
```

### Check everything is running

```bash
docker compose -f docker-compose.prod.yml ps
```

All four services should show **"running"** status.

---

## Step 9 — Set up the database (5 minutes)

The database is running but empty. Run both seed commands:

### 9a — Properties and admin account

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production exec backend python seed.py
```

*Creates 66 sample properties across Riyadh, Jeddah and Dammam,
plus your admin account (`mnaushad.aws@gmail.com` / `Admin@1234`).*

### 9b — Area intelligence data

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production exec backend python seed_areas.py
```

*Loads 16 area profiles (scores, rent trends, school and hospital data)
across Riyadh, Jeddah and Dammam — powers the AI Advisor and the Explore Areas page.*

Both commands are safe to run again if needed — they update existing records rather than creating duplicates.

---

## Step 10 — Go live check (10 minutes)

1. Open your browser and go to `https://yourdomain.com`

2. **First visit may take 60 seconds** — Caddy is getting your SSL
   certificate from Let's Encrypt for the first time. This only happens
   once, ever.

3. You should see the padlock icon in the browser bar and your site loading.

4. Test these things:
   - Home page loads with properties
   - Search works
   - Go to `/admin` and sign in with your email and password `Admin@1234`
   - Change the admin password immediately after logging in

---

## If something goes wrong

### See what the app is doing:

```bash
docker compose -f docker-compose.prod.yml logs --tail=50
```

### See logs for a specific service:

```bash
docker compose -f docker-compose.prod.yml logs caddy --tail=50
docker compose -f docker-compose.prod.yml logs backend --tail=50
docker compose -f docker-compose.prod.yml logs frontend --tail=50
```

### Restart everything:

```bash
docker compose -f docker-compose.prod.yml restart
```

### Most common issues:

| Problem | Likely cause | Fix |
|---|---|---|
| Site not loading at all | DNS not propagated yet | Wait 30 min, check dnschecker.org |
| "No such file" errors | Wrong folder | Run `pwd` — you should be in `~/maskan-rental` |
| Certificate errors | Domain not pointing to server yet | Fix DNS first, then restart Caddy |
| App loads but no properties | Database not seeded | Re-run Step 9 |
| "Permission denied" for Docker | Group change not applied | Run `newgrp docker` and try again |

---

## After going live — keeping it running

### Update the app when you make code changes:

```bash
git pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

### The app restarts automatically if the server reboots

Docker is configured with `restart: always` — all services come back
up on their own if the server ever restarts.

### Backups

Take a manual snapshot in Lightsail once a week:
Lightsail → your instance → **Snapshots** → **Create snapshot**
This saves your entire server including the database.

---

## Cost summary

| Item | Cost |
|---|---|
| AWS Lightsail server ($20/month plan) | ~$20/month |
| Domain name (.com) | ~$12/year |
| SSL certificate | Free (Let's Encrypt via Caddy) |
| **Total** | **~$21/month** |

---

## Quick reference — useful commands

```bash
# See if everything is running
docker compose -f docker-compose.prod.yml ps

# View live logs (press Ctrl+C to stop)
docker compose -f docker-compose.prod.yml logs -f

# Restart the app
docker compose -f docker-compose.prod.yml restart

# Stop the app
docker compose -f docker-compose.prod.yml down

# Start the app (after stopping)
docker compose -f docker-compose.prod.yml --env-file .env.production up -d

# Update after a code change
git pull && docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```
