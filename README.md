# transact-qda

> A qualitative-data-analysis platform built on a **transactional
> ontology**: events are primary, elements are constituted by events.

[![License: AGPL v3 or later](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue.svg)](./LICENSE)
[![Commercial license available](https://img.shields.io/badge/commercial%20license-on%20request-green.svg)](./COMMERCIAL-LICENSE.md)
[![Status: beta](https://img.shields.io/badge/status-v0.7%20beta-orange.svg)](#status)

transact-qda rethinks coding, memoing, and situational analysis from the
ground up. Namings, participations, appearances and naming acts replace
the usual "code → segment → project" hierarchy. The designation gradient
**Cue → Characterization → Specification** (Dewey/Bentley) is bidirectional
and append-only. Maps (situational, social-worlds/arenas, positional) are
projections, not separate ontologies. AI assistants (Coach, Cowork,
Autonomous) are opt-in, transparent, and rollback-able.

For the theoretical background see the in-app manual (`?` in the top
bar). The `docs/sessions/` directory archives verbatim design
conversations through which the platform was developed.

---

## Status

**v0.7 — feature-complete beta.** The core ontology, maps, documents,
AI personas, and export pipelines work end-to-end. Rough edges remain
(some UI polish, a few known bugs tracked in the memory notes).
Breaking changes between point releases are possible until v1.0.

## Installation Paths

transact-qda is meant to be distributed in **two ways**, not one:

1. **PostgreSQL-backed installation for small working groups**
   This is the administrated path. It assumes a coding agent or an
   informatics person in-house who can manage PostgreSQL, updates,
   backups, and deployment details.
2. **Single-user installation on one PC**
   This should be handled through an installer, not through a manual
   admin workflow.

## PostgreSQL Path (Admin-Guided)

Prerequisites:
- **PostgreSQL 16+**
- **Node.js 20+** and **npm**
- **Git**

```bash
git clone https://github.com/joeriben/transact-qda.git
cd transact-qda
cp .env.example .env
# adjust DATABASE_URL and SESSION_SECRET in .env
npm install
./scripts/3_start_prod.sh
```

`./scripts/3_start_prod.sh` waits for PostgreSQL, runs migrations, and
bootstraps the initial `admin` account plus demo projects automatically if the
database is still empty.

Open <http://localhost:5174> in your browser.

On **first login**, use `admin` / `adminadmin`, then change the password at the
yellow banner immediately.

On **first AI request**, the embedding model `nomic-ai/nomic-embed-text-v1.5`
(~150 MB, Apache-2.0) is downloaded once into the local model cache. Later
starts are offline.

### Single-User Installer

For Linux and macOS workstations, the repository now contains first-pass native
installers:

```bash
sudo APP_PORT=5174 bash installer/install.sh
```

```bash
bash installer/install_macos.sh
```

These installers install PostgreSQL locally, deploy the app, run migrations,
and bootstrap the initial app data.
The important difference from the admin path is that PostgreSQL is treated as
an **app-managed local runtime**:

- dedicated local PostgreSQL cluster under the app state directory
- local-only bind on `127.0.0.1`
- no manual database creation
- service manager integration (`systemd` on Linux, `launchd` on macOS)
- launcher helper (`transact-qda-open` on Linux, `~/Applications/transact-qda-open.command` on macOS)
- updater helper (`sudo transact-qda-update` on Linux, `~/Applications/transact-qda-update.command` on macOS)

### Seeding a demo project

Seeding now happens automatically on the first empty start via
`scripts/bootstrap.js`.

If you explicitly want to re-run the demo seed against an existing database,
you can still use:

```bash
./scripts/5_db_seed.sh
```

This creates the `admin` account (if absent), an empty *Sample Project*, and
the *Clarke Abstract Maps (Demo)* project illustrating situational,
social-worlds, and positional maps.

### Updating installer-managed local installs

Linux:

```bash
sudo transact-qda-update
```

macOS:

```bash
bash ~/Applications/transact-qda/installer/update_macos.sh
```

### Other scripts

- `./scripts/1_stop_all.sh` — stop locally started dev/prod Node processes
- `./scripts/2_start_dev.sh` — run migrations, then start the dev server
- `./scripts/3_start_prod.sh` — build and start in production mode
- `./scripts/4_db_migrate.sh` — run pending migrations
- `./scripts/5_db_seed.sh` — seed the database with demo content
- `./scripts/6_db_backup.sh` — dump the database via `pg_dump`

### Parallel installation on the same host

To install a new version next to an existing instance, use a separate directory,
database, and port. Do not let two instances point at the same PostgreSQL
database while testing.

Example:

```bash
git clone https://github.com/joeriben/transact-qda.git transact-qda-next
cd transact-qda-next
cp .env.example .env
# set DATABASE_URL to a separate database, e.g. transact_qda_next
# optionally run on another port, e.g. PORT=5175
npm install
./scripts/4_db_migrate.sh
./scripts/3_start_prod.sh
```

### Linux installer

For Linux servers or workstations, a first-pass native installer is included:

```bash
sudo APP_PORT=5174 bash installer/install.sh
```

For the single-user installer, the most relevant variables are:

- `INSTALL_DIR=/opt/transact-qda`
- `STATE_DIR=/var/lib/transact-qda`
- `APP_USER=transact-qda`
- `DB_NAME=transact_qda`
- `DB_USER=tqda`
- `DB_PORT=15432`
- `DB_PASSWORD=...`
- `APP_HOST=127.0.0.1`
- `APP_PORT=5174`
- `BRANCH=main`
- `RUN_DEMO_SEED=yes`

### macOS installer

For macOS workstations, a first-pass user-level installer is included:

```bash
bash installer/install_macos.sh
```

It uses Homebrew plus `launchd`, and installs into user-owned paths by default:

- `INSTALL_DIR=~/Applications/transact-qda`
- `STATE_DIR=~/Library/Application Support/transact-qda`
- `DB_PORT=15432`
- `APP_PORT=5174`
- `BRANCH=main`
- `RUN_DEMO_SEED=yes`

Unlike the Linux installer, the macOS installer is meant to be run as the
normal user, not with `sudo`.

## Configuration

All runtime configuration lives in `.env` (gitignored). Copy `.env.example`
as a starting point.

| Variable                  | Meaning                                                     |
|---------------------------|-------------------------------------------------------------|
| `DATABASE_URL`            | PostgreSQL connection string                                |
| `SESSION_SECRET`          | Secret for session-cookie signing — **set this**            |
| `TQDA_BOOTSTRAP`          | `auto` (seed only on empty DB), `seed`, or `none`          |
| `TQDA_STATE_DIR`          | Advanced: external app state directory                      |
| `TQDA_BRAND_DIR`          | Advanced: external branding directory                       |
| `PUBLIC_BRAND_LOGO_URL`   | Operator logo in the header (optional)                      |
| `PUBLIC_BRAND_NAME`       | Short label shown next to the logo (optional)               |
| `PUBLIC_BRAND_LINK`       | URL the logo links to (optional)                            |
| `PUBLIC_IMPRESSUM_URL`    | Path to an HTML snippet for the Legal → Impressum dialog    |

Instance-specific assets (operator logo, Impressum HTML) go under:

- `static/brand/` for manual repo-based installations
- `${TQDA_BRAND_DIR}` for installer-managed local installations

See `static/brand/README.md`.

AI provider settings live in `ai-settings.json` (gitignored, configured through
the in-app Settings dialog). API keys are stored in `*.key` files
(one per provider), never in JSON.

## Hosting this as a public service

transact-qda is primarily designed for **local research workstations**.
If you plan to run it as a networked service for other people:

- Read [`SECURITY.md`](./SECURITY.md) carefully.
- Install PostgreSQL separately and back up both the database and local state
  files such as `.env`, `ai-settings.json`, `*.key`, `static/brand/`, and
  `uploads/`.
- Set a long random `SESSION_SECRET`, put the app behind HTTPS, and
  delete/rename the default `admin` account after creating your own.
- **The AGPL-3.0 requires that any modifications you run as a network
  service be made available as source code to the users of that
  service.** If that is incompatible with your intended use, see
  [`COMMERCIAL-LICENSE.md`](./COMMERCIAL-LICENSE.md).

## Documentation

- **In-app manual** — top-bar `?` button (rendered from `docs/manual.md`)
- **Session archive** — `docs/sessions/` contains verbatim design
  conversations; these are not polished documentation but preserve the
  reasoning behind every design decision.
- **Architecture notes** — distributed across `docs/`.

## Contributing

Bug reports, methodological critique, and pull requests are welcome.
Please read [`CONTRIBUTING.md`](./CONTRIBUTING.md) first — in particular
the section on the **inbound-Apache-2.0 / outbound-AGPL-or-commercial**
licensing arrangement and the DCO sign-off.

## License

- Source code: **GNU Affero General Public License, version 3 or later**
  ([`LICENSE`](./LICENSE)).
- A **commercial license** is available for parties that cannot comply
  with the AGPL's source-disclosure obligation
  ([`COMMERCIAL-LICENSE.md`](./COMMERCIAL-LICENSE.md)).
- Third-party attributions: [`NOTICE`](./NOTICE) and
  [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).
- Release notes: [`CHANGELOG.md`](./CHANGELOG.md).
- Community guidelines: [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).

## Credits

transact-qda was originally developed at the **UNESCO Chair in Digital
Culture and Arts Education** (<https://www.ucdcae.fau.de/>),
Friedrich-Alexander-Universität Erlangen-Nürnberg, by Prof. Dr. Benjamin
Jörissen and collaborators. The attribution credit in the in-app *About*
dialog is a required notice and must not be removed in redistributions.

## Contact

General, academic, licensing, and security inquiries:
**<benjamin.joerissen@fau.de>**
