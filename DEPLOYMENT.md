# Deploying to a Contabo VPS with a GoDaddy domain

Step-by-step guide for putting this app online at **https://tryrihla.com** on a
fresh Contabo VPS, with DNS managed at GoDaddy and free HTTPS from Let's Encrypt.

Everything runs in Docker: the app, PostgreSQL and a one-shot migration job.
nginx sits in front on the host, terminates TLS and proxies to the app on
`127.0.0.1:3010`.

```
Internet ──► nginx (:80/:443, host)  ──►  app container (127.0.0.1:3010 → :3000)
                                                    │
                                            db container (postgres:16)
```

Replace `<VPS_IP>` throughout with your server's IPv4 address (Contabo control
panel → *Your Services* → the VPS → **IP address**).

**Contents**

1. [Prerequisites](#1-prerequisites)
2. [Prepare the server](#2-prepare-the-server)
3. [Clone the repo and write `.env`](#3-clone-the-repo-and-write-env)
4. [First deploy](#4-first-deploy)
5. [nginx reverse proxy](#5-nginx-reverse-proxy)
6. [Point tryrihla.com at the VPS (GoDaddy)](#6-point-tryrihlacom-at-the-vps-godaddy)
7. [HTTPS with certbot](#7-https-with-certbot)
8. [Post-deploy checklist](#8-post-deploy-checklist)
9. [Updating the site later](#9-updating-the-site-later)
10. [Backup and restore](#10-backup-and-restore)
11. [Troubleshooting](#11-troubleshooting)
12. [Adding this to an existing VPS instead](#12-adding-this-to-an-existing-vps-instead)

---

## 1. Prerequisites

| Thing | Notes |
| --- | --- |
| Contabo VPS | **Cloud VPS 10** or larger. Ubuntu 22.04 or 24.04 LTS. 4 GB RAM is comfortable; on 2 GB add swap (see [Troubleshooting](#11-troubleshooting)). |
| Root SSH access | Contabo emails the root password after provisioning, or you attach an SSH key at order time. |
| The domain `tryrihla.com` | Registered at GoDaddy, still using **GoDaddy nameservers** (`ns__.domaincontrol.com`). If you moved the nameservers to Cloudflare or anywhere else, make the DNS records there instead — GoDaddy's DNS tab is then ignored. |

Log in:

```bash
ssh root@<VPS_IP>
```

Contabo forces a password change on the first login. Do that, then optionally add
your SSH key and disable password auth — that is standard server hygiene and not
covered here.

---

## 2. Prepare the server

```bash
# System packages
apt update && apt upgrade -y
apt install -y git nginx certbot python3-certbot-nginx dnsutils

# Docker Engine + Compose plugin (not preinstalled on Contabo images)
curl -fsSL https://get.docker.com | sh

# Sanity check — both must print a version
docker --version
docker compose version
```

### Firewall

Contabo images ship with `ufw` **inactive**. If you want it on, allow SSH
*before* enabling it or you will lock yourself out:

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

Port 3010 is deliberately **not** opened. The app binds to `127.0.0.1` only and
is reached exclusively through nginx.

---

## 3. Clone the repo and write `.env`

```bash
git clone https://github.com/shaqwieer/Rest-Houses.git /opt/Rest-Houses
cd /opt/Rest-Houses
cp .env.docker.example .env
chmod 600 .env
```

Generate two strong secrets and keep them somewhere safe:

```bash
openssl rand -base64 32   # → AUTH_SECRET
openssl rand -hex 32      # → POSTGRES_PASSWORD
```

> The two generators differ on purpose. `POSTGRES_PASSWORD` is interpolated into
> a connection URL (`postgresql://user:PASSWORD@db:5432/...`), and base64 output
> contains `/`, `+` and `=` — a `/` truncates the URL and the app fails to
> connect with an error that says nothing about the password. `-hex` is URL-safe.
> `AUTH_SECRET` is passed as a plain env var, so any characters are fine.

Now edit the file **on the server** — `nano .env`. Editing it here rather than
pasting a pre-written file over SSH avoids mangling the Arabic values.

```bash
# --- PostgreSQL ---
POSTGRES_DB=desert_chalets
POSTGRES_USER=chalets
POSTGRES_PASSWORD=<paste the second openssl output>

# --- App ---
AUTH_SECRET=<paste the first openssl output>

# The real public URL, https, no trailing slash. Set this NOW — see the note below.
NEXTAUTH_URL=https://tryrihla.com
NEXT_PUBLIC_SITE_URL=https://tryrihla.com

APP_PORT=3010
APP_BIND_HOST=127.0.0.1

# --- Admin account (created by the first-run seed) ---
ADMIN_EMAIL=you@tryrihla.com
ADMIN_PASSWORD=<a strong password you will change after first login>
ADMIN_NAME=أبو سلطان

# --- First-run seed ---
RUN_SEED=true

# --- Branding (applied by that first seed only; edit later at /admin/settings) ---
SITE_NAME=استراحات الرمال
WHATSAPP_NUMBER=+971500000000
CONTACT_EMAIL=hello@tryrihla.com
```

> **Why `https://` before HTTPS exists.** These two URLs drive auth callbacks,
> canonical tags, sitemap URLs and Open Graph images. Between now and step 7 the
> site is only reachable over plain `http` and will look half-broken — logins may
> bounce, images may not load. **That is expected.** Do not "fix" it by switching
> to `http://`; you would ship with wrong callback URLs and a sitemap full of
> `http` links.

### About `RUN_SEED`

`RUN_SEED=true` is **required on the very first deploy**. The admin account is
created only by the seed, and the seed only runs when the listings table is
empty. A first deploy with `RUN_SEED=false` gives you a site nobody can log into.
The 8 sample استراحات come along with the admin user — there is no way to get one
without the other; delete them from `/admin` afterwards.

You set it back to `false` in step 8.

---

## 4. First deploy

```bash
cd /opt/Rest-Houses
docker compose up -d --build
```

The first build takes 3–8 minutes. Watch it:

```bash
docker compose logs -f app
```

Compose starts three things in order: `db` (waits until healthy) → `migrate`
(applies the schema, seeds, exits) → `app`.

Verify locally on the server before touching DNS:

```bash
curl -I http://127.0.0.1:3010          # expect: HTTP/1.1 200 OK
docker compose ps                       # app should be "healthy"
```

If `app` is unhealthy or restarting, check `docker compose logs migrate` first —
a schema failure blocks the app from starting at all.

---

## 5. nginx reverse proxy

First raise the body limit **globally**, in the `http { }` block of
`/etc/nginx/nginx.conf`:

```nginx
http {
    # ... existing directives ...
    client_max_body_size 200m;
    client_body_timeout  600s;
}
```

Putting it here as well as in the vhost is deliberate. Certbot rewrites the
vhost in step 7, and an `http`-level default survives whatever it does — it
removes the "did certbot drop it from the 443 block?" failure mode entirely.

`client_body_timeout` matters just as much as the size. It defaults to **60s**,
and 200 MB over a phone's upload link takes minutes — nginx would cut the
connection mid-transfer with a 408 long before the size limit ever came into
play.

Now create `/etc/nginx/sites-available/tryrihla.com`:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name tryrihla.com www.tryrihla.com;

    # MUST match serverActions.bodySizeLimit in next.config.ts (200mb).
    # nginx defaults to 1m, which would reject every phone photo with a 413
    # before the app ever sees the upload.
    client_max_body_size 200m;
    client_body_timeout  600s;

    location / {
        proxy_pass http://127.0.0.1:3010;
        proxy_http_version 1.1;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket / upgrade support
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";

        # A 200 MB upload needs minutes, not the 60s default — the send timeout
        # is the one that bites while the body is still streaming to the app.
        proxy_read_timeout    600s;
        proxy_send_timeout    600s;
        proxy_request_buffering on;
    }

    # Next.js static assets are content-hashed and immutable.
    location /_next/static/ {
        proxy_pass http://127.0.0.1:3010;
        proxy_cache_valid 200 1y;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }
}
```

Enable it and reload:

```bash
ln -s /etc/nginx/sites-available/tryrihla.com /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default     # optional: drop the "Welcome to nginx" page
nginx -t && systemctl reload nginx
```

`nginx -t` must say `syntax is ok` / `test is successful` before you reload.

---

## 6. Point tryrihla.com at the VPS (GoDaddy)

Sign in at [godaddy.com](https://godaddy.com) → **My Products** → next to
`tryrihla.com` click **DNS** / *Manage DNS*.

Set these two records. GoDaddy already ships a parked `A` record for `@` and a
`CNAME` for `www` — **edit those existing rows**, do not add second ones (GoDaddy
rejects duplicates with an unhelpful error).

| Type | Name | Value | TTL |
| --- | --- | --- | --- |
| `A` | `@` | `<VPS_IP>` | 600 seconds |
| `A` | `www` | `<VPS_IP>` | 600 seconds |

If `www` exists as a `CNAME` pointing at `@`, that is fine too — leave it. What
matters is that both names resolve to `<VPS_IP>`.

Then, on the same page:

- **Delete any `AAAA` record** unless your VPS actually serves on that IPv6
  address. A stale `AAAA` makes browsers and certbot prefer a dead address.
- **Turn off Domain Forwarding.** GoDaddy's *Forwarding* section (bottom of the
  DNS page, sometimes under *Domain Settings*) overrides your A record if a rule
  is left over from the parked page — and it breaks certbot's validation with a
  confusing error.

### Wait for propagation

TTL 600 means roughly 10 minutes, though a freshly-changed record is often live
in under a minute. Check from the server:

```bash
dig +short tryrihla.com @8.8.8.8
dig +short www.tryrihla.com @8.8.8.8
```

**Both must print `<VPS_IP>`.** Do not proceed until they do. Once they resolve,
`http://tryrihla.com` should already serve the site (unstyled auth/SEO quirks
aside — see the note in step 3).

---

## 7. HTTPS with certbot

```bash
certbot --nginx -d tryrihla.com -d www.tryrihla.com
```

Answer the prompts: enter an email for expiry notices, accept the terms, and
choose **redirect HTTP to HTTPS** when asked. Certbot rewrites your vhost in
place — adding the `listen 443 ssl` block, the certificate paths and a port-80
redirect — then reloads nginx.

Verify:

```bash
curl -I https://tryrihla.com           # expect HTTP/2 200
curl -I http://tryrihla.com            # expect 301 → https://
systemctl list-timers | grep certbot   # auto-renewal timer is installed by the package
```

> Let's Encrypt rate-limits **failed** validations to 5 per hostname per hour. If
> certbot fails, read the error and fix the cause (DNS not resolving, port 80
> blocked by `ufw`, GoDaddy forwarding still on) — do not re-run it in a loop.

Renewal is automatic via a systemd timer. Test it any time with
`certbot renew --dry-run`.

---

## 8. Post-deploy checklist

**Turn the seed off.** This is not optional housekeeping:

```bash
cd /opt/Rest-Houses
nano .env                # RUN_SEED=true  →  RUN_SEED=false
docker compose up -d     # picks up the change
```

Left at `true`, deleting the demo listings would resurrect all 8 of them on the
next `docker compose up`, because the guard is "seed if the listings table is
empty".

Then:

- [ ] Log in at `https://tryrihla.com/admin` with `ADMIN_EMAIL` / `ADMIN_PASSWORD`
- [ ] **Change the admin password** from the dashboard. Editing `ADMIN_PASSWORD`
      in `.env` after the first deploy has no effect — the seed never runs again.
- [ ] Set the site name, WhatsApp number and contact email at `/admin/settings`
      (the database is the source of truth from here on, not `.env`)
- [ ] Delete the 8 sample استراحات and add real ones
- [ ] **Prove the 200 MB body limit before clicking through `/admin`.** One
      command discriminates, run on the server:

      ```bash
      head -c 200000000 /dev/urandom > /tmp/big.bin
      curl -o /dev/null -w '%{http_code}\n' -X POST \
        --data-binary @/tmp/big.bin https://tryrihla.com/
      rm /tmp/big.bin
      ```

      A **404/405** means the whole body cleared nginx and reached Next — the
      limit is right. A **413** means it did not. (`curl -I` proves only that
      the site is up; it says nothing about upload size.)
- [ ] **Then upload a real photo through `/admin`** to confirm end to end.
- [ ] Check `https://tryrihla.com/sitemap.xml` shows `https://tryrihla.com/...`
      URLs (confirms `NEXT_PUBLIC_SITE_URL`), then submit it to Google Search Console
- [ ] Confirm `docker compose ps` shows `app` **healthy** and `restart:
      unless-stopped`, so the site comes back after a reboot

---

## 9. Updating the site later

```bash
cd /opt/Rest-Houses
git pull
docker compose up -d --build
```

That is the whole deploy. The `migrate` job re-runs and is idempotent; uploaded
photos live in Postgres (`STORAGE_DRIVER=db`), so the app container is stateless
and rebuilding it loses nothing.

Useful commands:

```bash
docker compose logs -f app        # tail app logs
docker compose logs migrate       # why the schema step failed
docker compose ps                 # container status + health
docker compose restart app        # restart without rebuilding
docker compose down               # stop everything (data survives)
docker image prune -f             # reclaim disk from old builds
```

`docker compose down -v` **deletes the database volume.** Never run it on
production unless you mean to wipe everything.

---

## 10. Backup and restore

Everything — listings, bookings, users, settings and uploaded photos — is in
Postgres. One dump is a complete backup.

```bash
cd /opt/Rest-Houses
docker compose exec -T db pg_dump -U chalets desert_chalets \
  | gzip > ~/backup-$(date +%F).sql.gz
```

Restore into an empty database:

```bash
gunzip -c ~/backup-2026-07-26.sql.gz \
  | docker compose exec -T db psql -U chalets -d desert_chalets
```

A nightly cron job is worth the two minutes:

```bash
crontab -e
# 0 3 * * * cd /opt/Rest-Houses && docker compose exec -T db pg_dump -U chalets desert_chalets | gzip > /root/backups/db-$(date +\%F).sql.gz
```

(`mkdir -p /root/backups` first, and copy them off the server periodically — a
backup that only exists on the machine it backs up is not a backup.)

Back up `/opt/Rest-Houses/.env` too, separately and privately. It holds
`AUTH_SECRET` and `POSTGRES_PASSWORD`, and a restored database is useless without
the matching Postgres password.

---

## 11. Troubleshooting

**`port is already allocated` on `docker compose up`**
Something else on the host is on 3010. Find it with `ss -tlnp | grep 3010`, then
set a different `APP_PORT` in `.env` and update `proxy_pass` in the nginx vhost
to match.

**The build is killed partway through / `up --build` fails with no clear error**
`next build` was OOM-killed. On a 2 GB VPS add swap:

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile
mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

Then rebuild.

**`migrate` fails with a Prisma connection or authentication error**
Check `POSTGRES_PASSWORD` for `/`, `+` or `=`. It is interpolated raw into the
`DATABASE_URL`, so those characters corrupt the connection string. Regenerate it
with `openssl rand -hex 32`. Changing it after the database volume exists also
means changing the role inside Postgres — easiest on a fresh install is
`docker compose down -v` (**wipes the database**) and starting over.

**502 Bad Gateway**
nginx is up but the app is not. `docker compose ps` and `docker compose logs app`.
Also confirm `proxy_pass` port matches `APP_PORT`.

**413 Request Entity Too Large when uploading photos**
`client_max_body_size 200m;` is missing. Check the `http { }` block of
`/etc/nginx/nginx.conf` first — that is the one that survives certbot's rewrite —
then the `443` server block. Re-add, then `nginx -t && systemctl reload nginx`.

**Large uploads die partway through with a 408, or the browser just hangs**
A size limit alone is not enough. `client_body_timeout` (nginx default 60s) and
`proxy_send_timeout` cut the connection while a 200 MB body is still streaming.
Both must be raised — see step 5.

**Logins bounce back to the sign-in page, or redirect to `localhost`**
`NEXTAUTH_URL` doesn't match the URL in the browser. It must be exactly
`https://tryrihla.com`, no trailing slash. Fix `.env`, then `docker compose up -d`.

**certbot: "Timeout during connect" / challenge failed**
DNS isn't pointing here yet (`dig +short tryrihla.com @8.8.8.8`), port 80 is
firewalled, or GoDaddy Domain Forwarding is still on. Fix the cause before
retrying — see the rate-limit note in step 7.

**Site can't log anyone in after a redeploy**
`AUTH_SECRET` changed. It signs session cookies; rotating it invalidates every
session. Read the value from `/opt/Rest-Houses/.env` rather than regenerating it.

**Changing `ADMIN_PASSWORD` in `.env` does nothing**
Correct — the seed only ever runs once. Reset the password from `/admin`.

---

## 12. Adding this to an existing VPS instead

If the box already runs other Dockerised sites behind the same nginx, the guide
above still applies with three changes:

1. **Pick a free host port.** `APP_PORT=3010` is the default and may already be
   taken. Check with `ss -tlnp | grep <port>`, pick something unused (e.g. 3011),
   and use that same port in `proxy_pass`.
2. **Skip step 2's installs** — Docker, nginx and certbot are already there. Do
   not re-run `get.docker.com` on a box with running containers.
3. **Add a new vhost file**, one per domain, in
   `/etc/nginx/sites-available/`. Do not edit another site's vhost. Run certbot
   with only this domain's `-d` flags so it touches only this vhost.

Everything else — `.env`, `RUN_SEED` on then off, the GoDaddy records, the
`client_max_body_size` line — is identical.

### If a PaaS (Dokploy, Coolify, CapRover) already owns ports 80/443

These ship their own reverse proxy — usually **Traefik** in a container — which
binds `0.0.0.0:80` and `:443`. nginx cannot start alongside it: `apt install
nginx` will appear to fail at the postinst step, which sends you debugging the
wrong problem. Two proxies cannot share a port; pick one.

To hand the ports to nginx, stop the PaaS proxy first. Dokploy runs under Docker
Swarm, so its services need `docker service rm`, not `docker stop`:

```bash
docker service rm dokploy dokploy-postgres
docker rm -f dokploy-traefik
docker swarm leave --force
```

Then **verify the ports are actually free before installing nginx** — including
the IPv6 binds, which are separate listeners:

```bash
ss -tlnp | grep -E ':(80|443)\s'      # must print nothing
```

Leave `/etc/dokploy` and the `dokploy` / `dokploy-postgres` Docker volumes on
disk. They cost nothing, and keeping them makes the change reversible if you
later decide you wanted the PaaS after all.
