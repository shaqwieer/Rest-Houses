# استراحات — Desert Chalets Booking Platform

A production-ready booking platform for private desert rest houses and chalets
(**استراحات**) in the UAE. Fully Arabic, right-to-left, with a mobile-first admin
dashboard and WhatsApp-based booking requests.

Built from the Claude Design spec `Desert Chalets Booking.dc.html` — colours,
typography, spacing and components match it.

---

## Table of contents

1. [What's in the box](#whats-in-the-box)
2. [Tech stack](#tech-stack)
3. [Quick start](#quick-start)
4. [Environment variables](#environment-variables)
5. [Project structure](#project-structure)
6. [Changing the site name, colours and branding](#changing-the-site-name-colours-and-branding)
7. [How the booking flow works](#how-the-booking-flow-works)
8. [Form protection](#form-protection)
9. [Running with Docker](#running-with-docker)
10. [Image storage (including images in the database)](#image-storage-including-images-in-the-database)
11. [Database and migrations](#database-and-migrations)
12. [Enabling online deposit payments](#enabling-online-deposit-payments)
13. [Deploying](#deploying)
14. [Everyday tasks](#everyday-tasks)
15. [Design decisions worth knowing](#design-decisions-worth-knowing)
16. [Troubleshooting](#troubleshooting)

---

## What's in the box

### Public site

| Route | What it does |
|---|---|
| `/` | Hero search (destination, dates, guests), categories, featured listings, trust points, testimonials, WhatsApp CTA |
| `/listings` | Search results with filters (city, occasion, max price, capacity, amenities), sorting, and an optional map view. All filter state lives in the URL, so any filtered view is shareable |
| `/listings/[slug]` | Gallery, description, amenities, **availability calendar** with booked/blocked days disabled, Leaflet map, reviews, sticky price card |
| `/listings/[slug]/book` | Booking request form with a live price summary |
| `/booking/[reference]` | Confirmation screen + the prefilled WhatsApp deep link |
| `/favorites` | Saved listings (localStorage — no account needed) |
| `/about`, `/how-it-works`, `/faq`, `/policies`, `/privacy` | Content pages, with `HowTo` and `FAQPage` structured data |
| `/sitemap.xml`, `/robots.txt`, `/api/og` | SEO: sitemap, crawl rules, dynamic Open Graph card images |
| `/api/images/[id]` | Serves photos stored in the database (immutable caching + ETag) |
| `/api/health` | Liveness + database reachability, used by the Docker healthcheck |

### Admin dashboard (`/admin`) — mobile first

| Route | What it does |
|---|---|
| `/admin` | Real stats (new requests, confirmed bookings, occupancy, expected revenue), weekly occupancy chart, latest requests |
| `/admin/listings` | List, publish/unpublish, edit, delete |
| `/admin/listings/new`, `/admin/listings/[id]` | Full editor: name, description, city, area, prices, capacity, amenities, categories, coordinates, images, owner contact, flags |
| `/admin/calendar` | Tap any day to block/free it; bulk block or free the rest of a month |
| `/admin/requests` | Confirm / reject / cancel requests, filter by status, one-tap WhatsApp reply |
| `/admin/settings` | Site name, logo, colours, WhatsApp number, contacts, socials, map location, fees, hero copy, SEO, Google tag |

Navigation is a thumb-reachable bottom tab bar on phones (clearing the iOS home
indicator) and a pill bar on desktop. Every admin action is confirmed with a
toast; destructive ones ask first.

---

## Tech stack

- **Next.js 15** (App Router) + **React 19** + **TypeScript** (strict)
- **Tailwind CSS v4** — CSS-first config, no `tailwind.config.js`. Design tokens
  in `src/app/globals.css`
- **Prisma** — PostgreSQL everywhere: local, tests and production
- **NextAuth v5** (credentials) — a single admin login, JWT sessions
- **Almarai** (headings) + **Tajawal** (body), self-hosted via `next/font`
- **Leaflet** + CARTO tiles for interactive maps; Google Maps embed for the
  business location
- **Docker** — multi-stage build, non-root, stateless (photos live in the DB)
- Zero UI component libraries — everything is built to the design spec

---

## Quick start

Requires **Node.js 20+** (tested on 22) and **Docker**, for PostgreSQL.

```bash
# 1. install
npm install

# 2. create your env file
cp .env.example .env
#    then edit .env — at minimum set AUTH_SECRET and ADMIN_PASSWORD
#    generate a secret with:  openssl rand -base64 32

# 3. start PostgreSQL (127.0.0.1:55433)
npm run db:up

# 4. apply migrations and load sample data
npm run db:migrate      # prisma migrate deploy
npm run db:seed         # admin user + settings + 8 sample استراحات

# 5. run
npm run dev
```

PostgreSQL rather than a local SQLite file so that development, the test suite
and production all run the same engine — see
[Database and migrations](#database-and-migrations) for why that stopped being
optional.

Open **http://localhost:3000**. The dashboard is at **/admin** — log in with the
`ADMIN_EMAIL` / `ADMIN_PASSWORD` from your `.env`.

Verify everything is wired up correctly at any time:

```bash
npm run verify      # 70 checks: date maths, pricing, WhatsApp links, DB round-trip
npm run typecheck   # tsc --noEmit
npm run build       # production build
```

---

## Environment variables

Every variable, what it does, and whether it is required.

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | ✅ | `postgresql://…` — `npm run db:up` starts a local server |
| `AUTH_SECRET` | ✅ | Signs session cookies. `openssl rand -base64 32` |
| `NEXTAUTH_URL` | prod | Absolute site URL, for auth callbacks |
| `NEXT_PUBLIC_SITE_URL` | prod | Absolute site URL, for canonical tags, sitemap and OG image URLs |
| `ADMIN_EMAIL` | ✅ | The admin login. Created/updated by `db:seed` |
| `ADMIN_PASSWORD` | ✅ | Bcrypt-hashed at seed time; never stored in clear |
| `ADMIN_NAME` | — | Shown in the dashboard greeting |
| `SITE_NAME` | — | **Seed only.** Initial site name; afterwards the database wins |
| `WHATSAPP_NUMBER` | — | **Seed only.** Initial WhatsApp number |
| `CONTACT_EMAIL` | — | **Seed only.** Initial contact email |
| `STORAGE_DRIVER` | — | `db` (images in the database — Docker default), `local` (disk, default otherwise), `cloudinary`, `s3` |
| `CLOUDINARY_*` / `S3_*` | — | Only for the matching driver — see [Image storage](#image-storage-including-images-in-the-database) |
| `STRIPE_*` | — | Only when enabling deposit payments |

> **Important:** `SITE_NAME`, `WHATSAPP_NUMBER` and `CONTACT_EMAIL` only apply the
> **first** time you seed. After that the settings row in the database is the
> source of truth and is edited from `/admin/settings`. This is deliberate — the
> owner must be able to rebrand without touching a server config or redeploying.

For Docker, use **`.env.docker.example`** instead — it adds the `POSTGRES_*`
values that `docker-compose.yml` uses to build `DATABASE_URL` for you.

---

## Project structure

```
prisma/
  schema.prisma          data model, with a portability note at the top
  seed.ts                admin user + settings + 8 sample استراحات
scripts/
  verify.ts              70-check smoke test (npm run verify)
tests/                   vitest suite, runs against PostgreSQL
docker/
  entrypoint.sh          app container: validate config, exec the server
  migrate.sh             one-shot job: apply migrations — no fallback
  seed.sh                sample data, behind the `seed` compose profile
Dockerfile               multi-stage build (standalone, non-root)
docker-compose.yml       app + postgres + one-shot migrate job
src/
  app/
    (site)/              public site — shares the header/footer layout
      page.tsx           home
      listings/          results, detail, booking form
      booking/           confirmation + WhatsApp link
      favorites/, about/, faq/, how-it-works/, policies/, privacy/
    admin/               dashboard (mobile-first shell, auth-guarded)
    login/               admin sign-in
    actions/             server actions — the only code that writes
      booking.ts         public booking request
      listings.ts        listing CRUD + images
      availability.ts    calendar block/free
      requests.ts        confirm / reject / cancel
      settings.ts        branding + config
      auth.ts            sign in / out
    api/
      auth/[...nextauth] NextAuth handlers
      og/                dynamic Open Graph images
      images/[id]/       serves images stored in the database
      health/            liveness + database reachability (Docker healthcheck)
    layout.tsx           RTL root, fonts, DB-driven theme injection
    globals.css          design tokens + Tailwind theme
    sitemap.ts, robots.ts
  components/
    ui/                  Button, Field, Badge, Icon, Toast
    site/                Header, Footer, Brand, HeroSearch, Favorites
    listing/             Card, Gallery, Calendar, Map, Filters, BookingCard
    booking/             BookingForm
    admin/               Shell, ListingEditor, AvailabilityEditor, RequestCard, SettingsForm
  lib/
    prisma.ts            singleton client
    settings.ts          getSettings() — request-cached
    theme.ts             4 stored hex values → the full CSS-variable ramp
    auth.ts              NextAuth config + requireAdmin()
    constants.ts         amenities, cities, categories, statuses
    dates.ts             ISODate helpers — read the header comment
    pricing.ts           the one place a total is computed
    whatsapp.ts          deep links + the Arabic message
    format.ts            Arabic-Indic number formatting
    slug.ts              Arabic-aware slugs
    storage/             swappable image adapter (db / local / cloudinary / s3)
    payments/            disabled deposit-payment stub
  middleware.ts          edge guard for /admin
```

**Where writes happen:** only in `src/app/actions/*`. Every action calls
`requireAdmin()` (except the public booking action) and revalidates the affected
pages. Nothing else in the codebase mutates the database.

---

## Changing the site name, colours and branding

### From the dashboard (the normal way — no code, no deploy)

Go to **/admin/settings**. You can change:

- **Identity** — site name, tagline, logo image or the single-letter monogram
- **Contact** — WhatsApp number (this drives *every* WhatsApp button on the
  site), phone, email, Instagram, TikTok, YouTube
- **Colours** — pick from five presets or set four hex values. Everything else
  (tints, borders, surfaces, gradients) is derived automatically. A live preview
  shows the result before you save
- **Location** — paste `lat, lng` straight from Google Maps
- **Booking terms** — service fee %, deposit %, free-cancellation window,
  check-in/out times
- **Home page + SEO** — hero title, subtitle, hero image, footer text, SEO title
  and description
- **Google tag & tracking** — the Google tag ID and one Ads conversion label

Saving takes effect immediately across the whole site.

### Connecting Google Ads or Google Analytics

Google gives you a block of `<script>` and tells you to paste it before
`</head>`. Don't — **/admin/settings** → **وسم جوجل والتتبّع** takes the two
identifiers out of that block instead, and the site writes the snippet itself:

| Field | What Google calls it | Example |
|---|---|---|
| Google tag ID | the `id=` in the gtag.js line, or `config` | `AW-950802645`, `G-ABC123XYZ` |
| Conversion label | the half of `send_to` after the slash | `dVoECJ30sOQcENWxsMUD` |

Pasting the whole `AW-950802645/dVoECJ30sOQcENWxsMUD` into the second field
works — only the label is kept.

Accepted prefixes are `AW-`, `G-`, `GT-` and `DC-` — the four `gtag.js` itself
takes. A Google **Tag Manager** container (`GTM-…`) is loaded by `gtm.js`, not by
this tag, so it is refused rather than rendered as a script that does nothing.

Three things follow from storing identifiers rather than markup, and they are
the reason there is no "paste your head code here" box:

- **The tag loads on the public site only.** It is mounted in
  `src/app/(site)/layout.tsx`, and `/admin`, `/owner` and `/login` sit outside
  that route group — so your own working day never lands in the ad account's
  traffic, or in its conversion counts.
- **The conversion fires once per booking**, on `/booking/[reference]`, carrying
  the reference as `transaction_id` and the booking total as `value` in AED. A
  reload, or a return from WhatsApp with the back button, does not count a
  second time. See `src/components/booking/google-ads-conversion.tsx`.
- **A mistyped paste cannot reach the page.** The IDs are validated against the
  shape Google issues, so a half-copied `<script>` line is refused at the form
  rather than rendered into every page as a tag that never fires.

Clearing the tag ID switches tracking off completely: no script, no `dataLayer`,
no request to Google.

> Adding a Google tag means the site starts sending visitor data to Google.
> Check that `/privacy` says so before you turn it on.

### Arabic and English: what translates itself and what you type twice

The site runs in two languages off one set of URLs (the choice is a cookie —
see the header note in `src/lib/i18n/config.ts` for why there is no `/en/`
prefix). Translation happens on two completely different tiers, and knowing
which is which saves a lot of "why is this still Arabic":

**Tier 1 — text the developers wrote.** Every label, button, heading, validation
message and empty state lives in `src/lib/i18n/ar.ts` and `en.ts`. Switching
language switches all of it, instantly, with nothing to fill in.
`src/lib/i18n/en.ts` is typed as `typeof ar`, so a missing key fails
`npm run typecheck` rather than rendering a blank.

**Tier 2 — text *you* typed into the database.** A dictionary cannot translate
words that did not exist when the code was written. Those have an English
sibling column each, and they are the only things anyone has to enter twice:

| Where | Fields | Filled in at |
|---|---|---|
| Site copy | site name, tagline, hero heading + body, footer blurb, address, check-in/out times, SEO title + description | **/admin/settings** → "English copy" card |
| A rest house | name, area/location line, description | **the listing editor** → "English version" card, in both `/admin` and `/owner` |

Everything else on a listing translates itself, because it is stored as an id
rather than as words: the emirate, the amenity chips and the occasion tags all
resolve through `label()` in `src/lib/constants.ts`, which carries both
languages for every entry.

Every English field is **optional**. Leave one blank and English readers see the
Arabic text for that field alone — `localized()` in `src/lib/i18n/config.ts`
falls back per field, not per record, so a listing with an English name but no
English description shows the English name and the Arabic description rather
than reverting wholesale. That is deliberate: a half-translated listing beats a
blank heading.

Search covers both languages at once, in the public grid and in `/admin`, so a
rest house is findable by either name no matter which language the visitor is
reading.

### How the theming actually works

Four hex values are stored in the database. On every request the root layout
writes them onto `<html>` as CSS custom properties, expanding them into the full
palette with `color-mix()`:

```
src/lib/theme.ts   →  --gold-500, --gold-600, --night-900, --sand-50, …
src/app/layout.tsx →  <html style={themeCssVars(settings)}>
src/app/globals.css→  @theme inline { --color-gold-500: var(--gold-500); … }
```

Because of `@theme inline`, a utility like `bg-gold-500` compiles to
`background-color: var(--gold-500)` rather than baking the hex in — which is what
lets a database value re-tint the entire site with no rebuild.

### Changing the default palette in code

Edit the `:root` block in `src/app/globals.css`. Those are the fallbacks used
before any settings row exists.

### Changing fonts

Edit the `next/font` imports at the top of `src/app/layout.tsx`. Any Google font
with `subsets: ['arabic']` works — e.g. swap `Tajawal` for `IBM_Plex_Sans_Arabic`:

```ts
import { IBM_Plex_Sans_Arabic } from "next/font/google";
const body = IBM_Plex_Sans_Arabic({
  subsets: ["arabic"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-tajawal",   // keep the variable name; globals.css reads it
});
```

### Adding an icon

Icons are inlined SVG paths in `src/components/ui/icon-paths.ts` (107 icons,
~12 KB gzipped — versus 407 KB for the full Material Symbols font). To add one,
append the name to the list in the generator and re-run it:

```bash
node -e "
const n='YOUR_ICON_NAME';
fetch('https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsrounded/'+n+'/default/24px.svg')
  .then(r=>r.text()).then(s=>console.log(JSON.stringify([...s.matchAll(/d=\"([^\"]+)\"/g)].map(m=>m[1]).join(' '))));
"
```
then paste the result into `ICON_PATHS`. Browse names at
[fonts.google.com/icons](https://fonts.google.com/icons) (style: Rounded).

---

## How the booking flow works

```
Detail page                  Booking form                Confirmation
──────────────               ─────────────               ────────────
pick dates in the   ──URL──▶  fill name, phone,  ──action──▶  request saved
calendar (blocked             notes                            ↓
days disabled)                                          WhatsApp deep link
                                                        with the reference
```

1. **Dates are picked on the detail page.** Blocked and booked days come from the
   server as `YYYY-MM-DD` strings and are unselectable. A range that would span a
   blocked night is rejected.
2. **The selection travels in the URL** (`?from=…&to=…&guests=…`), so the form
   page is deep-linkable and survives a refresh.
3. **The server action re-validates everything.** Nothing the browser sent about
   price or availability is trusted: the listing, its calendar and the total are
   all re-read and recomputed server-side (`src/app/actions/booking.ts`).
4. **The request is saved first**, and gets a reference like `RQ-2420`. The owner
   has a record even if the customer never sends the message.
5. **Then the WhatsApp link is built** on the confirmation page, so the prefilled
   Arabic message can quote the real reference and the stored totals:

```
السلام عليكم 👋
أرغب بحجز *استراحة الرمال الذهبية* — لهباب – دبي

📋 رقم الطلب: RQ-2420
📅 الوصول: ٢٨ يوليو ٢٠٢٦
📅 المغادرة: ٣٠ يوليو ٢٠٢٦
🌙 عدد الليالي: ٢
👥 عدد الضيوف: ٤٥
💰 الإجمالي التقديري: ٣٬٧٨٠ د.إ

👤 الاسم: خالد المنصوري
📱 الجوال: +971 50 214 8890
```

The message is pre-typed, **not sent** — the guest presses send. That's what
keeps this compliant and spam-free.

6. **A request is not a reservation.** Submitting the form does *not* block the
   calendar; otherwise anyone could take a listing offline by spamming the form.
   Dates are written as `BOOKED` only when the owner taps **تأكيد** in
   `/admin/requests`, and released again if they later cancel.

---

## Form protection

The two forms anyone on the internet can submit — the booking request and owner
registration — are protected out of the box, with **no keys and no third-party
account required**. Four layers, in `src/lib/security`:

| Layer | What it stops |
|---|---|
| **Honeypot** | A field positioned off-screen and out of the tab order. No person can fill it, so anything in it is a bot. |
| **Rate limit** | Per IP *and* per phone number. A booking gets 6 attempts per 15 minutes and 20 a day; registration gets 3 an hour. The login form is throttled too — always per email address, and additionally per IP wherever the reverse proxy supplies `x-forwarded-for`. |
| **Human check** | A signed, single-use, time-limited challenge carrying a proof of work. A script that POSTs straight at the server action never had one; a spam run pays the CPU on every attempt. |
| **Duplicate guard** | The same phone, listing and dates while a request is still `NEW` is one request, not three in the owner's inbox. |

What the guest sees is the familiar checkbox — except it ticks itself while they
type, because the proof is arithmetic the server verifies rather than a claim the
browser makes. The send button stays disabled until it passes.

**Honest limits.** This is not Google's risk scoring. It defeats scripted and
opportunistic abuse; it does not stop someone willing to drive a headless browser
and pay the CPU. If that day comes, two environment variables switch the same
widget slot to a real captcha with no code change:

```bash
CAPTCHA_PROVIDER="turnstile"   # or "recaptcha"
CAPTCHA_SITE_KEY="..."
CAPTCHA_SECRET_KEY="..."
```

Turnstile keys come from the Cloudflare dashboard, reCAPTCHA v2 keys from
`google.com/recaptcha/admin`. With a provider configured, a submission is
rejected if the provider cannot be reached — an operator who turns a captcha on
expects it to be load-bearing. With no provider configured nothing is called and
the built-in check applies. Set `HUMAN_CHECK_DIFFICULTY` (default 12, clamped
8–20) to make the built-in proof of work cost more; every +1 doubles both the
spammer's cost and the guest's wait.

The rate-limit counters live in process memory, not in a table — one Next.js
process behind nginx sees every request, so a Map is exactly as accurate and
costs no migration. A restart forgets them, which for spam control is a
non-event. If the app is ever scaled to a second container, swap the Map for
Redis behind `consume()` and nothing else changes.

---

## Running with Docker

The containerized stack is **app + PostgreSQL**, and the app container holds **no
state at all** — uploaded photos go into the database (`STORAGE_DRIVER=db`), so
there is no uploads volume to mount and nothing is lost on redeploy. The only
volume in the whole stack is Postgres's own data directory.

```bash
cp .env.docker.example .env
# edit .env — POSTGRES_PASSWORD, AUTH_SECRET and ADMIN_PASSWORD are required
#   AUTH_SECRET:  openssl rand -base64 32

docker compose up -d --build
```

Open **http://localhost:3000**. `RUN_SEED=true` in `.env.docker.example` loads the
8 sample استراحات on first boot; seeding is skipped automatically once listings
exist, so it is safe to leave on.

```bash
docker compose logs -f app     # app logs
docker compose logs migrate    # what the schema/seed job did
docker compose ps              # health status
docker compose down            # stop; database survives
docker compose down -v         # ⚠️ stop and DELETE the database
```

> Pass `--build` whenever you change code. A plain `docker compose up -d` reuses
> the previously built image and will silently keep running your old code.

### How the stack fits together

```
┌──────────┐   healthy    ┌───────────┐  completed   ┌─────────┐
│    db    │ ───────────▶ │  migrate  │ ───────────▶ │   app   │
│ postgres │              │ one-shot  │              │  next   │
└──────────┘              └───────────┘              └─────────┘
     │                    push schema,                    │
  db-data                 seed if empty              (no volumes)
   volume                    exits 0
```

| Service | Purpose |
|---|---|
| `db` | PostgreSQL 16. Its `pg_isready` healthcheck gates everything else |
| `migrate` | Runs once per `up`: applies the schema, seeds if the DB is empty, exits |
| `app` | The Next.js server. Starts only after `migrate` completes successfully |

**Why migration is a separate one-shot service** rather than part of the app's
startup:

- **The runtime image stays minimal.** The Prisma *CLI* pulls in
  `@prisma/config` → `effect` → … which Next's standalone tracer has no reason to
  include, so shipping it would mean hand-copying a transitive dependency tree
  whose layout shifts between lockfile versions. The runtime needs only the
  generated *client*.
- **Migrations must run exactly once.** If every app replica applied the schema on
  boot, scaling to two replicas would have them racing each other.

### Image details

- **Base:** `node:22-bookworm-slim`, `output: "standalone"`, runs as the
  unprivileged `node` user
- **Healthcheck:** hits `/api/health`, which verifies the process *and* that it can
  query Postgres — so a container that answers HTTP but cannot reach the database
  is correctly reported unhealthy and never replaces a working deploy
- **No database at build time.** Nothing is contacted during `docker build`, and
  build-time database reads degrade gracefully. Coupling an image build to a live
  database would make builds non-reproducible

### Behind a reverse proxy with a real domain

```bash
# .env
NEXTAUTH_URL=https://yourdomain.ae
NEXT_PUBLIC_SITE_URL=https://yourdomain.ae
APP_PORT=3000
```

Then point Nginx at `127.0.0.1:3000` and run certbot — the config in
[Deploying](#deploying) applies unchanged.

### Applying the schema by hand

The standalone image deliberately ships no Prisma CLI, so use the `migrate`
service for any schema work:

```bash
docker compose run --rm migrate                                  # schema (+ seed)
docker compose run --rm --entrypoint npx migrate prisma studio    # browse data
```

### Windows note

Shell scripts must reach the container with **LF** line endings. `.gitattributes`
enforces that on checkout and the Dockerfile strips carriage returns anyway. A
CRLF script fails at exec with the famously unhelpful `no such file or directory`:
the kernel reads the shebang as `/bin/sh` followed by a CR and hunts for a binary
of that literal name.

---

## Image storage (including images in the database)

Every upload goes through one interface (`StorageAdapter` in
`src/lib/storage/types.ts`), so switching providers changes one environment
variable and nothing that *calls* it.

| `STORAGE_DRIVER` | Where the bytes live | Status |
|---|---|---|
| `db` | `StoredImage` table in PostgreSQL | ✅ **default in Docker** |
| `local` | `public/uploads/` on disk | ✅ default outside Docker |
| `cloudinary` | Cloudinary | adapter written — see below |
| `s3` | S3 / R2 / Spaces / MinIO | adapter written — see below |

### The stand-in photo

`public/default-photo.webp` is what renders wherever a real photograph is
missing — a listing whose owner has not uploaded one yet, and the home page
banner when no hero image has been set in **/admin/settings**. It is resolved at
render time (`DEFAULT_PHOTO_URL` in `src/lib/constants.ts`, applied by `toView()`
in `src/lib/listings.ts`), never written into the database, so the moment an
owner uploads a real photo it disappears with no orphan row behind it. Swap the
picture by replacing the file; nothing else needs changing.

Keep the replacement around 1600–1920px wide and a few hundred KB. It is the
source the image optimiser decodes and re-encodes for every card size on a cold
cache, and a multi-megabyte original costs seconds of CPU on a small VPS for a
picture nobody chose.

### `db` — images in the database

Bytes go into the `StoredImage` table and are served back by `/api/images/[id]`.

**What it buys you**

- **A completely stateless container.** No volume to mount, no bind path to get
  wrong, no photos lost when the container is replaced or scaled.
- **One backup covers everything.** `pg_dump` captures the site *and* its images —
  restore it anywhere and the galleries come back with it. With disk storage you
  have to back up two things and keep them in sync.
- **Deletes cannot orphan files.** Removing a listing removes its bytes in the
  same database, in the same place.

**The trade-off, stated plainly:** every image is a database read rather than a
static file served by the OS. Three things keep that from mattering:

1. `Cache-Control: public, max-age=31536000, immutable` — a row's bytes never
   change (replacing a photo creates a *new* row with a new id), so the URL is
   effectively content-addressed.
2. An `ETag` per id, checked **before** the blob is read — a returning visitor gets
   a `304` without Postgres touching the image at all.
3. `next/image` caches the resized variants it derives, so the database is read
   once per size rather than once per page view.

At a few hundred photos this is a non-issue. If you reach thousands of images with
heavy traffic, switch to `s3` or `cloudinary` — no other code changes.

Uploads are capped at **8 MB** and restricted to JPEG/PNG/WebP/AVIF
(`src/lib/storage/types.ts`).

### `local` — files on disk

Writes to `public/uploads/`, served statically. Zero config, works offline, fine
for a single VPS.

> ⚠️ On an ephemeral filesystem (Vercel, a fresh container per deploy) local
> uploads are **lost on redeploy**. Use `db`, mount `public/uploads` as a
> persistent volume, or switch to Cloudinary/S3.

### `cloudinary` / `s3`

Both adapters are written and ready:

```bash
# Cloudinary
npm install cloudinary
mv src/lib/storage/cloudinary.ts.example src/lib/storage/cloudinary.ts

# or S3 / R2 / Spaces / MinIO
npm install @aws-sdk/client-s3
mv src/lib/storage/s3.ts.example src/lib/storage/s3.ts
```

Then in `src/lib/storage/index.ts` replace the matching `case`'s `throw` with:

```ts
case "cloudinary":
  return new CloudinaryStorageAdapter();
```

Set `STORAGE_DRIVER` and the credentials in `.env`, add the CDN hostname to
`images.remotePatterns` in `next.config.ts`, and restart.

### Mixing drivers is safe

Photos uploaded under one driver keep working after you switch. Deletion routes on
the URL's *shape* rather than on whichever driver is configured now
(`deleteStoredAsset` in `src/lib/storage/index.ts`), so a gallery containing local
files, database blobs and remote seed URLs is cleaned up correctly in one pass.
Dispatching on the current driver instead would try to delete a file path from the
database, silently fail, and leak the file forever.

---

## Database and migrations

PostgreSQL is the only supported provider — local development, the test suite
and production all run it.

```bash
npm run db:up        # start PostgreSQL on 127.0.0.1:55433 (docker-compose.dev.yml)
npx prisma migrate deploy
npm run db:seed      # optional: admin account + 8 sample استراحات
npm run dev
```

`DATABASE_URL` for that server:

```
DATABASE_URL="postgresql://chalets:chalets@127.0.0.1:55433/desert_chalets?schema=public"
```

### Changing the schema

```bash
npx prisma migrate dev --name what_changed
```

Commit the generated folder under `prisma/migrations/`. Deployment applies it
with `prisma migrate deploy`, and nothing else.

### Why there is no SQLite option any more

The project used to default to SQLite locally and switch to PostgreSQL inside
the Docker build. That produced SQLite-flavoured migrations — `PRAGMA`
statements, table-rebuild blocks — which could never replay against production.
`docker/migrate.sh` therefore fell back to `prisma db push`, and that is where
the real damage was:

**`db push` syncs the schema and ignores migration SQL entirely.** It diffs
`schema.prisma` against the live database and emits DDL. Any `UPDATE` in a
migration — a backfill for a new column, a value remap — is silently skipped,
and the deploy still prints *"🚀 Your database is now in sync with your Prisma
schema"* and exits 0.

That shipped a release to production whose city-id remap never ran, leaving rows
pointing at ids the application no longer recognised. The schema was right, the
data was wrong, and the log said everything was fine.

So: one provider, real migrations, and `docker/migrate.sh` has no fallback. A
failed migration exits non-zero, and because `app` declares
`depends_on: migrate: condition: service_completed_successfully`, the
application does not start. Being down beats serving traffic against a
half-migrated database.

### Baselining a database that predates migrations

A database previously set up with `db push` has the tables but no migration
history, so `migrate deploy` will try to create tables that already exist.
Record the baseline once:

```bash
npx prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma   # must report no difference

npx prisma migrate resolve --applied 20260802082543_init_postgres
npx prisma migrate status                      # up to date
```

If the diff *does* report differences, the live schema has drifted from
`schema.prisma`; resolve that before marking anything applied, or the drift is
baked in permanently.

### Schema constraints worth keeping

Originally SQLite compatibility measures, retained on their own merits:

- **No native `enum`** — status fields are `String`, validated in
  `src/lib/constants.ts`. Adding a value is a code change, not a table lock.
- **No scalar lists** — amenity and category ids are JSON text, parsed by
  `src/lib/json-list.ts`. See `findListings` for what that costs.
- **No `DateTime` for calendar days** — availability uses `YYYY-MM-DD` strings,
  so a booked day cannot shift across a UTC boundary.

---

## Enabling online deposit payments

Currently **disabled by design**. No money moves through the site: the owner
collects the deposit directly after confirming.

The seam is already in place, so adding a gateway does not mean reshaping the
booking flow:

- `BookingRequest` already has `depositDue`, `paymentStatus` and
  `paymentReference` columns
- the confirmation page already branches on `isDepositPaymentEnabled()`
- `/admin/settings` already has the toggle

To enable (Stripe example — a local UAE gateway like PayTabs, Telr, Network
International or Ziina drops into the same two functions):

1. `npm install stripe`
2. Set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
   `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
3. Implement `createDepositCheckout()` in `src/lib/payments/index.ts` — the full
   worked example is in the file's header comment
4. Add `src/app/api/payments/webhook/route.ts` to verify the signature and, on
   success, set `paymentStatus = "PAID"` and confirm the booking
5. Turn on **تفعيل دفع العربون إلكترونيًا** in `/admin/settings`

The toggle requires *both* the owner's opt-in and server credentials, so flipping
it without configuring a gateway can't strand a guest on a dead checkout button.

---

## Deploying

> 📘 For the Docker path end to end on a Contabo VPS — server setup, `.env`,
> nginx, GoDaddy DNS and HTTPS — see **[DEPLOYMENT.md](DEPLOYMENT.md)**.
> Note it proxies to `127.0.0.1:3010`, the compose default, not the `3000` used
> in the bare-metal walkthrough below.

### Self-hosted VPS with a custom domain (recommended)

Works on any Ubuntu/Debian box. Nothing here is platform-specific.

```bash
# --- on the server ---
sudo apt update && sudo apt install -y nodejs npm nginx certbot python3-certbot-nginx
sudo npm install -g pm2

git clone <your-repo> /var/www/chalets && cd /var/www/chalets
npm ci
cp .env.example .env && nano .env     # set real values (see below)

npx prisma migrate deploy             # NOT `migrate dev` in production
npm run db:seed                       # first deploy only
npm run build

pm2 start npm --name chalets -- start
pm2 save && pm2 startup
```

Production `.env` essentials:

```
DATABASE_URL="postgresql://…"          # PostgreSQL only — see "Database and migrations"
AUTH_SECRET="<openssl rand -base64 32>"
NEXTAUTH_URL="https://yourdomain.ae"
NEXT_PUBLIC_SITE_URL="https://yourdomain.ae"
ADMIN_EMAIL="you@yourdomain.ae"
ADMIN_PASSWORD="<a strong password>"
```

**Nginx** (`/etc/nginx/sites-available/chalets`):

```nginx
server {
    server_name yourdomain.ae www.yourdomain.ae;

    client_max_body_size 200m;  # must match serverActions.bodySizeLimit (200mb)

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/chalets /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d yourdomain.ae -d www.yourdomain.ae   # free HTTPS
```

**DNS:** point an `A` record for `@` and `www` at your server's IP.

Updating later:

```bash
cd /var/www/chalets && git pull
npm ci && npx prisma migrate deploy && npm run build
pm2 restart chalets
```

### Docker

See [Running with Docker](#running-with-docker) — `docker compose up -d --build`
brings up the app plus PostgreSQL, with photos stored in the database so the app
container carries no state.

### Vercel

Works, with two caveats:

1. **Use Postgres**, not SQLite — the filesystem is read-only
2. **Set `STORAGE_DRIVER="cloudinary"` or `"s3"`** — local uploads would be lost
   on every deploy

Add every variable from the table above in the Vercel dashboard, then run
`npx prisma migrate deploy` and the seed once against your production database.

### Post-deploy checklist

- [ ] Log in at `/admin` and change the seeded password
- [ ] Set the real WhatsApp number in `/admin/settings` — it drives every
      WhatsApp button on the site
- [ ] Replace the seeded Unsplash photos with the owner's real ones
- [ ] Set the real map coordinates
- [ ] Submit `https://yourdomain.ae/sitemap.xml` to Google Search Console
- [ ] Share a listing link into WhatsApp to check the OG card renders
- [ ] Back up the database on a schedule — with `STORAGE_DRIVER=db` a single
      `pg_dump` covers the site *and* every uploaded photo

---

## Everyday tasks

```bash
npm run dev          # dev server, hot reload
npm run build        # production build
npm run start        # serve the production build
npm run typecheck    # tsc --noEmit
npm run verify       # 70-check smoke test
npm run db:studio    # browse/edit the database in a GUI
npm run db:migrate   # create + apply a migration after a schema change
npm run db:seed      # (re)seed — safe to re-run, won't duplicate
npm run db:reset     # ⚠️ wipe and rebuild the database from scratch
```

**Rotating the admin password:** change `ADMIN_PASSWORD` in `.env`, then
`npm run db:seed`.

**Re-seeding:** matches sample listings by slug and updates them rather than
duplicating. Listings you created yourself in the dashboard are untouched, and
your `/admin/settings` values are preserved.

---

## Design decisions worth knowing

Things a future maintainer would otherwise have to rediscover.

**Calendar days are strings, never timestamps.** `Availability.date` is
`YYYY-MM-DD`. `new Date(2026, 6, 25)` is *local* midnight, which serialises to the
previous day in any timezone west of UTC — so a day the owner blocked would read
as available to some visitors. A date-only string has no offset to get wrong. All
arithmetic goes through `src/lib/dates.ts`, which builds Dates at UTC midnight.
"Today" flips at Gulf midnight (UTC+4), since the audience is local.

**Responsive layout is CSS, not state.** The design prototype toggled between
mobile and desktop with an `isMobile` variable. Here every one of those branches
is a Tailwind breakpoint (`md:`, `lg:`, `hidden lg:block`), so the real viewport
decides. Carrying `device` into React state would have shipped a site that
ignores the visitor's actual screen.

**There is no pagination — on purpose.** Amenity filtering happens in JS, because
amenities are JSON text for SQLite↔Postgres portability, and neither `contains`
nor `LIKE` is a correct set-containment test. Adding SQL `take`/`skip` while
amenities are filtered afterwards would silently return short or empty pages. If
the catalogue outgrows this, three changes must land together: move amenities to a
join table, express the filter as `amenities: { every: … }`, *then* paginate. The
constraint is commented at `findListings` in `src/lib/listings.ts`.

**Favourites are localStorage, and read in an effect.** The design promises
«تُحفظ على جهازك ولا تحتاج حسابًا». Reading storage during render would make the
server HTML disagree with the first client render and blow up hydration on the
header's count badge, so there is a `ready` flag that hides counts until the real
value is known.

**Two different map technologies.** Interactive listing maps use **Leaflet** with
CARTO tiles — no API key, no billing account, which matters for self-hosting. The
footer and settings maps are keyless **Google Maps** embeds, because the business
location was specified as Google Maps. Leaflet is loaded through
`next/dynamic({ ssr: false })` (it touches `window` at import time) from
`src/components/listing/map-embed.tsx`.

**Icons are inlined SVG.** 107 hand-picked glyphs (~12 KB gzipped) instead of the
407 KB Material Symbols font — no extra request, no flash of invisible icons, no
runtime dependency on Google's CDN.

**Arabic numerals are display-only.** `arNum()` and friends render ١٬٨٠٠, but
their output must never feed arithmetic, a `value` attribute or a query string.
Number inputs and phone fields intentionally stay on Latin digits so keyboards,
validation and `parseInt` all behave.

**The OG image route pre-reverses Arabic words.** Satori (behind `next/og`) shapes
Arabic glyphs correctly but does not implement the Unicode bidi algorithm — it
lays word runs out left-to-right regardless of `direction: rtl`. The `rtl()` helper
in `src/app/api/og/route.tsx` reverses tokens to cancel that out. This applies
*only* inside the generated image; HTML pages use the browser's bidi engine and
must never be pre-reversed. That route also runs on the Node runtime, not edge,
because Prisma can't run on edge without Accelerate.

**Images can live in the database, and that is the Docker default.** It buys a
genuinely stateless container — no uploads volume, nothing lost on redeploy, and
one `pg_dump` that captures the site together with its photos. The cost is that
an image is a database read rather than an OS-served file, which is paid down by
immutable cache headers, an ETag checked *before* the blob is loaded, and
`next/image` caching each derived size. Swap `STORAGE_DRIVER` to `s3` if the
catalogue ever reaches thousands of photos.

**Asset deletion dispatches on the URL's shape, not the current driver.** A
site's history can span drivers: photos uploaded while `STORAGE_DRIVER=local`
keep their `/uploads/…` URLs after a switch to `db`. Routing deletes by the
current driver would try to delete a file path from the database, silently fail,
and leak the file forever.

**Migrations run in a one-shot container, not on app startup.** Two reasons: the
runtime image can then omit the Prisma CLI (which drags in `@prisma/config` →
`effect` → …, none of which Next's standalone tracer includes), and the schema is
applied exactly once — app replicas would otherwise race each other on boot.

**The home page renders per request; listing pages stay static.** A container
image is built without a database, so a prerendered home page would bake in zero
counts and an empty featured row. The pages that carry SEO traffic — listing
details — remain statically generated with on-demand revalidation from the admin
actions.

**Authorisation is layered.** `middleware.ts` cheaply checks for a session cookie
at the edge; `src/app/admin/layout.tsx` validates the session properly; and every
mutating server action calls `requireAdmin()`. Server actions are reachable by id
regardless of middleware, so the last layer is the one that actually protects the
data.

**Login is email + password, not the prototype's phone + OTP.** WhatsApp OTP needs
a Business API account and template approval. The split-screen layout and field
styling from the design are kept; the panel's feature list was reworded so it
doesn't promise a flow that isn't there.

---

## Troubleshooting

**`EPERM: operation not permitted, rename … query_engine-windows.dll.node`**
A running dev/prod server is holding the Prisma engine. Stop it and rebuild
(`taskkill /F /IM node.exe` on Windows).

**Admin login bounces straight back to `/login`**
`AUTH_SECRET` is missing or changed. Set it in `.env` and restart. Changing it
invalidates existing sessions.

**Arabic renders as boxes in a shared link preview**
The OG route couldn't fetch its font from Google. Check outbound network access
from the server; it degrades to a Latin-only card rather than failing.

**Uploaded images vanished after deploying**
`STORAGE_DRIVER=local` on an ephemeral filesystem. Mount `public/uploads` as a
volume, or switch to Cloudinary/S3.

**A day the owner blocked still shows as available**
Listing pages are statically generated. The availability actions call
`revalidatePath`, but if you wrote to the database directly, either wait for the
hourly `revalidate` or restart.

**Docker: `exec /usr/local/bin/entrypoint.sh: no such file or directory`**
The script has CRLF line endings — the kernel is looking for a binary literally
named `/bin/sh<CR>`. `.gitattributes` prevents it on checkout and the Dockerfile
strips CRs; if you edited the file with a Windows editor that forced CRLF,
convert it back to LF and rebuild.

**Docker: my code change had no effect**
`docker compose up -d` reuses the existing image. Rebuild with
`docker compose up -d --build`.

**Docker: `Cannot find module 'effect'` (or similar) from the Prisma CLI**
Something is invoking the Prisma CLI inside the *runtime* image, which ships only
the generated client. Run schema commands through the migrate service instead:
`docker compose run --rm migrate`.

**Images 404 after switching `STORAGE_DRIVER`**
Existing rows keep the URL they were saved with. `/api/images/…` needs
`STORAGE_DRIVER=db`'s table present (it always is — the model is in the schema),
and `/uploads/…` needs the files still on disk. Nothing rewrites old URLs; both
forms keep working side by side.

**`Unknown STORAGE_DRIVER "cloudinary"`**
The adapter is selected but not installed. See
[Image storage](#image-storage-including-images-in-the-database) — this throws deliberately
rather than silently falling back to local disk and losing photos on redeploy.

---

## Licence

Private commercial project. All rights reserved.
