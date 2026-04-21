# Docker-less Update Runbook

This runbook is intentionally conservative. The old Docker-based production
instance remains intact until the new docker-less instance has been restored,
migrated, started, and smoke-tested.

## 0. Scope

Current local findings for this repository:

- Production data currently comes from Docker PostgreSQL via `transact-qda-db`.
- Application state outside the database exists in `.env`, `ai-settings.json`,
  `*.key`, `static/brand/`, and likely `uploads/`.
- The current worktree is not clean, so production should not be updated in place.

## 1. Preflight

Run from the current stable production checkout:

```bash
cd /home/joerissen/ai/transact-qda
bash scripts/7_safe_update_prep.sh
```

Expected outputs under `backups/safe-update/<timestamp>/`:

- `manifest.txt`
- `app-state.tar.gz`
- `transact_qda.sql.gz`

Do not continue if the DB dump or state archive is missing.

## 2. Prepare parallel target

Create a separate deployment directory. Do not overwrite the current one.

```bash
cd /home/joerissen/ai
git clone <repo-url> transact-qda-next
cd transact-qda-next
git checkout <target-commit>
npm install
```

Restore only the required local state into the new directory:

- `.env`
- `ai-settings.json`
- `*.key`
- `static/brand/`
- `uploads/` if still used in the new version

## 3. Test restore into native Postgres

Provision a separate native PostgreSQL instance or database for testing. Use a
different port or database name than production.

Example:

```bash
createdb -h 127.0.0.1 -p 5433 -U <user> transact_qda_next_test
gunzip -c /path/to/transact_qda.sql.gz | psql -h 127.0.0.1 -p 5433 -U <user> -d transact_qda_next_test
```

Point `transact-qda-next/.env` to that test database.

## 4. Build and migrate the new version

```bash
cd /home/joerissen/ai/transact-qda-next
node scripts/migrate.js
npm run build
node build/index.js
```

Stop here if any migration fails. The rollback path is still just "stay on old production".

## 5. Smoke test

Minimum smoke test:

- Login works
- Existing projects open
- A write operation succeeds
- Settings page loads
- Branding and impressum still render
- AI provider configuration is present
- No DB errors in server log

## 6. Cutover

Only after the test restore and smoke test are green:

1. Announce maintenance window.
2. Stop the old production app.
3. Take one final fresh DB dump from Docker production.
4. Restore that final dump into the native production database.
5. Start the new docker-less app.
6. Run the same smoke test against the real production URL.

## 7. Rollback

If anything fails after cutover:

1. Stop the new app.
2. Start the old app again.
3. If the new DB has already been changed, restore the last fresh production dump.
4. Keep the old Docker DB and old app directory untouched until the new system has been stable for several days.
