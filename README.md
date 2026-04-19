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

## Quick start (official runtime)

For most users, the easiest setup is:

- **Docker Desktop** on macOS or Windows
- **Docker Engine** on Linux
- **Git**

If you do not know what **Homebrew** or **daemon** mean,
ignore the optional Colima note below and use Docker Desktop.

```bash
git clone https://github.com/joeriben/transact-qda.git
cd transact-qda
cp .env.example .env
# set SESSION_SECRET in .env to a long random value
docker compose pull
docker compose up -d
```

Open <http://localhost:5174> in your browser.

This Compose-based path is the supported runtime on macOS, Linux, and
Windows (Docker Desktop / Docker Engine). It runs the app and the
PostgreSQL/pgvector database together, applies migrations on startup,
and stores project data in Docker volumes. The app is shipped as a
prebuilt multi-arch container image from GHCR:
`ghcr.io/joeriben/transact-qda`.

The commands above are pasted into a terminal:

- macOS: **Terminal**
- Windows: **Windows Terminal** or **PowerShell**
- Linux: your normal terminal

On macOS you need a running Docker background service before
`docker compose` can work. Two supported options:

- **Docker Desktop**: the recommended path for most users. Install it,
  launch it once, accept the macOS permission dialogs, and enable
  **Start Docker Desktop when you sign in** in its settings. Then
  Docker starts automatically after a restart and transact-qda can be
  used again without extra setup.
- **Colima**: an advanced macOS alternative for users who explicitly do
  not want Docker Desktop. It runs Docker in the background without a
  separate desktop window. Install with `brew install docker colima`, then
  enable autostart once with `brew services start colima`.

If Docker Desktop autostart is disabled, or if Colima is not running
after a restart, transact-qda will not start until Docker is started
again.

If both Docker Desktop and Colima are installed, select the Colima
daemon explicitly once with `docker context use colima`.

For a controlled test rollout, pin a specific tested tag in `.env`:

```bash
echo "TQDA_IMAGE=ghcr.io/joeriben/transact-qda:<tag>" >> .env
```

On **first login**, use `admin` / `adminadmin`. A prominent yellow
banner will appear at the top prompting you to change the password;
please do so immediately. The banner goes away once you have.

On **first AI request**, the embedding model
`nomic-ai/nomic-embed-text-v1.5` (~150 MB, Apache-2.0) is downloaded
from the Hugging Face Hub into `.model-cache/`. A toast in the lower
right corner shows progress. Subsequent starts are fully offline.

### Seeding a demo project

```bash
./scripts/5_db_seed.sh
```

This creates the `admin` account (if absent), an empty *Sample Project*,
and the *Clarke Abstract Maps (Demo)* project illustrating situational,
social-worlds, and positional maps.

### Operations

- `docker compose up -d` — start app + database
- `docker compose down` — stop the stack (data stays in volumes)
- `docker compose pull` — fetch a newer published app image
- `docker compose logs -f` — view live logs
- `./scripts/4_db_migrate.sh` — run pending migrations
- `./scripts/6_db_backup.sh` — dump the database to `backups/`

### Development-only shell helpers

The Unix shell helpers under `scripts/` are developer conveniences
only. They are not the supported installation path and are not part of
the cross-platform runtime promise. The supported runtime remains
`docker compose up -d` against the published GHCR image.

For local image builds during development, use:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

## Configuration

All runtime configuration lives in `.env` (gitignored). Copy
`.env.example` as a starting point.

| Variable                  | Meaning                                                     |
|---------------------------|-------------------------------------------------------------|
| `SESSION_SECRET`          | Secret for session-cookie signing — **set this**            |
| `TQDA_IMAGE`              | Published app image tag to pull from GHCR                   |
| `TQDA_PORT`               | Host port exposed by the app container                      |
| `DATABASE_URL`            | PostgreSQL connection string (host-side development only)   |
| `PUBLIC_BRAND_LOGO_URL`   | Operator logo in the header (optional)                      |
| `PUBLIC_BRAND_NAME`       | Short label shown next to the logo (optional)               |
| `PUBLIC_BRAND_LINK`       | URL the logo links to (optional)                            |
| `PUBLIC_IMPRESSUM_URL`    | Path to an HTML snippet for the Legal → Impressum dialog    |

Instance-specific assets (operator logo, Impressum HTML) go under
`static/brand/` — see `static/brand/README.md`.

AI provider settings live in `ai-settings.json` (gitignored, configured
through the in-app Settings dialog). API keys are stored in `*.key`
files in the project root (one per provider), never in JSON.

## Hosting this as a public service

transact-qda is primarily designed for **local research workstations**.
If you plan to run it as a networked service for other people:

- Read [`SECURITY.md`](./SECURITY.md) carefully.
- The same Compose stack can be used as the runtime base on a server,
  but it still needs operator hardening: HTTPS, reverse proxying,
  secret management, backups, and regular updates.
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
- **Container release** — [`docs/ghcr-release.md`](./docs/ghcr-release.md)

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
