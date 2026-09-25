Medusa Docker stack
===================

Docker Compose stack for [Medusa](https://medusajs.com) (open source headless
commerce platform: Store and Admin APIs plus an admin dashboard), usable for
local development and for simple production deployments (a single server).
Maintained by [BillMySales](https://www.billmysales.com).

| Component   | Image                             | Default version     |
|-------------|-----------------------------------|---------------------|
| Web server  | `caddy:<ver>-alpine`              | 2.11                |
| Medusa      | own image (`image/`) on `node:<ver>-alpine` | 2.21.1 (Node 24 LTS) |
| Database    | `postgres:<ver>-alpine`           | 18                  |
| Redis       | `redis:<ver>-alpine`              | 8.6                 |
| Mailpit     | `axllent/mailpit` (optional, dev) | v1.31               |

Medusa is distributed as npm packages to build a project with, not as an
image: `image/project` is a minimal Medusa project (configuration from the
environment, an SMTP email provider, emails in Spanish and a setup script),
built by `image/Dockerfile` (`medusa build`, about 3 minutes; its base
images exist for amd64 and arm64, tested on arm64). It's not Medusa's
starter repository, which lags behind Medusa's releases. PostgreSQL 18
because Medusa's CI tests with the unpinned `postgres` image (the latest).

**There is no shop front for customers**: Medusa is headless, this stack
gives the admin and the APIs, and the public shop (catalog, cart, checkout
pages) is a separate app to build or deploy. See
[Storefronts](#storefronts).

Requirements
------------

- Docker Engine 24+ with the Compose v2 plugin (`docker compose`, 2.20+).
- About 1 GB of disk for the images; 1 GB of RAM for the stack.
- Development: ports 8111, 8411 and 8025 free on the host.
- Production: a server with ports 80 and 443 reachable, and a DNS record for
  the site's domain pointing to it.

Quick start (development)
-------------------------

```shell
cp .env.dev.example .env
docker compose up -d --build   # builds the image the first time (~3 minutes)
docker compose logs -f setup   # wait for "==> Done"
```

- Admin: http://localhost:8111/app (user `admin@example.com`, password
  `admin12345`).
- Store API: http://localhost:8111/store (header `x-publishable-api-key`: the
  key printed by `setup`, also in the admin under Settings > Publishable API
  Keys).
- Mailpit (every email Medusa sends): http://localhost:8025

Production
----------

```shell
cp .env.prod.example .env
# Fill in MEDUSA_URL, SITE_ADDRESS, DB_PASSWORD, MEDUSA_JWT_SECRET,
# MEDUSA_COOKIE_SECRET, MEDUSA_ADMIN_EMAIL, MEDUSA_ADMIN_PASSWORD and the
# SMTP_* values.
docker compose up -d --build
```

- With `SITE_ADDRESS` set to the domain, Caddy gets a Let's Encrypt certificate
  and renews it automatically (certificates live in the `caddy_data` volume).
