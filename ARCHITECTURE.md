# Maskan Rental — How the Application Works (Plain English Guide)

> **This is a living document.** It gets updated every time we add or change a feature.  
> Last updated: 2026-06-14  
> Written for: developers, interview preparation, and anyone who wants to understand how Maskan is built.

---

## Table of Contents

1. [What is Maskan?](#1-what-is-maskan)
2. [Technology Choices — What We Use and Why](#2-technology-choices--what-we-use-and-why)
3. [Project Folder Structure — What Lives Where](#3-project-folder-structure--what-lives-where)
4. [The Backend — How the Server Works](#4-the-backend--how-the-server-works)
5. [The Frontend — How the Website Works](#5-the-frontend--how-the-website-works)
6. [How Data Flows — Step by Step](#6-how-data-flows--step-by-step)
7. [The Database — How We Store Data](#7-the-database--how-we-store-data)
8. [Feature Map — Every Feature and How It Works](#8-feature-map--every-feature-and-how-it-works)
9. [Running the Project on Your Computer](#9-running-the-project-on-your-computer)
10. [Important Patterns and Decisions](#10-important-patterns-and-decisions)
11. [Interview Preparation — Key Questions Answered](#11-interview-preparation--key-questions-answered)
12. [Production Deployment — Taking It Live](#12-production-deployment--taking-it-live)

---

## 1. What is Maskan?

**Maskan** (مسكن) means "home" or "dwelling" in Arabic. It is a Saudi Arabian rental marketplace — think of it as a smarter version of Aqar or Property Finder, but with built-in artificial intelligence that helps tenants make better decisions.

### What problem does it solve?

Finding a rental in Saudi Arabia today involves a lot of guesswork:
- Is this rent price fair or am I overpaying?
- Which district is best for my family?
- How does this apartment compare to others?
- Who can I ask for honest advice?

Maskan answers all these questions with real data and AI.

### What can users do on Maskan?

**Tenants (regular users) can:**
- Browse 25 real Riyadh properties across 11 districts
- Search by city, property type, number of bedrooms, and price range
- See an AI-calculated rental score (0–100) for each property
- Get a "Fair Rent Analysis" — is this property priced above or below the market?
- Compare up to 3 properties side by side with an AI recommendation on which is best
- Save properties to a shortlist
- Contact the landlord/agent directly from the listing page
- Chat with the Maskan AI Advisor (powered by Anthropic Claude) for any rental question
- View area-level insights: school ratings, hospital ratings, traffic scores, 5-year rent trends

**Admin users (property managers) can:**
- List new properties
- Edit existing listings
- Change property status (Published, Pending, Suspended)
- Import many properties at once using a CSV file
- View live analytics: how many properties are listed, which cities are most popular, conversion rates

### The five things that make Maskan special

1. **AI Rental Score** — Every listing gets a score out of 100 based on price fairness, area quality, amenities, commute, and family suitability. Think of it like a doctor's health score for an apartment.

2. **Fair Rent Analysis** — We compare what the landlord is asking to the average rent in that district. We tell you clearly: "This is SAR 500 above market" or "This is a good deal."

3. **Area Intelligence Console** — An admin dashboard with deep data on 8+ Saudi districts: schools nearby (with ratings), hospitals, lifestyle tags, and a 5-year rent trend chart.

4. **AI Advisor** — A chat window powered by Anthropic Claude that knows Saudi rental law, typical negotiation ranges, and can answer any question like "What's a fair deposit for a 3-bedroom in Al Yasmin?"

5. **Side-by-Side Comparison** — Compare 3 properties at once. The AI picks a winner based on weighted scoring across value, area quality, family fit, and rental intelligence.

---

## 2. Technology Choices — What We Use and Why

Think of building a web application like building a restaurant. The **backend** is the kitchen (where food is prepared — hidden from customers). The **frontend** is the dining room (what customers see and interact with). The **database** is the pantry (where all ingredients are stored).

### The Kitchen (Backend)

| Technology | What It Is | Why We Chose It |
|---|---|---|
| **Python** | The programming language for our server | Easy to read, huge library ecosystem, great for AI integrations |
| **FastAPI** | The web framework — like the recipe book that tells the kitchen how to respond to each order | Automatically generates API documentation, very fast, has built-in data validation |
| **SQLAlchemy** | The tool that talks to our database | Lets us write Python code instead of raw database queries; type-safe meaning errors are caught early |
| **Alembic** | Database migration tool | Manages changes to the database structure over time safely, without losing existing data |
| **PostgreSQL** | The database itself | Industry standard, reliable, handles complex queries well |
| **JWT (JSON Web Tokens)** | Our login system | A secure "ticket" that the user carries after logging in. The server checks the ticket on every request without needing to look up the database each time |
| **Anthropic Claude** | The AI brain | Powers our AI Advisor chat and rental analysis. We use `claude-opus-4-8` model |
| **Docker** | Containerization tool | Packages the entire application into a box that runs identically on any computer or server |

### The Dining Room (Frontend)

| Technology | What It Is | Why We Chose It |
|---|---|---|
| **React** | The JavaScript library for building the user interface | Component-based: each button, card, and page section is its own reusable piece |
| **TypeScript** | JavaScript with types added | Catches mistakes before they reach users. If you try to pass text where a number is expected, TypeScript warns you |
| **TanStack Start** | The routing + Server-Side Rendering framework | Gives us both page routing (which URL shows which page) and SSR (the page is partly built on the server before reaching the browser — better for SEO and loading speed) |
| **Vite** | The build tool | Very fast. Compiles and bundles all the JavaScript/CSS so it runs in the browser |
| **Tailwind CSS** | CSS styling framework | Write styles as class names directly in HTML (`className="text-blue-500 font-bold"`) — no separate CSS files needed |
| **shadcn/ui** | Ready-made UI components | Pre-built buttons, modals, tables, inputs that match our design system |
| **Lucide React** | Icon library | 1,000+ clean icons imported individually so unused icons don't bloat the app |

### Why Docker?

Without Docker, you would need to install Python, Node.js, PostgreSQL, and configure them all to work together on your computer. With Docker, you just run one command (`docker compose up`) and everything starts automatically in isolated containers. It is also how we deploy to production — the exact same containers that run on your laptop run on the cloud server.

---

## 3. Project Folder Structure — What Lives Where

Here is the complete folder layout with plain-English explanations for each file and folder:

```
Maskan Rental/                         ← Root of the project
│
├── ARCHITECTURE.md                    ← This file you are reading right now
├── docker-compose.yml                 ← The "startup instructions" for Docker.
│                                        Tells Docker: start a database on port 5433,
│                                        start the backend on port 8000,
│                                        start the frontend on port 8080.
│
├── backend/                           ← Everything that runs on the SERVER
│   │
│   ├── .env                          ← Secret configuration file (passwords, API keys).
│   │                                    NEVER committed to Git. Each developer has their own.
│   ├── .env.example                  ← A template showing which variables are needed,
│   │                                    but with fake/empty values. Committed to Git.
│   ├── Dockerfile                    ← Instructions for building the backend Docker container.
│   │                                    "Use Python 3.11, install requirements.txt, run the server."
│   ├── requirements.txt              ← List of Python packages the backend needs.
│   │                                    Like a shopping list that pip uses to install dependencies.
│   ├── run.py                        ← Starts the web server.
│   │                                    One line: uvicorn.run("app.main:app")
│   │                                    Note: reload=False because Windows has issues with auto-reload.
│   ├── seed.py                       ← Fills the database with sample data.
│   │                                    Inserts 25 Riyadh properties (MSK-001 to MSK-025)
│   │                                    and one admin user. Safe to run multiple times.
│   ├── alembic.ini                   ← Configuration file for Alembic (tells it where
│   │                                    the database is and where migration files live).
│   │
│   ├── alembic/
│   │   └── versions/                 ← One file per database change, in order.
│   │       ├── ec56faf6d81a_...py   ← Migration 1: Creates the users, properties tables
│   │       ├── d0fb4f2214c4_...py   ← Migration 2: Adds the saved_properties table
│   │       ├── ef6ab9384c7e_...py   ← Migration 3: Adds admin-related fields
│   │       └── 3f8b2a1c9d7e_...py  ← Migration 4: Adds image_url column to properties
│   │
│   └── app/                          ← The actual application code
│       │
│       ├── main.py                   ← The heart of the backend.
│       │                                Creates the FastAPI app, sets up CORS (which websites
│       │                                are allowed to call our API), and registers all the
│       │                                URL routes (auth, properties, search, areas, etc.)
│       │
│       ├── core/
│       │   └── config.py             ← Reads the .env file and makes settings available
│       │                                everywhere in the app. Uses pydantic-settings which
│       │                                validates the values (e.g., port must be a number).
│       │
│       ├── db/
│       │   ├── base.py               ← Declares the base class that all database models
│       │   │                            inherit from. Think of it as the "template" all
│       │   │                            database tables start from.
│       │   └── session.py            ← Creates the database connection.
│       │                                Provides SessionLocal — a factory that creates a
│       │                                new database session whenever needed.
│       │
│       ├── models/                   ← Database table definitions written in Python.
│       │   ├── property.py           ← The "properties" table (25 columns: title, area, rent, etc.)
│       │   ├── user.py               ← The "users" table (email, password hash, name)
│       │   ├── saved_property.py     ← The "saved_properties" table (which user saved which property)
│       │   └── saved_search.py       ← The "saved_searches" table (saved filter preferences)
│       │
│       ├── schemas/                  ← Data shape definitions for API requests and responses.
│       │   │                            These are NOT database tables — they define what data
│       │   │                            comes IN (from the user) and goes OUT (to the user).
│       │   ├── property.py           ← PropertyCreate (to add a property), PropertyUpdate (to edit),
│       │   │                            PropertyOut (what the API returns)
│       │   ├── user.py               ← UserCreate, UserOut
│       │   ├── auth.py               ← LoginRequest, TokenResponse
│       │   └── saved_property.py     ← SavedPropertyCreate, SavedPropertyOut
│       │
│       └── api/
│           ├── deps.py               ← Reusable helper functions injected into endpoints.
│           │                            get_db() → gives a database session
│           │                            get_current_user() → reads the JWT and returns the logged-in user
│           │                            get_admin_user() → same but also checks admin permission
│           │
│           └── routes/               ← One file per group of related API endpoints
│               ├── auth.py           ← /api/auth/login, /api/auth/signup, /api/auth/me
│               ├── properties.py     ← /api/properties/ (list, get, create, edit, delete, bulk import)
│               ├── saved_properties.py ← /api/saved-properties/ (save, list, update, remove)
│               ├── saved_searches.py ← /api/saved-searches/
│               ├── search.py         ← /api/search/
│               ├── areas.py          ← /api/areas/ (district rent averages from live data)
│               ├── analytics.py      ← /api/analytics/summary (dashboard metrics)
│               ├── users.py          ← /api/users/
│               └── ai.py             ← /api/ai/chat (Anthropic Claude integration)
│
└── frontend/                          ← Everything the USER SEES in their browser
    │
    ├── Dockerfile                    ← Instructions for building the frontend Docker container.
    ├── package.json                  ← List of JavaScript packages needed (like requirements.txt for JS).
    ├── vite.config.ts                ← Vite build configuration. Uses a Lovable preset that
    │                                    locks the dev server to port 8080 and configures SSR.
    ├── components.json               ← shadcn/ui configuration: where to put new components,
    │                                    which style (New York), and path aliases (@/components).
    │
    └── src/                          ← All the application source code
        │
        ├── start.ts                  ← TanStack Start client entry point.
        │                                This is the first JS file the browser runs.
        ├── server.ts                 ← SSR server entry point.
        │                                This runs on the Node.js server during server-side rendering.
        ├── router.tsx                ← Creates the router with scroll restoration and SSR context.
        ├── routeTree.gen.ts          ← AUTO-GENERATED. Never edit this manually.
        │                                TanStack Router scans the routes/ folder and generates this.
        │
        ├── styles.css                ← All CSS styles including:
        │                                - Tailwind CSS setup
        │                                - Custom colour tokens (--color-primary, --color-ai, etc.)
        │                                - Custom shadows (--shadow-card, --shadow-elevated)
        │                                - Custom utilities (container-page, font-display)
        │
        ├── assets/                   ← Static image files bundled into the app
        │   ├── prop-1.jpg            ← Property photo 1 (used as fallback images)
        │   ├── prop-2.jpg            ← Property photo 2
        │   ├── prop-3.jpg            ← Property photo 3
        │   ├── prop-4.jpg            ← Property photo 4
        │   └── hero-villa.jpg        ← Hero image shown at the top of property detail pages
        │
        ├── routes/                   ← Each file here = one page/URL in the application
        │   ├── __root.tsx            ← The wrapper around ALL pages.
        │   │                            Sets up the HTML document, loads fonts, wraps
        │   │                            everything in AuthProvider, renders <Outlet />
        │   │                            (where child pages appear).
        │   ├── index.tsx             ← The homepage (/)
        │   ├── search.tsx            ← Search page (/search)
        │   ├── property.$id.tsx      ← Individual property page (/property/42)
        │   │                            The $id means it's dynamic — any number works.
        │   ├── compare.tsx           ← Compare properties page (/compare)
        │   ├── areas.tsx             ← Area Intelligence Console (/areas)
        │   ├── analytics.tsx         ← Analytics dashboard (/analytics)
        │   ├── advisor.tsx           ← AI chat advisor (/advisor)
        │   ├── admin.tsx             ← Admin panel (/admin)
        │   ├── import.tsx            ← CSV bulk import (/import)
        │   ├── saved.tsx             ← User's saved properties (/saved)
        │   └── auth.tsx              ← Login / sign-up page (/auth)
        │
        ├── components/
        │   ├── maskan/               ← Application-specific reusable components
        │   │   ├── PropertyCard.tsx  ← The rectangular card showing one property.
        │   │   │                        Used on search results, homepage, and comparable listings.
        │   │   ├── SearchBar.tsx     ← The search form (location + type + budget + search button)
        │   │   │                        Used on the homepage.
        │   │   ├── Badges.tsx        ← Colour-coded labels. Three types:
        │   │   │                        Badge (general, 12 colour variants)
        │   │   │                        StatusBadge (Available / Reserved / Rented)
        │   │   │                        RecommendationBadge (Verified / Best Match)
        │   │   ├── ScoreIndicator.tsx ← Two score display types:
        │   │   │                        ScoreRing: a circular gauge (like a speedometer)
        │   │   │                        ScoreBar: a horizontal bar with a label and number
        │   │   ├── Widgets.tsx       ← StatCard: the KPI boxes (e.g., "412 Listings | +12%")
        │   │   └── AiChat.tsx        ← AI chat bubble component used on the homepage teaser
        │   │
        │   └── ui/                   ← shadcn/ui base components (40+ components)
        │       │                        These are the raw building blocks: buttons, inputs,
        │       │                        dialogs, dropdowns, tabs, etc. All built on Radix UI
        │       │                        which handles accessibility automatically.
        │       ├── button.tsx        ← Button with variants: default, outline, ghost,
        │       │                        hero (gradient CTA), ai (purple AI action)
        │       ├── input.tsx         ← Text input field
        │       ├── dialog.tsx        ← Modal popup
        │       ├── tabs.tsx          ← Tab navigation
        │       └── ...               ← 35+ more components
        │
        ├── lib/
        │   ├── api/
        │   │   └── maskan.ts         ← THE MOST IMPORTANT FRONTEND FILE.
        │   │                            Every single API call goes through here.
        │   │                            Contains all TypeScript types for API data,
        │   │                            all functions to fetch data, and all mappers
        │   │                            that convert API data to the UI's format.
        │   │
        │   ├── auth-context.tsx      ← Manages who is logged in.
        │   │                            Stores user and token in browser localStorage.
        │   │                            useAuth() hook gives any component access to
        │   │                            the current user.
        │   │
        │   ├── maskan-data.ts        ← Static data and TypeScript types.
        │   │                            Defines the Property type used across the UI.
        │   │                            Contains DISTRICT_SCORES lookup for area score rings.
        │   │                            Contains formatSAR() number formatter.
        │   │
        │   ├── maskan-search-data.ts ← SearchProperty type (extends Property with
        │   │                            rental score, area score, amenities, reasons)
        │   │
        │   └── utils.ts              ← cn() function: merges Tailwind class names safely.
        │                                Example: cn("text-sm", isActive && "font-bold")
        │
        └── hooks/
            └── use-mobile.tsx        ← Returns true/false based on screen width.
                                         Used to show/hide elements on mobile vs desktop.
```

---

## 4. The Backend — How the Server Works

The backend is the part of the application that users never see directly. It receives requests ("give me all properties in Al Yasmin"), processes them, reads from or writes to the database, and sends back the answer.

### 4.1 How the Server Starts

When you run `python run.py`, the server starts on `http://localhost:8000`.

**`backend/run.py`** — One important line:
```python
uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=False)
```

`uvicorn` is the web server (like Apache or Nginx but for Python). It listens on port 8000 and forwards every request to FastAPI.

`reload=False` is important: on Windows, the auto-reload feature (which restarts the server when you save a file) causes problems because Windows Store Python cannot find installed packages in a restarted subprocess. We leave it off and restart manually when needed.

**`backend/app/main.py`** — This file does three things:
1. Creates the FastAPI application
2. Sets up CORS — Cross-Origin Resource Sharing. This is a browser security rule that says "only these websites are allowed to call our API." We allow `localhost:8080` (frontend dev server) and `localhost:5173` (alternative dev port). In production, only `https://maskan.sa` would be allowed.
3. Registers all 9 groups of API routes. Each group handles one area (auth, properties, search, areas, analytics, etc.)

There is also a simple health check endpoint:
- `GET /api/health` → returns `{"status": "ok"}` — used to verify the server is running.

---

### 4.2 Configuration — Reading the .env File

**`backend/app/core/config.py`** defines a `Settings` class that reads the `.env` file automatically.

Think of it as the application's control panel. Every configurable value lives here:

| Setting | What It Does | Default Value |
|---|---|---|
| `ENV` | Is this development or production? | `development` |
| `API_HOST` | Which network address to listen on. `0.0.0.0` means accept from any IP | `0.0.0.0` |
| `API_PORT` | Which port number to listen on | `8000` |
| `FRONTEND_ORIGIN` | The website URL allowed to call our API (for CORS) | `http://localhost:5173` |
| `DATABASE_URL` | Full address to reach PostgreSQL including username, password, host, port, and database name | See .env file |
| `SECRET_KEY` | A secret password used to sign JWT login tokens. If someone knows this they can forge tokens | Change before production! |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | How long before a login token expires. 1440 = 24 hours | `1440` |
| `ANTHROPIC_API_KEY` | The API key for Anthropic Claude AI. Without this, AI chat returns an error | None (must be set) |
| `ADMIN_EMAILS` | A list of email addresses that have admin powers. No database change needed to add an admin | `[]` |

**Important about admin:** Admin is not stored in the database as a special column. We simply check "is this logged-in user's email in the ADMIN_EMAILS list?" If yes, they get admin access. To make someone an admin, you edit the `.env` file and restart the server. No database migration needed.

---

### 4.3 The Database Connection

**`backend/app/db/base.py`** — This declares `Base`, the parent class that all database models (tables) inherit from. Every table we create inherits from Base so SQLAlchemy knows it represents a database table.

**`backend/app/db/session.py`** — This creates the database connection engine and `SessionLocal`. Think of `SessionLocal` as a "session factory" — every time an API endpoint needs to talk to the database, it calls `SessionLocal()` to get a fresh session (connection). The session is closed when the request finishes.

PostgreSQL runs on port **5433** (not the default 5432). This avoids conflicts if you have a local PostgreSQL installation on your computer.

---

### 4.4 Database Models — The Tables

These files define what data we store. SQLAlchemy translates these Python classes into actual database tables.

#### The Property Table (`backend/app/models/property.py`)

This is the main table — it stores every rental property listing.

| Column Name | Data Type | What It Stores | Example |
|---|---|---|---|
| `id` | Number (auto) | Unique ID, assigned automatically by the database | 42 |
| `external_id` | Text (optional, unique) | An ID from another system, used to avoid duplicates when importing. Our seed data uses MSK-001 through MSK-025 | "MSK-001" |
| `title` | Text | The listing headline | "5-Bed Villa in Al Yasmin" |
| `area` | Text | The district / neighbourhood name | "Al Yasmin" |
| `city` | Text | The city | "Riyadh" |
| `size_sq_m` | Number (optional) | Floor area in square metres | 380 |
| `monthly_rent` | Decimal number | Monthly rent in SAR | 17500.0 |
| `bedrooms` | Number (optional) | Number of bedrooms | 5 |
| `bathrooms` | Number (optional) | Number of bathrooms | 6 |
| `owner_name` | Text (optional) | Landlord or agent name | "Khaled Al-Rashidi" |
| `status` | Text | Current listing state | "Published", "Pending Approval", "Suspended", or "Rejected" |
| `description` | Long text (optional) | Full property description with all details | "Ref: MSK-001 | Finishing: Super Lux..." |
| `image_url` | Text (optional) | URL of the property's main photo | Unsplash URL |
| `created_at` | Date/time | When the record was created. Set automatically by the database | 2026-06-14 09:30:00 |

The Property has a **relationship** with SavedProperty: when a property is deleted, all saves of that property are automatically deleted too (cascade delete).

---

#### The User Table (`backend/app/models/user.py`)

Stores everyone who registers on Maskan.

| Column Name | Data Type | What It Stores |
|---|---|---|
| `id` | Number (auto) | Unique user ID |
| `email` | Text (unique) | Login email address. No two users can have the same email. |
| `full_name` | Text (optional) | Display name |
| `hashed_password` | Text | The user's password scrambled with pbkdf2_sha256. We NEVER store plain passwords. |
| `created_at` | Date/time | Registration date |

**Why do we hash passwords?** If our database were ever leaked, hackers would see scrambled text like `pbkdf2:sha256:600000$...` instead of the actual password. Reversing this hash is computationally very expensive (intentionally slow algorithm with 600,000 rounds).

---

#### The Saved Properties Table (`backend/app/models/saved_property.py`)

This table tracks which user has saved which property — the user's shortlist.

| Column Name | Data Type | What It Stores |
|---|---|---|
| `id` | Number (auto) | Unique ID |
| `user_id` | Number (foreign key) | Points to a row in the `users` table |
| `property_id` | Number (foreign key) | Points to a row in the `properties` table |
| `status` | Text | What stage the user is at: "none", "viewing", "shortlisted" |
| `notes` | Long text (optional) | Private notes the user writes about this property |
| `viewing_at` | Date/time (optional) | When they have scheduled a viewing |
| `created_at` | Date/time | When they saved it |

**Important constraint:** `(user_id, property_id)` must be unique. A user can only save any given property once. Trying to save it again returns a 409 Conflict error.

---

#### The Saved Searches Table (`backend/app/models/saved_search.py`)

Stores a user's saved search filters so they can return to the same search without re-entering filters.

---

### 4.5 Schemas — The Shape of API Data

Schemas are separate from database models. The database model defines what the database stores. The schema defines what the API accepts or returns.

Think of it this way: the database might store a user's `hashed_password`, but we should never return that through the API. The schema for "user response" includes `id`, `email`, `full_name` — but NOT `hashed_password`.

**Three schema types for each resource:**

- **Create schema** — What data must come IN to create a new record. Example: `PropertyCreate` requires `title`, `area`, `city`, `monthly_rent`.
- **Update schema** — All fields are optional. You only send what you want to change. Example: `PropertyUpdate` might just have `{ "status": "Suspended" }`.
- **Out schema** — What the API returns. Includes `id`, `created_at`, and any related nested data. Example: `SavedPropertyOut` includes the full property details nested inside it.

---

### 4.6 Dependency Injection — Reusable Logic

**`backend/app/api/deps.py`** contains four functions that are injected into endpoints automatically by FastAPI:

**`get_db()`** — Opens a database session, gives it to the endpoint, and automatically closes it when the request is finished. This prevents connection leaks.

**`get_current_user(token)`** — Reads the JWT token from the request's Authorization header, decodes it to get the user ID, looks up that user in the database, and returns the User object. If the token is missing, expired, or tampered with, it returns a 401 Unauthorized error immediately.

**`get_admin_user(token)`** — Does everything `get_current_user` does, then additionally checks if the user's email is in `ADMIN_EMAILS`. If not, it returns a 403 Forbidden error. Used on all endpoints that create, edit, or delete properties.

**`get_optional_admin_user(token)`** — Returns the admin user if a valid admin token is present, or `None` if not. Used on "list properties" so admins can see all listings (including Pending and Suspended) while regular visitors only see Published ones.

---

### 4.7 All API Endpoints — Complete List

The API base URL is `http://localhost:8000/api`. You can explore all endpoints visually at `http://localhost:8000/docs` (Swagger UI — automatically generated by FastAPI).

#### Login and Registration (`/api/auth`)

| What it does | Method | URL | Who can call it |
|---|---|---|---|
| Register a new account | POST | `/signup` | Anyone |
| Log in | POST | `/login` | Anyone |
| Get your own profile | GET | `/me` | Logged-in users (requires token) |
| Log out | POST | `/logout` | Anyone (just a signal — client deletes its token) |

**How login works:** You send your email and password. The server checks the password hash. If correct, it creates a JWT token (a signed certificate) and sends it back. The frontend stores this token and sends it with every future request. The token contains your user ID and an expiry time. No session is stored on the server.

---

#### Properties (`/api/properties`)

| What it does | Method | URL | Who can call it |
|---|---|---|---|
| List all published properties | GET | `/` | Anyone. Admins can add `?include_all=true` to see all statuses |
| Get one property | GET | `/{id}` | Anyone |
| Get total property count | GET | `/stats` | Anyone. Returns `{ "listing_count": 25 }` |
| Create a new property | POST | `/` | Admins only |
| Update a property | PATCH | `/{id}` | Admins only |
| Delete a property | DELETE | `/{id}` | Admins only |
| Import many properties at once | POST | `/bulk` | Admins only. Accepts a list of properties, returns how many were inserted vs skipped |

---

#### Saved Properties (`/api/saved-properties`)

| What it does | Method | URL | Who can call it |
|---|---|---|---|
| Get a user's saved list | GET | `/?user_id=42` | Anyone (user ID in query) |
| Save a property | POST | `/` | Logged-in users |
| Update a save (status, notes, viewing time) | PATCH | `/{id}` | Logged-in users |
| Remove from saved list | DELETE | `/{id}` | Logged-in users |

---

#### Areas (`/api/areas`)

| What it does | Method | URL | Who can call it |
|---|---|---|---|
| Get area summary (property count + average rent per district) | GET | `/` | Anyone |
| Get detail for one area | GET | `/{area_id}` | Anyone |

**Important:** There is no "areas" table in the database. This data is computed on the fly by grouping and averaging from the `properties` table. If more properties are added to Al Yasmin, the average rent returned by this endpoint automatically changes.

---

#### Search (`/api/search`)

| What it does | Method | URL | Who can call it |
|---|---|---|---|
| Search properties with filters | GET | `/?city=Riyadh&type=Villa&max_rent=20000` | Anyone |

---

#### Analytics (`/api/analytics`)

| What it does | Method | URL | Who can call it |
|---|---|---|---|
| Get dashboard summary | GET | `/summary` | Anyone |

Returns: KPI cards, popular areas, conversion funnel data, AI usage trends, inventory by city, activity feed.

---

#### AI Chat (`/api/ai`)

| What it does | Method | URL | Who can call it |
|---|---|---|---|
| Chat with AI advisor | POST | `/chat` | Anyone |

You send: `{ "message": "What's a fair rent for 3BR in Al Narjis?", "history": [...previous messages...] }`  
You get back: `{ "reply": "Based on current listings in Al Narjis, a 3-bedroom apartment typically rents for..." }`

The server passes your message + full conversation history to Anthropic Claude. This means the AI remembers what was said earlier in the conversation.

---

### 4.8 How Login and Security Works

**Step 1 — User registers or logs in:**
The user sends their email and password to `/api/auth/login`.

**Step 2 — Server checks password:**
The server finds the user by email, then runs the same hashing algorithm on the password they sent. If the result matches the stored hash, the password is correct.

**Step 3 — Server creates a JWT token:**
A JWT (JSON Web Token) looks like three Base64-encoded sections separated by dots:
```
eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI0MiIsImV4cCI6MTcz...}.<signature>
```
The middle section decodes to `{ "sub": "42", "exp": 1750000000 }` — the user's ID and when the token expires. The `<signature>` part is calculated using our `SECRET_KEY`. Only our server can create valid signatures.

**Step 4 — Frontend stores the token:**
The token is saved in the browser's `localStorage` under the key `maskan_token`. It stays there until the user logs out.

**Step 5 — Every future request includes the token:**
Our API client automatically adds `Authorization: Bearer <token>` to every request header.

**Step 6 — Server verifies on every request:**
Protected endpoints call `Depends(get_current_user)`. This function reads the token, verifies the signature (using SECRET_KEY), checks expiry, and returns the User. If anything is wrong, the request is rejected immediately with a 401 error.

**Admin access:** When a user logs in, we check `user.email in ADMIN_EMAILS`. If yes, the response includes `"is_admin": true`. The frontend stores this and shows admin navigation. Every admin API endpoint double-checks on the server side — the client's `is_admin` claim is not trusted alone.

---

### 4.9 The AI Chat Service

**`backend/app/api/routes/ai.py`**

When a user sends a message to the AI Advisor:

1. The frontend sends `POST /api/ai/chat` with the message and the full conversation history so far
2. The backend initializes an Anthropic client using `ANTHROPIC_API_KEY`
3. A system prompt is prepended: "You are Maskan's Saudi rental AI advisor. You speak in SAR, know Saudi rental law, and help tenants make smart decisions."
4. The full conversation (system + history + new message) is sent to Claude (`claude-opus-4-8` model)
5. The AI's response is returned to the frontend as `{ "reply": "..." }`

If `ANTHROPIC_API_KEY` is not set in `.env`, the endpoint returns `HTTP 503 Service Unavailable` with an appropriate error message.

---

### 4.10 The Seed Script

**`backend/seed.py`** — Run this once after migrations to fill the database with sample data.

It inserts 25 properties covering 13 districts of Riyadh:

| Properties | District | Types | Monthly Rent Range |
|---|---|---|---|
| MSK-001 to 003 | Al Yasmin | 5BR Villa, 3BR Apt, 4BR Villa | SAR 8,200 – 17,500 |
| MSK-004 to 006 | Al Narjis | 4BR Villa, 3BR Apt, 2BR Apt | SAR 5,800 – 13,000 |
| MSK-007 to 008 | Al Malqa | 6BR Mega Villa, 3BR Apt | SAR 9,000 – 23,000 |
| MSK-009 to 010 | Al Olaya | 4BR Penthouse, 2BR Apt | SAR 10,500 – 32,000 |
| MSK-011 to 012 | Al Rawdah | 5BR Villa, 3BR Apt | SAR 8,800 – 16,500 |
| MSK-013 to 014 | Al Faisaliyah | 3BR Apt, 2BR Apt | SAR 7,000 – 10,500 |
| MSK-015 to 016 | University District | 3BR Apt, 2BR Apt | SAR 4,500 – 5,800 |
| MSK-017 to 018 | Hitteen | 5BR Villa (pool), 3BR Apt | SAR 8,500 – 17,000 |
| MSK-019 to 020 | Al Sahafah | 4BR Villa, 3BR Apt | SAR 7,000 – 13,500 |
| MSK-021 to 022 | Al Nakheel | 5BR Villa (gym+pool), 3BR Apt | SAR 8,800 – 19,500 |
| MSK-023 | Diplomatic Quarter | 5BR Villa | SAR 35,000 |
| MSK-024 | Qurtuba | 4BR Villa | SAR 15,000 |
| MSK-025 | Al Sulimaniyah | 4BR Penthouse (duplex, rooftop pool) | SAR 28,000 |

Each property has an Unsplash image URL, a detailed Aqar-style description (includes reference number, finishing level, year built, floor number, full room breakdown, key features list, location notes, annual rent, and payment terms), and the landlord's name.

The script is safe to run multiple times — it checks `external_id` first, and if the property already exists, it updates it instead of creating a duplicate.

It also creates the admin user `mnaushad.fms@gmail.com` with password `Admin@1234` if they don't exist yet.

---

## 5. The Frontend — How the Website Works

The frontend is what the user sees in their browser. It is built with React + TypeScript and uses TanStack Start for routing and server-side rendering.

### 5.1 What is Server-Side Rendering (SSR)?

Normally, a React app sends an empty HTML shell to the browser, then JavaScript builds the page in the browser. This means the page is blank for a moment and search engines see nothing.

With SSR (Server-Side Rendering), the Node.js server pre-builds the page's HTML before sending it. The browser receives fully-formed HTML immediately — users see content faster, and search engines can read it.

**The catch:** Because pages are first built on the server (which is a Node.js process), browser-specific objects like `window`, `document`, and `localStorage` don't exist yet. Any code that uses them must be wrapped in a safety check:

```typescript
// This crashes during server rendering (window doesn't exist on Node.js)
const token = localStorage.getItem("maskan_token");  // ❌

// This is safe — checks if we're in a browser first
const token = typeof window !== "undefined" ? localStorage.getItem("maskan_token") : null;  // ✅
```

This pattern appears in two places in the codebase:
- `frontend/src/lib/auth-context.tsx` — `safeLocalStorage()` helper
- `frontend/src/lib/api/maskan.ts` — inline check before reading the token

---

### 5.2 Pages — Every Route Explained

TanStack Router is **file-based**: the filename determines the URL. Add a file to `src/routes/` and it becomes a page automatically.

**`__root.tsx` — The Master Wrapper**  
Every page is wrapped by this. It sets up the HTML document structure, loads Google Fonts (Inter), and wraps everything in `AuthProvider`. The `<Outlet />` element is where child pages render.

---

**`index.tsx` — Homepage (`/`)**  
The first thing users see.

Sections on this page:
- **Hero section:** Large headline, search bar (location + type + budget), and a live badge showing total property count (fetched from `/api/properties/stats`)
- **Featured properties:** 6 property cards (static demo data from `maskan-data.ts`)
- **Market statistics:** 4 KPI cards (static: avg rent, days on market, etc.)
- **Featured areas:** 4 district cards with scores and highlights
- **Cities section:** Shows available cities
- **AI Teaser:** Brief chat preview encouraging users to try the AI Advisor
- **Call to action:** Sign in / list property

---

**`search.tsx` — Search Page (`/search`)**  
The main browsing experience.

How it works:
1. On load, `fetchProperties()` is called → gets all 25 properties from the API
2. Each property is converted from API format to UI format using `mapApiSearchProperty()`
3. Users can filter by: city, property type, number of bedrooms, price range
4. Filters run **client-side** on the already-loaded data (no extra API calls for filtering)
5. Users can sort by: best match score, price (low to high), price (high to low), area score
6. Users can add properties to a comparison list (up to 3)
7. A sticky "Compare Bar" appears at the bottom when ≥1 property is selected
8. Clicking "Compare Now" (when 2–3 are selected) navigates to `/compare`

---

**`property.$id.tsx` — Property Detail Page (`/property/:id`)**  
The deepest page — shows everything about one property.

Sections:
- **MiniNav** — A compact navigation bar with Maskan logo and links
- **Gallery** — 5 images in a grid layout with thumbnail strip. Main image + 4 smaller. Click to switch.
- **Summary** — Title, district, city, status badge, property type, annual rent, and 6 key facts (bedrooms, bathrooms, area, furnishing, building age, parking)
- **Rental Intelligence** — AI composite score (demo: 88/100) with 5 sub-scores shown as horizontal bars (price fairness, area quality, amenities, commute, family suitability)
- **Fair Rent Analysis** — LIVE: fetches average rent for this district from `/api/areas/`, computes market band (±15%), and shows where this property sits. Green = below market (good deal), amber = above market (negotiate).
- **Area Insights** — 5 score rings (area score, school score, traffic score, healthcare score, family score) pulled from `DISTRICT_SCORES` static data
- **Nearby Places** — Schools, hospitals, mosques, and supermarkets with distances (static demo data)
- **Comparable Listings** — Other properties from the same API fetch shown as cards
- **AI Summary** — Static copy with recommendation to try the AI Advisor
- **Actions Card (sidebar)** — Shows price, AI match score, Contact Landlord button (opens modal), Ask AI button, Save button, Compare button, and property terms (deposit, availability, lease length)
- **Landlord Card (sidebar)** — Agent name, verification badge, Call button (opens phone modal), Chat button (opens chat modal)

**The three modals:**
- **Contact Landlord modal:** Name, phone, message form. On submit, shows a success state with a "will contact within 1 hour" message. (Currently simulated — no backend call yet)
- **Call modal:** Shows the agent's phone number formatted as a clickable `tel:` link. Tap on mobile to call directly.
- **Chat modal:** Message textarea. On submit, shows a success state. (Currently simulated)

---

**`compare.tsx` — Property Comparison (`/compare`)**  
Side-by-side comparison of up to 3 properties.

How it works:
1. All properties are fetched from the API on load
2. First 3 are auto-selected as default
3. User can swap any slot using a dropdown, remove a property with ×, or add one from a "choose property" dropdown
4. Five comparison categories are shown in tables:
   - **Financial:** Annual rent, security deposit, price per m². Best value is highlighted in blue.
   - **Property specs:** Bedrooms, bathrooms, area m², furnishing
   - **Area scores:** Area score, school score, family score shown as score bars
   - **Amenities:** Parking, gym, pool, balcony — green checkmark or grey minus
   - **Rental Intelligence:** Rental score ring + AI match score ring for each

**AI Recommendation section** (appears when ≥2 properties are selected):  
The AI picks a winner using a weighted formula:
- Value (how cheap relative to area average): 30%
- Area score: 20%
- Family score: 20%
- Rental intelligence score: 15%
- AI match score: 15%

The winner is highlighted with a gold "AI Top pick" badge and a detailed written recommendation.

**Save Shortlist button:** If the user is logged in, saves all selected properties to their account simultaneously. If not logged in, redirects to `/auth`.

---

**`areas.tsx` — Area Intelligence Console (`/areas`)**  
A data-rich dashboard for exploring districts.

Layout: Left sidebar with navigation, main content with stats, filters, and a table of all districts.

What the table shows for each district: area score, family score, school score, healthcare score, traffic score, lifestyle tags, average rent with YoY change, and a mini trend sparkline chart.

Clicking any district opens a **detail panel** that slides in from the right with 5 tabs:

| Tab | What it shows |
|---|---|
| Overview | District description, average rent stat card, active listings count, 5 score bars |
| Rental Trends | A full chart showing 5-year rent history with area fill and data points |
| Schools | List of schools with name, type (Public/International/Private), and rating out of 10 |
| Hospitals | List of hospitals with name, tier (General/Specialty), and rating |
| Market Notes | Analyst notes about the district. You can add new notes via an inline form. |

**Live data overlay:** The page also calls `/api/areas/` to get real listing counts and average rents from the actual database. If a district name matches, it overlays the live numbers on top of the static data. So as properties are added/removed in the database, these numbers update automatically.

**Export CSV button:** Downloads all currently filtered districts as a CSV file. Opens in Excel. Columns: Name, City, all 5 scores, Average Rent, YoY %, Listings.

**New District button:** Opens a form modal where you can add a new district with name, city, average rent, area score, family score, and an overview description. The new district appears in the table immediately.

---

**`analytics.tsx` — Analytics Dashboard (`/analytics`)**  
Business intelligence for the platform.

Fetches data from `/api/analytics/summary` and displays:
- 4 KPI cards (total listings, active users, avg rent, AI queries)
- Search demand chart (bar chart by day + city)
- Popular areas (horizontal bar chart)
- Conversion funnel (views → saves → viewings → rentals)
- AI usage trends (which types of questions are asked most)
- Data quality bars (how complete listing data is vs targets)
- Inventory by city (stacked bar: available, reserved, rented)
- Activity feed (recent events with icons and timestamps)

---

**`advisor.tsx` — AI Advisor Chat (`/advisor`)**  
A full chat interface powered by Anthropic Claude.

How it works:
1. User types a question and presses Send
2. `chatWithAdvisor(message, history)` calls `POST /api/ai/chat`
3. The backend sends message + full conversation history to Claude
4. Claude responds as a Saudi rental expert
5. The reply appears in the chat with a Maskan AI avatar

Suggested question chips are shown above the input: "What's a fair rent in Al Yasmin?", "How do I negotiate rent?", "What's the rental law for early exit?", etc. Clicking one pre-fills the input.

The "New Conversation" button clears the chat.

---

**`admin.tsx` — Admin Panel (`/admin`)**  
Only visible and accessible to users whose email is in `ADMIN_EMAILS`.

If you visit this page without admin access, you see an "Access Denied" message.

Admins can:
- See all 25 properties including Pending and Suspended ones
- Click any property to edit it inline
- Change status (Published → Suspended, Pending Approval → Published, etc.)
- Create a new property using a form
- Delete a property (with a confirmation step)
- Navigate to CSV Import

---

**`import.tsx` — CSV Import (`/import`)**  
Bulk import tool for adding many properties at once.

Workflow:
1. Paste CSV text or upload a file
2. The page parses the CSV client-side (no upload to server yet) and shows a preview table
3. Click "Import" → sends the parsed rows to `POST /api/properties/bulk`
4. Server inserts new properties, skips any with duplicate `external_id`
5. Shows result: "23 inserted, 2 skipped"

---

**`saved.tsx` — Saved Properties (`/saved`)**  
The user's shortlist. Requires login.

Shows all properties the user has saved, with their current status (none / viewing / shortlisted), personal notes, and scheduled viewing date if set. Users can update the status, edit notes, or remove a property from the list.

---

**`auth.tsx` — Login / Register (`/auth`)**  
Two tabs: Sign In and Sign Up.

Sign In: email + password → `POST /api/auth/login` → stores token and user in localStorage → navigates to homepage.  
Sign Up: name + email + password → `POST /api/auth/signup` → same flow.  
Logout: clears localStorage → navigates to homepage.

---

### 5.3 Shared Components

These components are used across multiple pages:

**`PropertyCard`** — The rectangular card that represents one property. Used in search results, homepage featured properties, and comparable listings on the detail page. Shows: property image, title, district + city, bedrooms + bathrooms + area, match score ring, price, and status/recommendation badges.

**`SearchBar`** — The search input with location, type, and budget fields. Navigates to `/search` with those filters when submitted.

**`Badge`** — A coloured label chip. Has 12 colour variants: primary (blue), secondary, ai (purple), success (green), warning (amber), info, neutral, and more. Used everywhere for tags and status labels.

**`StatusBadge`** — Specific to property status: green for Available, amber for Reserved, blue for Rented.

**`ScoreRing`** — An SVG circle that fills up based on a score 0–100. The colour changes from green (high score) through yellow to red (low score). Used for match score, composite score, and area scores.

**`ScoreBar`** — A horizontal bar with the label on the left and value on the right, with a coloured fill. Used in rental intelligence section and area detail panels.

**`StatCard`** — A KPI box with a label, a large value, and an optional delta change indicator with an arrow up or down. Used on the analytics page and in the areas detail panel.

---

### 5.4 The API Client — How Frontend Talks to Backend

**`frontend/src/lib/api/maskan.ts`** is the single place where all API communication happens. No other file should make direct `fetch()` calls.

**The base function — `requestJson<T>(path, init?)`:**
```typescript
const token = typeof window !== "undefined" ? localStorage.getItem("maskan_token") : null;
const response = await fetch(`${API_BASE_URL}${path}`, {
  headers: {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  },
  ...init,
});
```

This function:
1. Reads the login token from localStorage (safely — with SSR guard)
2. Adds it to the request headers automatically
3. Makes the fetch request
4. Throws an error if the response is not OK (not 2xx)
5. Returns parsed JSON

**Type conversion — `mapApiProperty()`:**

The database stores `monthly_rent` as a number (e.g., 17500). The UI needs many more fields: a match score, a property type label, an image, an agent name, etc. The mapper calculates all of these:

| UI field | How it's calculated |
|---|---|
| `price` | Directly from `monthly_rent` |
| `area` | From `size_sq_m` if available, otherwise estimated: `95 + bedrooms×38 + bathrooms×12` |
| `matchScore` | `min(98, 72 + bedrooms×4 + bathrooms×2)` |
| `type` | If title contains "penthouse" → Penthouse. If "villa" or bedrooms ≥ 4 → Villa. Else → Apartment |
| `image` | Uses `image_url` from database if available, otherwise cycles through 4 local images |
| `agent` | `owner_name` from database, or "Maskan Verified Agent" as default |

---

### 5.5 Authentication State — Who Is Logged In?

**`frontend/src/lib/auth-context.tsx`**

React's Context API is used to share the "current user" information across all components without passing it as props through every level.

How it works:
1. `AuthProvider` wraps the entire app (in `__root.tsx`)
2. When the app loads, it checks localStorage for a saved token and user
3. If found, the user is "restored" as logged in (they don't need to log in again after refresh)
4. Any component that needs the current user calls `const { user } = useAuth()`
5. When login succeeds, `setAuth(user, token)` saves both to state and localStorage
6. When logout happens, `clearAuth()` removes them from both

**Admin gate pattern used in admin.tsx:**
```typescript
const { user } = useAuth();
if (!user?.is_admin) return <div>Access Denied</div>;
```

---

### 5.6 Colour System and Styling

**`frontend/src/styles.css`** defines the design language.

**Custom colour tokens:**
- `--color-primary` — Brand blue (buttons, links, scores)
- `--color-ai` — Purple (AI features, AI badges, AI buttons)
- `--color-success` — Green (good scores, available status, savings)
- `--color-warning` — Amber (overpriced, caution states)
- `--color-info` — Blue-teal (informational tags)
- `--color-surface` — Slightly off-white card backgrounds
- `--color-surface-2` — Slightly darker backgrounds for nested sections

**Why custom tokens?** Tailwind's built-in colours are generic. Our tokens give the app a consistent identity. Changing `--color-primary` in one place updates every button, link, and score bar across the entire application.

**Dark mode:** All colour tokens have a dark variant automatically applied when the user's system is in dark mode (`@media (prefers-color-scheme: dark)`).

---

## 6. How Data Flows — Step by Step

### Scenario 1: User opens a property page

1. User types `http://localhost:8080/property/5` in browser
2. The TanStack Start SSR server renders the page's skeleton HTML on Node.js
3. Browser receives HTML and shows loading state immediately
4. `useEffect` fires in the browser: two API calls happen in parallel:
   - `fetchProperty(5)` → `GET /api/properties/5`
   - `fetchProperties()` → `GET /api/properties/` (for comparable listings)
5. Both API calls hit the FastAPI backend
6. FastAPI calls `get_db()` to open a database session
7. SQLAlchemy runs `SELECT * FROM properties WHERE id = 5`
8. Database returns the row
9. FastAPI converts it to a `PropertyOut` schema (removes internal fields, adds type validation)
10. FastAPI returns JSON
11. Frontend receives JSON, calls `mapApiProperty()` to convert to UI format
12. `useState` updates the component state
13. React re-renders with the real property data
14. Loading spinner disappears, property details appear

### Scenario 2: User clicks "Contact Landlord"

1. User clicks the "Contact Landlord" button in the Actions Card
2. `setShowContact(true)` state update
3. React re-renders and mounts `<ContactModal property={property} onClose={...} />`
4. Modal appears with name, phone, and message fields
5. Message is pre-filled: "Hi, I'm interested in [property title]. Please contact me."
6. User fills in their name and phone
7. User clicks "Send inquiry"
8. `handleSubmit()` is called → `setSent(true)`
9. Modal switches to success state showing a checkmark and "will contact within 1 hour"
10. (Currently no backend call — the contact is simulated. A future version would email the landlord.)

### Scenario 3: User saves a property shortlist from Compare page

1. User has 3 properties selected on `/compare`
2. User clicks "Save shortlist" button
3. `useAuth()` checks: is the user logged in?
4. If not logged in → `navigate({ to: "/auth" })` → user redirected to login page
5. If logged in → `setSaveState("saving")` → button shows "Saving…"
6. Three API calls fire in parallel:
   ```
   POST /api/saved-properties/ { user_id: 42, property_id: 1, status: "none" }
   POST /api/saved-properties/ { user_id: 42, property_id: 5, status: "none" }
   POST /api/saved-properties/ { user_id: 42, property_id: 12, status: "none" }
   ```
7. Each call hits FastAPI → checks JWT token → inserts row in `saved_properties` table
8. If property was already saved, returns 409 (ignored silently)
9. `setSaveState("saved")` → button shows a filled heart + "Shortlist saved!"

### Scenario 4: User asks the AI Advisor a question

1. User types "What is a fair deposit for a 3-bedroom villa in Al Yasmin?"
2. User clicks Send or presses Enter
3. Frontend calls `chatWithAdvisor(message, history)`
4. `POST /api/ai/chat` is sent with the message and the full conversation so far
5. FastAPI receives the request
6. Creates Anthropic client with `ANTHROPIC_API_KEY`
7. Assembles the messages array: system prompt + conversation history + new user message
8. Sends to Anthropic Claude (`claude-opus-4-8`)
9. Claude processes the question with its knowledge of Saudi rental practices
10. Claude's response arrives: "In Al Yasmin, the standard deposit for a 3-bedroom villa is typically 2–3 months' rent, which would be SAR 35,000–52,500 based on the district's average rent. However, for premium compounds, landlords sometimes request 3 months upfront..."
11. FastAPI returns `{ "reply": "..." }`
12. Frontend appends the reply to the messages list
13. The chat bubble appears with the Maskan AI avatar icon

### Scenario 5: User exports districts to CSV from Areas page

1. User is on `/areas` with a filter set to "Riyadh" city only
2. User clicks the "Export" button
3. `exportCSV()` function runs entirely in the browser (no API call)
4. It takes the `filtered` districts array (already computed in state — only Riyadh ones)
5. Creates a CSV string:
   ```
   Name,City,Area Score,Family Score,School Score,Healthcare,Traffic,Avg Rent SAR,YoY %,Listings
   "Al Yasmin",Riyadh,92,95,90,86,78,135000,4.2,412
   "Al Narjis",Riyadh,86,90,84,80,82,98000,6.1,538
   ...
   ```
6. Creates a `Blob` (binary large object) with the CSV text
7. Creates a temporary URL pointing to that blob in memory
8. Creates an invisible `<a href="..." download="maskan-districts.csv">` element
9. Programmatically clicks it → browser triggers download
10. File appears in user's Downloads folder

---

## 7. The Database — How We Store Data

### What is a Database Migration?

A database migration is a versioned script that changes the database structure. Instead of manually running `ALTER TABLE` commands, we write migration files that Alembic tracks and applies in order.

Think of it like Git for your database structure. You can go forward (upgrade) or backward (downgrade) through versions.

**Running migrations:**
```bash
cd backend
alembic upgrade head
```
"Upgrade to head" means "apply all migrations in order up to the latest."

### Our Migration History

We have 4 migrations in order:

**Migration 1 — `ec56faf6d81a`**  
Creates the initial tables: `users`, `properties`, `saved_searches`.

**Migration 2 — `d0fb4f2214c4`**  
Adds the `saved_properties` table so users can shortlist properties.

**Migration 3 — `ef6ab9384c7e`**  
Adds admin-related columns to the `properties` table (status management fields).

**Migration 4 — `3f8b2a1c9d7e`** *(most recent)*  
Adds the `image_url` column to the `properties` table. This allows each property to have a proper photo URL instead of relying on rotating local images.

### Database Relationships (Entity Relationship)

```
┌──────────────────┐
│     USERS        │
│  id              │◄──────────────────────┐
│  email           │                        │
│  hashed_password │         ┌─────────────────────────────┐
└──────────────────┘         │      SAVED_PROPERTIES       │
                             │  id                         │
                             │  user_id  ─────────────────►│ (FK to users)
┌──────────────────┐         │  property_id ─────────────► │ (FK to properties)
│   PROPERTIES     │◄────────│  status                     │
│  id              │         │  notes                      │
│  external_id     │         │  viewing_at                 │
│  title, area     │         │  UNIQUE(user_id, property_id)│
│  monthly_rent    │         └─────────────────────────────┘
│  image_url       │
│  status          │
└──────────────────┘
         │
         │ (cascade delete)
         ▼
┌──────────────────┐
│  SAVED_SEARCHES  │
│  id              │
│  user_id         │ (FK to users)
│  (search params) │
└──────────────────┘
```

---

## 8. Feature Map — Every Feature and How It Works

### Homepage (`/`)

| Feature | Live or Static? | How it works |
|---|---|---|
| Property count badge | **LIVE** | Calls `GET /api/properties/stats` on page load |
| Search bar | Interactive | Navigates to `/search` with filter params in URL |
| Featured property cards | Static | 6 hardcoded properties in `maskan-data.ts` |
| Market statistics | Static | 4 hardcoded KPI numbers in `maskan-data.ts` |
| Featured area cards | Static | 4 hardcoded districts in `maskan-data.ts` |
| AI chat teaser | Static | Links to `/advisor` |

---

### Search Page (`/search`)

| Feature | Live or Static? | How it works |
|---|---|---|
| Property grid | **LIVE** | `fetchProperties()` → API → maps to UI format |
| Filter by city | Client-side | Filters the already-loaded array in memory |
| Filter by type | Client-side | Same |
| Filter by bedrooms | Client-side | Same |
| Filter by price range | Client-side | Same |
| Sort | Client-side | `Array.sort()` on the filtered results |
| Compare bar | Client state | Tracks selected IDs in `useState` |

---

### Property Detail Page (`/property/:id`)

| Feature | Live or Static? | How it works |
|---|---|---|
| All property data | **LIVE** | `fetchProperty(id)` from API |
| Gallery images | Mixed | `image_url` from database if available, else local images |
| Fair Rent Analysis | **LIVE** | `fetchAreas()` gets district average, computes market band |
| Rental Intelligence scores | Static demo | Hardcoded 82–94 values for demonstration |
| Area score rings | Static | `DISTRICT_SCORES` lookup table in `maskan-data.ts` |
| Nearby places | Static | Hardcoded schools, hospitals, mosques, supermarkets |
| Comparable listings | **LIVE** | Other properties from same `fetchProperties()` call |
| Contact landlord modal | Simulated | Shows success state — no backend call yet |
| Call agent modal | UI only | Shows phone number as `tel:` link |
| Chat modal | Simulated | Shows success state — no backend call yet |
| Save button | Local state only | `useState` toggle — not persisted to database |
| Compare button | Navigation | Routes to `/compare` |
| Ask AI button | Navigation | Routes to `/advisor` |

---

### Compare Page (`/compare`)

| Feature | Live or Static? | How it works |
|---|---|---|
| Property selection | **LIVE** | Loads all properties from API, user picks up to 3 |
| Financial comparison | Mixed | Rent is live; deposit is from a static lookup by property ID |
| Area scores | Static | From a hardcoded `detailsById` lookup |
| Amenities | Static | From the same hardcoded lookup |
| AI recommendation | Computed | Weighted formula run in browser using live + static data |
| Save shortlist | **LIVE** | `POST /api/saved-properties/` × N |

---

### Areas Intelligence Console (`/areas`)

| Feature | Live or Static? | How it works |
|---|---|---|
| District table | Mixed | Static scores + LIVE rent/listings from API |
| Trend chart | Static | 5-year data points hardcoded per district |
| Schools + hospitals tabs | Static | Hardcoded per district |
| Market notes | Session state | `useState` — changes persist during page visit only, lost on refresh |
| Add note | Session state | Appended to local `districts` state |
| New district modal | Session state | Added to local `districts` state |
| Export CSV | Client-side | Generated from current filtered state |

---

### Analytics Dashboard (`/analytics`)

| Feature | Live or Static? | How it works |
|---|---|---|
| KPI cards | **LIVE** | `fetchAnalyticsSummary()` from API |
| Search demand chart | **LIVE** | Scaled from real property counts |
| Popular areas | **LIVE** | Aggregated from properties table |
| Conversion funnel | **LIVE** | Computed from saved_properties + users tables |
| AI usage trends | Estimated | Static ratios blended with real counts |

---

### AI Advisor (`/advisor`)

| Feature | Live or Static? | How it works |
|---|---|---|
| Chat | **LIVE** | `POST /api/ai/chat` → Anthropic Claude |
| Suggested questions | Static | Hardcoded list of common questions |
| Conversation history | Session state | Passed with every message so Claude has context |

---

### Admin Panel (`/admin`)

| Feature | Live or Static? | How it works |
|---|---|---|
| All features | **LIVE** | Full CRUD via API — create, read, update, delete |
| Auth guard | **LIVE** | `user?.is_admin` check — server verifies on every request |

---

### Saved Properties (`/saved`)

| Feature | Live or Static? | How it works |
|---|---|---|
| All features | **LIVE** | Full CRUD on saved_properties table |

---

## 9. Running the Project on Your Computer

### Option A: Docker (Easiest — Recommended)

You need Docker Desktop installed. Then from the project root:

```bash
docker compose up --build
```

This starts three containers:
1. **PostgreSQL** on port 5433
2. **Backend** on port 8000 (runs migrations + seed automatically on startup)
3. **Frontend** on port 8080

Wait until you see "VITE ready in Xms" in the logs, then open `http://localhost:8080`.

---

### Option B: Running Manually

**Backend:**

```bash
cd backend

# Install Python packages
pip install -r requirements.txt

# Copy the config template and fill in your values
cp .env.example .env
# Edit .env: add your ANTHROPIC_API_KEY and set ADMIN_EMAILS

# Create database tables (run all migrations)
alembic upgrade head

# Fill with sample data
python seed.py

# Start the server
python run.py
# Server is at http://localhost:8000
# API docs at http://localhost:8000/docs
```

**Frontend:**

```bash
cd frontend

# Install JavaScript packages
npm install

# Start the dev server
npm run dev
# Website is at http://localhost:8080
```

---

### Default Login Credentials

| Role | Email | Password |
|---|---|---|
| Admin | mnaushad.fms@gmail.com | Admin@1234 |

---

### Common Issues and Fixes

| Problem | Cause | Fix |
|---|---|---|
| "password authentication failed" | `.env` password doesn't match docker-compose | Update `DATABASE_URL` password in `.env` to match docker-compose `POSTGRES_PASSWORD` |
| "No module named alembic" | Wrong Python being used | Use the full path to alembic: `C:\Users\...\Scripts\alembic.exe` |
| Frontend shows on port 8080 not 5173 | Lovable vite config locks port to 8080 | Access the app at port 8080, not 5173 |
| AI chat returns 503 error | `ANTHROPIC_API_KEY` not set | Add your API key to `backend/.env` |
| Property images not loading | `image_url` column missing | Run migrations: `alembic upgrade head` then `python seed.py` |

---

## 10. Important Patterns and Decisions

### Why stateless JWT instead of sessions?

A "session" means the server stores who is logged in (in memory or a database). If you have 10 servers, they all need to share session state — complex to coordinate.

JWT (JSON Web Token) is stateless: the token contains the user's identity, signed by our secret key. Any server can verify the signature independently. No shared state needed. This is why the application can scale to 20 backend containers easily — each one can independently verify any user's token.

### Why email-based admin instead of a database role?

Many apps store `is_admin: true` as a database column. This requires a migration to add the column, and a UI to change it. Our approach: `ADMIN_EMAILS` is a list in `.env`. To make someone an admin, edit `.env`, restart the server — done. No migration, no UI, no risk of accidentally giving the wrong person admin rights.

### Why does the frontend use `typeof window !== "undefined"`?

Because pages are initially rendered on a Node.js server (SSR), and Node.js does not have a `window` object. Any code that references `window`, `localStorage`, `document`, or any browser API needs this guard. Without it, the server-side render crashes and the user sees a blank page.

### Why `reload=False` in uvicorn on Windows?

FastAPI's hot-reload (restarts server on file save) works by spawning a child process. On Windows, the child process uses a different Python installation that may not have all packages installed. The result is `ModuleNotFoundError`. We avoid this entirely by setting `reload=False` and restarting manually.

### Monthly vs Annual Rent

The database stores `monthly_rent` (SAR per month). The UI `Property` type has a `price` field that holds this same monthly value. However, some parts of the UI display it multiplied by 12 and labelled "Annual rent." This is a known naming inconsistency — `price` is actually monthly, not annual, in the underlying data.

### Why separate schemas from models?

The SQLAlchemy model defines exactly what is stored in the database. The Pydantic schema defines what is acceptable to receive from a user or send back to them. They are often similar but not identical:
- The model has `hashed_password`. The schema for responses doesn't — you never send a password hash back.
- The model has `created_at` with a server default. The "create" schema doesn't — the user doesn't send a timestamp.
- The "out" schema for saved properties includes the full nested property data — the database table just has a `property_id` foreign key.

---

## 11. Interview Preparation — Key Questions Answered

### "Tell me what Maskan is in one sentence."
Maskan is a Saudi rental marketplace built with FastAPI (Python) and React (TypeScript) that uses Anthropic Claude AI to help tenants evaluate properties and negotiate rents.

---

### "What does the technology stack look like?"
- **Backend:** Python + FastAPI + SQLAlchemy 2.0 + PostgreSQL + JWT auth + Anthropic Claude
- **Frontend:** React 18 + TypeScript + TanStack Start (SSR) + Tailwind CSS + shadcn/ui
- **Infrastructure:** Docker + docker-compose (development), ECS Fargate on AWS (production)

---

### "Why FastAPI over Django or Flask?"

| FastAPI | Django | Flask |
|---|---|---|
| Auto-generates Swagger UI from code | No automatic docs | No automatic docs |
| Native async/await support | Async is add-on | Async is add-on |
| Pydantic validation built in | Forms/serializers are separate | Marshmallow is separate |
| Very fast (Starlette underneath) | Slower due to ORM magic | Light but no ORM |

FastAPI gives us: automatic documentation, type-safe request validation, and excellent performance — all in one package.

---

### "How does authentication work?"

1. User logs in → server verifies password hash → creates JWT containing `{ sub: user_id, exp: timestamp }`
2. JWT is signed using our `SECRET_KEY` (HS256 algorithm)
3. Frontend stores token in `localStorage` as `maskan_token`
4. Every API request includes `Authorization: Bearer <token>` header (added automatically by `requestJson()`)
5. Protected endpoints call `Depends(get_current_user)` which decodes the JWT, verifies signature, checks expiry, and returns the User object
6. Token expires after 24 hours — user must log in again

---

### "What is the database schema?"

Four tables:
- **users** — email, hashed password, name
- **properties** — all listing details (title, area, rent, image, status, etc.)
- **saved_properties** — links users to properties they've saved (many-to-many junction table with extra fields)
- **saved_searches** — stores user search filter preferences

---

### "How does the AI work?"

The AI Advisor uses Anthropic's Claude model (`claude-opus-4-8`). When a user sends a question:
1. The frontend sends the message + full conversation history to `POST /api/ai/chat`
2. Our FastAPI backend prepends a system prompt (Saudi rental advisor persona)
3. The complete conversation is forwarded to Anthropic's API
4. Claude's response is returned to the user

The AI does NOT have access to our database directly. All its knowledge comes from its training data + the conversation context.

---

### "What is Server-Side Rendering and why use it?"

SSR means the first HTML is built on the server, not the browser. Benefits:
- **Speed:** Users see content immediately without waiting for JavaScript to load and run
- **SEO:** Search engines can read the page content (critical for a property marketplace)
- **Crawlability:** Google can index property listings

The trade-off: browser APIs (`window`, `localStorage`) are not available during server render, so every usage needs a safety guard.

---

### "How does horizontal scaling work?"

Because:
- **FastAPI backend is stateless** — each request carries its own JWT. No session state. 20 backend containers can all handle any request independently.
- **Frontend SSR is stateless** — the Node.js process renders HTML per request with no shared state. Multiple containers work fine.
- **Redis (in production)** — shared cache. All backend containers read/write the same Redis instead of each caching independently.
- **JWT secret is consistent** — stored in AWS Secrets Manager, loaded once on startup. Every container uses the same key.
- **The only thing that doesn't scale horizontally:** the database write endpoint. You scale reads by adding read replicas, and writes by moving to a larger instance.

---

### "What design patterns are used?"

**Dependency Injection** — FastAPI injects `get_db()` and `get_current_user()` into endpoints. The endpoint doesn't need to know how to open a database connection — it just receives one.

**Repository pattern (light)** — All API calls are centralized in `maskan.ts`. No component makes direct `fetch()` calls.

**Context provider** — Auth state is provided top-down to all components via React Context without prop drilling.

**Mapper functions** — `mapApiProperty()` converts the raw API shape to the UI shape in one place. If the API changes, only the mapper needs updating.

**File-based routing** — Each file in `src/routes/` is one page. No manual route registration needed.

---

## 12. Production Deployment — Taking It Live

When the application is deployed on the internet for real users (not just your laptop), we need a much more robust setup. This section explains what production looks like and why each piece is there.

### 12.1 The Full Picture — Where Everything Lives

Imagine the journey of a user opening `https://maskan.sa` in their browser:

```
 USER'S BROWSER
       │
       │ Types maskan.sa — DNS looks up the IP address
       ▼
 CLOUDFRONT (AWS Global CDN)
   • Serves cached images, JS, and CSS from a server close to the user
   • Blocks malicious traffic (SQL injection, XSS attacks, DDoS)
   • SSL certificate — turns http:// into https://
       │
       │ For every page request: forward to the right place
       ▼
 TWO SEPARATE LOAD BALANCERS
   /api/* goes to → Backend Load Balancer
   /* goes to     → Frontend Load Balancer
       │                    │
       ▼                    ▼
 BACKEND SERVERS        FRONTEND SERVERS
 (FastAPI)              (Node.js SSR)
 2 to 20 copies         2 to 10 copies
 Auto-scaling           Auto-scaling
       │                    │
       ▼                    │
 REDIS CACHE               │
   Shared memory            │
   across all servers       │
       │                    │
       ▼                    │
 POSTGRESQL DATABASE ◄──────┘
   Primary (read + write)
   Replica (read only, for reports)
   Automatic backup daily
       │
       ▼
 ANTHROPIC API
   (External — for AI chat)
```

---

### 12.2 Why Two Load Balancers?

A load balancer sits in front of multiple servers and distributes traffic between them. If one server crashes, the load balancer stops sending traffic to it.

We have **two separate load balancers** — one for the backend, one for the frontend. Why?

- **Independent scaling:** If the frontend is under heavy traffic (lots of people browsing), we can add more frontend servers without touching the backend.
- **Independent deployment:** We can update the frontend without restarting the backend, and vice versa. Zero downtime.
- **Clear separation:** CloudFront routes `/api/*` requests to the backend load balancer and everything else to the frontend load balancer.

---

### 12.3 The Network Security Setup

**Virtual Private Cloud (VPC):** A private network in the cloud that only our servers can access. Think of it as a locked building — the internet can only reach the front door (CloudFront/load balancers), not the internal offices (backend servers, database).

**Three subnet layers:**
- **Public subnets:** Where load balancers live. They have internet-facing IP addresses.
- **Private subnets:** Where backend and frontend servers live. No public IP — the internet cannot directly reach them.
- **Database subnets:** Most isolated. Only the backend servers can connect here.

**Two availability zones:** Our servers run in two physically separate data centres (AZ-a and AZ-b). If one data centre loses power, all traffic automatically moves to the other. Zero downtime.

**Security groups (like firewall rules):**

| Who | Can receive from | Can connect to |
|---|---|---|
| Load balancers | Anyone (internet) | Only backend servers on port 8000, frontend on 8080 |
| Backend servers | Only from load balancers | Database (port 5432), Redis (port 6379), Anthropic (internet via NAT) |
| Frontend servers | Only from load balancers | Backend servers (for SSR API calls) |
| Database | Only from backend servers | Nothing |
| Redis | Only from backend servers | Nothing |

The database is completely unreachable from the internet. Even if an attacker discovered the database address, they cannot connect without going through our backend servers first.

---

### 12.4 ECS Fargate — Running Containers in the Cloud

**ECS (Elastic Container Service):** AWS's service for running Docker containers.  
**Fargate:** A mode where AWS manages the servers for you. You just say "run this container with 0.5 CPU and 1GB RAM" and AWS handles the rest — no servers to patch, no capacity to plan.

**Backend containers:**
- Each container runs FastAPI with Gunicorn (4 workers per container)
- Why Gunicorn? Uvicorn alone is single-process. Gunicorn manages 4 worker processes inside one container, using all available CPU cores.
- Minimum: 2 containers always running (one per availability zone for high availability)
- Maximum: 20 containers
- Auto-scale: If CPU usage goes above 60% for 2 minutes, add 2 more containers. If below 30% for 5 minutes, remove one.

**Frontend containers:**
- Each container runs Node.js (TanStack Start SSR server)
- Minimum: 2, Maximum: 10
- Auto-scale: CPU > 70% → add a container

**Why at least 2 containers always?** If you only have 1 container and it crashes (or needs an update), your site goes down. With 2 (one in each data centre), even if one crashes, the other continues serving traffic.

---

### 12.5 Production Dockerfiles — Smaller and Safer

The development Dockerfile is simple — install dependencies, copy code, run dev server. It results in a large image with everything including dev tools.

Production uses **multi-stage builds:**

**Backend (two stages):**
1. **Build stage:** Install all Python packages into a temporary location
2. **Runtime stage:** Copy only the installed packages (not build tools), copy the application code, create a non-root user for security, run with Gunicorn

**Frontend (two stages):**
1. **Build stage:** Install Node.js packages, run `npm run build` to compile TypeScript to JavaScript
2. **Runtime stage:** Copy only the compiled `.output/` directory (not source code, not 300MB of node_modules), run Node.js

Result: The production image is ~100MB instead of ~800MB. Smaller = faster to download, less attack surface.

**Security: non-root user.** In both production Dockerfiles, we create a user called `maskan` and run the server as that user. If an attacker somehow gets inside the container, they only have limited user permissions — not root access.

---

### 12.6 The Database in Production

**RDS (Relational Database Service):** AWS's managed PostgreSQL. AWS handles backups, patching, and failover.

**Multi-AZ:** The database has a primary server and a standby (in a different data centre). If the primary fails, AWS automatically switches to the standby within ~60 seconds. No manual intervention needed.

**Read Replica:** A copy of the database that only accepts read (SELECT) queries. Analytics queries that take a long time run here instead of on the primary, so they don't slow down regular users.

**Connection pooling — why it matters:**  
With 20 backend containers × 4 Gunicorn workers each = 80 processes. Each process keeps a pool of 5 database connections open. That's 400 connections. PostgreSQL typically allows 200 connections. Problem.

Solution: Add **PgBouncer** (a connection pooler) between the backend and database. PgBouncer accepts all 400 connections from our servers but only keeps ~20 actual connections to the database open. It multiplexes them at the transaction level. The database sees only 20 connections even when 400 processes are active.

**Running migrations safely in production:**  
You cannot run `alembic upgrade head` inside the regular startup command — if 4 containers start simultaneously, all 4 try to run the migration at the same time, and you get race conditions and broken schema.

The correct approach: Run migrations as a **separate task** in the CI/CD pipeline, before deploying the new containers. Only one migration task runs, it completes successfully, then the new containers start.

---

### 12.7 Redis Cache — Why It Matters

**The problem:** A request for "list all properties" hits the database, runs a query, and returns 25 rows. If 1,000 users all request the property list in the same minute, that's 1,000 identical database queries.

**The solution:** Redis is an in-memory key-value store (like a fast dictionary). The first request queries the database and stores the result in Redis with a 60-second expiry. The next 999 requests are answered from Redis (no database hit) in under 1 millisecond.

**Why not cache in FastAPI itself?** A Python dictionary inside the FastAPI process only helps that one process. With 20 containers, each has its own cache. A property update invalidates the cache in only 1 container — the other 19 still serve stale data. Redis is shared across all containers.

**What gets cached:**

| What | How long | Why |
|---|---|---|
| Property list | 60 seconds | Frequent request, rarely changes |
| Single property | 5 minutes | Even less frequent changes |
| Area statistics | 5 minutes | Expensive aggregation query |
| Analytics summary | 2 minutes | Dashboard can be slightly stale |
| AI rate limit | 1 minute | Prevent abuse of expensive AI calls |

**Cache invalidation:** When an admin edits or deletes a property, the backend immediately deletes the relevant Redis keys. The next request hits the database fresh.

---

### 12.8 CDN and Static Assets

**CloudFront (AWS Content Delivery Network):** A global network of ~400 servers around the world. When a user in Riyadh requests a JavaScript file, they get it from a server in Bahrain, not one in Virginia. Much faster.

**What gets cached on the CDN:**
- JavaScript bundles, CSS files, fonts — cached for 1 year (they have hashed filenames, so an update automatically gets a new URL and breaks the cache)
- Property images from S3 — cached for 30 days
- SSR HTML pages — NOT cached (they contain user-specific content and must be fresh)
- API responses — NOT cached at CDN level (Redis handles this at the app level)

---

### 12.9 CI/CD — How Code Goes from Your Laptop to Production

**CI/CD stands for Continuous Integration / Continuous Deployment.** Every time code is pushed to the `main` branch, an automated pipeline runs.

**Step 1 — Tests and code quality check:**
- Backend: run all tests with pytest, run type checking with mypy
- Frontend: check TypeScript types, run ESLint for code quality
- If anything fails, the pipeline stops — no deployment happens

**Step 2 — Build Docker images (backend and frontend in parallel):**
- Build the production Dockerfile for each service
- Push the image to ECR (Elastic Container Registry — AWS's Docker Hub equivalent)
- Tag with the Git commit hash (e.g., `maskan-backend:a1b2c3d`)

**Step 3 — Run database migrations:**
- Launch a temporary migration container (same backend image, but command = `alembic upgrade head`)
- Wait for it to finish successfully
- If migrations fail, pipeline stops — no deployment

**Step 4 — Deploy:**
- Tell ECS to update the backend service with the new image
- Tell ECS to update the frontend service with the new image
- ECS starts new containers first, waits for them to pass health checks, then stops old containers
- Zero downtime — users experience no interruption

**Step 5 — Smoke test:**
- Automatically test that `https://maskan.sa/api/health` returns 200
- Automatically test that `https://maskan.sa/` returns HTML
- If either fails, trigger a rollback (deploy the previous image)

---

### 12.10 Secrets in Production — No Plain Text Passwords

In development, passwords go in `.env`. In production, we use **AWS Secrets Manager:**

- All secrets (database password, JWT secret key, Anthropic API key, admin emails) are stored encrypted in Secrets Manager
- ECS containers are granted permission to read specific secrets
- At container startup, ECS automatically fetches the secrets and injects them as environment variables
- The secrets never appear in plain text in any configuration file, code repository, or container image

**How to generate a secure SECRET_KEY:**
```bash
python -c "import secrets; print(secrets.token_hex(64))"
```
Output: a 128-character random string like `a3f8b2d...`. Use this, not the default dev value.

---

### 12.11 How Scaling Works in Practice

**The application naturally handles more users by adding more containers.** Here is why:

- **No local state:** The backend does not store anything in memory between requests. Every request is completely independent.
- **JWT is stateless:** Any container can verify any user's token without consulting a central session store.
- **Redis is shared:** All containers share the same cache, so one container's cache hit benefits all users.
- **Database is shared:** All containers read from and write to the same PostgreSQL database.

**Auto-scaling rules:**

For the backend, AWS automatically:
- Watches CPU usage across all running containers
- If average CPU > 60% for 2 minutes → start 2 more containers
- If average CPU < 30% for 5 minutes → remove 1 container
- Always keep at least 2 containers, never more than 20

**What CANNOT scale horizontally:**
- The database **write** endpoint — only one primary database accepts writes. Scale by adding a larger instance type.
- Alembic migrations — only run once, not in parallel. Handled by the CI/CD pipeline.

---

### 12.12 Security — Layers of Protection

Security is not one thing — it is layers. Even if one layer is breached, the next layer stops the attack.

**Layer 1 — AWS WAF (Web Application Firewall):**
Blocks known attack patterns before they reach our servers: SQL injection attempts, cross-site scripting (XSS), known bad IP addresses. Rate limiting: if one IP makes more than 1,000 requests in 5 minutes, they are blocked.

**Layer 2 — HTTPS Only:**
All communication is encrypted. HTTP requests are automatically redirected to HTTPS. Certificate managed by AWS (auto-renewed).

**Layer 3 — Private Network:**
Backend servers, database, and Redis have no public IP addresses. They cannot be directly accessed from the internet.

**Layer 4 — Security Groups:**
Strict firewall rules. The database can only receive connections from backend servers. Backend servers can only receive connections from load balancers. Nothing else.

**Layer 5 — Application Security:**
- Passwords are hashed (not stored in plain text)
- JWT tokens expire after 24 hours
- Admin endpoints re-verify on every request (the client's claim is not trusted)
- CORS blocks requests from unauthorized origins

**Layer 6 — Secrets Management:**
No passwords in code or config files. All secrets in AWS Secrets Manager with encryption. IAM permissions are minimal — each service can only access the specific secrets it needs.

**Layer 7 — Container Security:**
- Containers run as a non-root user
- ECR automatically scans container images for known vulnerabilities
- No SSH access to containers (use AWS ECS Exec for emergencies)

---

### 12.13 Monitoring — How We Know If Something Is Wrong

**Health checks (automatic):**
- AWS checks `GET /api/health` every 30 seconds. If it fails 3 times in a row, that container is replaced.
- AWS checks `GET /` on the frontend every 30 seconds. Same behaviour.

**CloudWatch Alerts (we get notified):**

| What we monitor | Warning level | Critical level |
|---|---|---|
| Backend CPU usage | Over 60% | Over 85% |
| Number of running backend containers | Under 2 | 0 |
| Error rate (5xx responses) | Over 1% | Over 5% |
| Response time | Over 1 second | Over 3 seconds |
| Database CPU | Over 70% | Over 90% |
| Database connections | Over 150 (limit is 200) | Over 180 |
| Redis memory | Cache evictions over 100/min | Over 1000/min |

**Structured logs:** In production, every API request is logged as JSON:
```json
{
  "timestamp": "2026-06-14T09:30:00Z",
  "method": "GET",
  "path": "/api/properties/",
  "status": 200,
  "duration_ms": 43,
  "user_id": 42
}
```
This lets us query logs to find patterns: "show me all requests that took longer than 1 second in the last hour."

---

### 12.14 Production Launch Checklist

**One-time infrastructure setup:**
- [ ] VPC, subnets, and security groups created
- [ ] RDS PostgreSQL with Multi-AZ enabled
- [ ] ElastiCache Redis cluster
- [ ] ECR repositories for backend and frontend images
- [ ] ECS cluster and both services configured
- [ ] Both load balancers with health checks
- [ ] CloudFront distribution with WAF rules attached
- [ ] SSL certificate from AWS Certificate Manager
- [ ] Domain name `maskan.sa` pointing to CloudFront
- [ ] All secrets entered in Secrets Manager
- [ ] IAM roles created for ECS and GitHub Actions
- [ ] GitHub Actions configured with AWS credentials

**Before each deployment:**
- [ ] All tests pass in CI
- [ ] Docker images build without errors
- [ ] New migration tested on a copy of the production database first
- [ ] `SECRET_KEY` is a 64-character random string (not the dev default)
- [ ] `ADMIN_EMAILS` has the correct addresses
- [ ] `ANTHROPIC_API_KEY` is valid and has enough quota

**After each deployment:**
- [ ] `GET /api/health` returns 200 OK
- [ ] Login with admin credentials works
- [ ] Property list loads with real data
- [ ] AI chat responds correctly
- [ ] Admin panel is only accessible to admin email
- [ ] HTTPS is enforced
- [ ] CloudWatch logs are receiving entries from both services
- [ ] ECS services show "Desired count = Running count"

---

### 12.15 Cloud Provider Options

This architecture uses AWS, but the same design works on any major cloud provider:

| Component | AWS | Google Cloud (GCP) | Microsoft Azure |
|---|---|---|---|
| Container runtime | ECS Fargate | Cloud Run | Azure Container Apps |
| Container registry | ECR | Artifact Registry | Azure Container Registry |
| Load balancer | ALB | Cloud Load Balancing | Application Gateway |
| CDN | CloudFront | Cloud CDN | Azure Front Door |
| Web Application Firewall | AWS WAF | Cloud Armor | Azure WAF |
| Managed PostgreSQL | RDS | Cloud SQL | Azure Database for PostgreSQL |
| Redis cache | ElastiCache | Memorystore | Azure Cache for Redis |
| Secrets management | Secrets Manager | Secret Manager | Azure Key Vault |
| DNS | Route 53 | Cloud DNS | Azure DNS |
| File storage | S3 | Cloud Storage | Azure Blob Storage |
| Logs | CloudWatch Logs | Cloud Logging | Azure Monitor |
| Alerts | CloudWatch Alarms | Cloud Monitoring | Azure Monitor |

**Using Kubernetes instead?**  
If the team prefers Kubernetes, replace ECS Fargate with:
- AWS: EKS (Elastic Kubernetes Service)
- GCP: GKE (Google Kubernetes Engine)
- Azure: AKS (Azure Kubernetes Service)

Each Docker container becomes a Kubernetes `Deployment`. Auto-scaling is handled by a `HorizontalPodAutoscaler`. The architecture layers are identical — only the configuration format changes.

---

*Update this document every time a new route, endpoint, model, or significant feature is added.*