- Behind another TLS-terminating proxy, use `SITE_ADDRESS=:80`.
- Compose refuses to start while a required value is missing.
- The `backup` profile is enabled by default in the production template.
- Behind an existing Traefik (no host ports), use `overrides/traefik.yaml`
  (see [Overrides](#overrides)).
- The image is built on the server (or build it elsewhere, push it to a
  registry and set `MEDUSA_IMAGE`).

Services
--------

| Service   | Profile   | Role                                                           |
|-----------|-----------|----------------------------------------------------------------|
| `db`      |           | PostgreSQL, data in the `db_data` volume.                      |
| `redis`   |           | Events, workflows, locks and cache.                            |
| `setup`   |           | One-shot job (`scripts/setup.sh`), runs on every `up`.         |
| `medusa`  |           | Medusa server: APIs, admin (`/app`), uploads (`/static`).      |
| `worker`  |           | Medusa worker: subscribers (emails), scheduled jobs, workflows. |
| `caddy`   |           | TLS and public address, the only published ports (80, 443).    |
| `backup`  | `backup`  | Database dump + uploads on a schedule.                         |
| `mailpit` | `mailpit` | Development SMTP server that catches all mail.                 |

`medusa` and `worker` run the same image in Medusa's `server` and `worker`
modes. The admin calls the API on its own address (`/`, since
`MEDUSA_BACKEND_URL` isn't set at build), so the image doesn't depend on the
site's URL: changing `MEDUSA_URL` only needs `up -d` (setting
`MEDUSA_BACKEND_URL` would need a rebuild for each change).

### What `setup` does

- `medusa db:migrate`: pending migrations of Medusa's modules, module links
  and search indexes, without prompts (see [Upgrades](#upgrades)).
- The admin user (`MEDUSA_ADMIN_EMAIL`, `MEDUSA_ADMIN_PASSWORD`), if missing.
- Once (then kept as edited in the admin): store name, currency
  (`MEDUSA_CURRENCY`, CLP), a region for the country (`MEDUSA_COUNTRY`,
  Chile) with its tax rate (`MEDUSA_TAX_RATE`, IVA 19%), prices including tax,
  a stock location with a free "Despacho" shipping option (so checkout
  works), the default sales channel and its publishable API key.
- Prints the publishable API keys.

Common commands
---------------

```shell
docker compose ps                        # status: every service "healthy", setup "Exited (0)"
docker compose logs -f medusa worker     # logs
docker compose exec db psql -U medusa medusa   # SQL shell
docker compose run --rm setup sh -c 'cd /app && npx medusa --help'   # Medusa CLI
docker compose down                      # stop, keep data
docker compose down -v                   # stop and DELETE all data
```

Emails
------

Medusa has no SMTP provider and sends no emails by itself (emails are sent by
subscribers of the project). This stack includes an SMTP notification
provider (`image/project/src/modules/smtp`, nodemailer) and subscribers with
Spanish texts (`image/project/src/subscribers`, layout in
`src/lib/email.ts`):

| Event                              | Email                                               |
|------------------------------------|-----------------------------------------------------|
| `invite.created`, `invite.resent`  | Admin invitation, with the link to `/app/invite`.   |
| `auth.password_reset` (admin user) | Link to `/app/reset-password`.                      |
| `auth.password_reset` (customer)   | Link to `MEDUSA_STOREFRONT_URL/reset-password` (only if set). |
| `order.placed`                     | Order confirmation: items and total (`$19.980`).    |

SMTP comes from `SMTP_*` (`SMTP_SECURE`: `tls` = STARTTLS required, `ssl` =
SMTPS, `none`); without `SMTP_HOST` no email is sent. The worker sends them.

Storefronts
-----------

Medusa is **headless**: it's the commerce backend (products, prices and
taxes, carts, checkout, orders, customers) with its admin and its APIs, but
it has no public shop pages. Unlike WooCommerce or PrestaShop, after
`docker compose up` there is no site where a customer browses the catalog
and buys:

- `MEDUSA_URL/app` is the admin (products, orders, customers, settings).
- `MEDUSA_URL/store/...` is the Store API (JSON) that a shop front uses.
- `MEDUSA_URL/` just redirects to the admin.

What that implies:

- The shop front is a separate application that you build or deploy (a web
  site, a mobile app, a kiosk...) and that calls the Store API: list
  products for a region, create a cart, add items, set the address and a
  shipping option, pay, complete the order. Medusa's
  [Next.js Starter Storefront](https://github.com/medusajs/nextjs-starter-medusa)
  is the usual starting point; it isn't part of this stack.
- The shop front identifies itself with the publishable API key (header
  `x-publishable-api-key`), printed by `setup` and listed in the admin
  (Settings > Publishable API Keys). It's public by design: it only selects
  the sales channel.
- A shop front running in the browser on another address needs that origin
  in `MEDUSA_STORE_CORS` (calls made from a server don't).
- Customers' password reset emails link to the shop front
  (`MEDUSA_STOREFRONT_URL/reset-password`), which must provide that page.
- Payments: Medusa ships a manual provider (bank transfer, cash on delivery;
  the one set up here) and Stripe. Other gateways need a payment provider
  module in `image/project`.
- Several shop fronts can share the same catalog, stock and orders (one
  sales channel and publishable key each).

Without a shop front, orders can still be created through the Store API
(that's how this stack was tested) or as draft orders in the admin.

Backups
-------

With the `backup` profile, the `backup` service writes `<timestamp>-db.dump`
(`pg_dump` custom format) and `<timestamp>-static.tar.gz` (uploads) to the
`backups` volume (or `./data/backups` with `overrides/local-dirs.yaml`) at
start and then every `BACKUP_INTERVAL_HOURS`, and deletes files older than
`BACKUP_KEEP_DAYS`. Files are readable by their owner only.

```shell
docker compose run --rm --no-deps backup now                  # back up now
docker compose run --rm --no-deps backup list                 # list timestamps
docker compose stop medusa worker                   # stop the app first
docker compose run --rm --no-deps backup restore <timestamp>  # database and uploads
docker compose exec redis redis-cli FLUSHALL        # cache and queues of the old data
docker compose up -d
```

`--no-deps` keeps the command from starting `setup` first (with damaged
data `setup` fails and the restore would never run); the database must
be running (`docker compose up -d db` if the stack is down).

A restore replaces the database with a fresh copy, so nothing created after
the backup remains.

Upgrades
--------

Back up first, then change `MEDUSA_VERSION` in `.env` and run
`docker compose up -d --build`: the image is rebuilt on the new version and
`setup` runs the migrations before Medusa starts (`--all-or-nothing`: if one
fails, the run's migrations are reverted).

Syncing module links and search indexes asks for confirmation upstream; here
safe actions run and unsafe ones (dropping tables or indexes of removed
links) are skipped. To apply them too, run once with
`MEDUSA_MIGRATE_UNSAFE=true docker compose up -d`.

Customizing the project
-----------------------

`image/project` is a regular Medusa project: plugins (`npm` packages in
`package.json` and `medusa-config.ts`), modules, subscribers, API routes and
admin extensions go there, then `docker compose up -d --build`. A BillMySales
integration would be a Medusa plugin (a subscriber of `order.placed` and
friends) added this way.

- `medusa build` fails on TypeScript errors, so the image build stops on
  them.
- `@swc/core` (a dev dependency) is required: it loads `medusa-config.ts`.
- npm 11 warns during the build about install scripts not in
  `allowScripts`: harmless.

Overrides
---------

Optional compose files in `overrides/`, enabled with `COMPOSE_FILE` in `.env`
(several are combined with `:`). Each file documents its variables.

```shell
COMPOSE_FILE=compose.yaml:overrides/traefik.yaml:overrides/local-dirs.yaml
```

| File                        | Purpose                                                            |
|-----------------------------|--------------------------------------------------------------------|
| `overrides/traefik.yaml`    | Publish through an existing Traefik on a shared external network:  |
|                             | no host ports, Traefik terminates TLS (`TRAEFIK_HOST`, ...).       |
| `overrides/local-dirs.yaml` | Database, Redis, uploads, Caddy and backups in local directories   |
|                             | (`DATA_DIR`, default `./data`) instead of named volumes.           |

A local `compose.override.yaml` (gitignored) is also loaded automatically by
Docker Compose, for changes specific to one machine.

Configuration
-------------

Every variable is documented in `.env.prod.example`. Main groups:

- **Site and network**: `MEDUSA_URL`, `SITE_ADDRESS`, `HTTP_BIND`,
  `HTTP_PORT`, `HTTPS_PORT`, `MEDUSA_STORE_CORS`, `MEDUSA_STOREFRONT_URL`.
- **Credentials**: `DB_PASSWORD`, `MEDUSA_JWT_SECRET`, `MEDUSA_COOKIE_SECRET`,
  `MEDUSA_ADMIN_EMAIL`, `MEDUSA_ADMIN_PASSWORD` (required).
- **Store** (first install only): `MEDUSA_STORE_NAME`, `MEDUSA_CURRENCY`,
  `MEDUSA_COUNTRY`, `MEDUSA_REGION_NAME`, `MEDUSA_TAX_*`,
  `MEDUSA_PRICES_INCLUDE_TAX`, `MEDUSA_STOCK_LOCATION`, `MEDUSA_CITY`.
- **Versions**: `MEDUSA_VERSION`, `NODE_VERSION`, `POSTGRES_VERSION`,
  `REDIS_VERSION`, `CADDY_VERSION`, ...
- **Mail**: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`,
  `SMTP_PASSWORD`, `SMTP_FROM`.
- **Resources and logs**: `*_MEMORY_LIMIT` per service, `UPLOAD_MAX_SIZE`,
  `LOG_MAX_SIZE`, `LOG_MAX_FILE`.

Notes:

- Medusa connects to any database host but `localhost` with SSL unless the URL
  says otherwise: the stack adds `sslmode=disable` (`DB_SSLMODE`) for its
  internal PostgreSQL.
- The admin's session cookie is `Secure` when `MEDUSA_URL` is `https://`
  (Medusa would otherwise always set it in production, and over plain HTTP the
  admin login would fail).
- Amounts are plain numbers in the currency (CLP `9990` = $9.990); with tax
  included prices, Medusa computes the IVA inside them.
- Medusa's telemetry is off (`MEDUSA_DISABLE_TELEMETRY`).
- The project's npm dependencies are resolved at build time (no lock file;
  `@medusajs/*` pinned to `MEDUSA_VERSION`).
- Some Medusa features are proprietary ("Enterprise Edition": RBAC roles and
  SSO) and stay off.
- From inside the containers, the host machine is reachable as
  `host.docker.internal`.

Security
--------

- No default secrets: compose fails if the required passwords and secrets are
  missing. The development template uses public values; never use it on a
  server.
- The Medusa containers run as the image's `node` user; only Caddy (and
  Mailpit in development) publishes ports; Medusa, PostgreSQL and Redis are
  internal. `HTTP_BIND` defaults to `127.0.0.1`.
- Not included: a web application firewall or off-site backup copies.

Validation
----------

What was checked for this stack (2026-09-24):

- Clean start (`down -v` + `up -d`, image built) in about 27 s: every service
  `healthy`, `setup` `Exited (0)`; a second run makes no changes (no
  duplicated regions, channels, keys or options).
- Admin (`/app`) and its assets, admin API with a token and with the session
  cookie (HTTP and HTTPS); a product in CLP; a full checkout through the Store
  API (cart, address, shipping, manual payment, order: 2 × $9.990 = $19.980
  with IVA included).
- Emails through SMTP to Mailpit: order confirmation, admin invitation,
  password reset (and the reset link changes the password).
- Store settings: CLP default, region Chile, IVA 19%, prices including tax,
  shipping option.
- Upgrade 2.18.0 → 2.21.1 with data (on PostgreSQL 17): migrations and link
  sync without prompts. (Before `--execute-safe-links`, the link sync waited
  for an answer forever.)
- Backup and restore (data created after the backup is gone, uploads back).
- HTTPS with `SITE_ADDRESS=localhost`; overrides: Traefik v3.6 routing with no
  host ports (admin session cookie `Secure`, upload URLs on https), local
  directories.
- Not tested: issuing a real Let's Encrypt certificate (needs a public
  domain), a storefront, SMTPS/STARTTLS with a real provider.

Testing
-------

- Admin password reset through the API: `POST
  /auth/user/emailpass/reset-password` with `{"identifier": "<email>"}`
  emails a token; then `POST /auth/user/emailpass/update` with the token as
  `Authorization: Bearer <token>` and `{"password": "..."}`.

Resource usage
--------------

Idle, after a few requests: Medusa server ~300 MiB, worker ~220 MiB,
PostgreSQL ~60 MiB, Redis ~10 MiB, Caddy ~11 MiB. Image ~650 MB.

License
-------

[MIT](LICENSE).
