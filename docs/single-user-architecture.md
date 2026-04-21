# Single-User Architecture Assessment

## Scope

This note separates two runtime targets:

1. Self-hosted / collaborative server
2. Single-user local installation on one machine

It evaluates what the current codebase actually requires from PostgreSQL and
what that means for a future desktop/local-install mode.

## Current Reality

`transact-qda` is not using a portable storage abstraction today.

The server code is directly coupled to PostgreSQL in three layers:

- migrations
- runtime query layer
- AI/document retrieval features

This is visible in:

- `src/lib/server/db/index.ts`
- `src/lib/server/auth/index.ts`
- `src/lib/server/documents/embedding-queries.ts`
- `src/lib/server/ai/base/search-tools.ts`
- `src/lib/server/project-sync/index.ts`
- `migrations/*.sql`

## PostgreSQL-Specific Dependencies

### 1. Core SQL Dialect

The schema and queries rely on PostgreSQL-specific features:

- `UUID` with `gen_random_uuid()`
- `BIGSERIAL`
- `TIMESTAMPTZ`
- `ON CONFLICT`
- `ILIKE`
- `jsonb`
- `jsonb_set`
- `json_agg`
- `COPY TO/FROM STDOUT/STDIN`

These appear throughout the migrations and query layer, not just in one module.

### 2. Full-Text Search

The application uses PostgreSQL full-text search directly:

- `to_tsvector(...)`
- `to_tsquery(...)`
- `ts_headline(...)`
- GIN indexes on search vectors

This powers document and manual search in the AI/runtime layer and project UI.

### 3. Vector Search

The codebase uses `pgvector` as a real dependency, not an optional helper.

Relevant pieces:

- `migrations/019_embeddings.sql`
- `src/lib/server/documents/embed-elements.ts`
- `src/lib/server/documents/embedding-queries.ts`
- `src/lib/server/ai/coding-companion/retrieval.ts`

This covers:

- storage of 768-dim sentence embeddings
- HNSW index creation
- KNN similarity queries via `<=>`
- average-vector and cross-document similarity workflows

### 4. Session/Auth Persistence

Authentication is database-backed:

- users in `users`
- sessions in `sessions`
- password hashes with `argon2`

The login/session layer is simple, but it is directly tied to SQL persistence.

### 5. Project Directory Sync

The codebase already has an important second storage shape:

- PostgreSQL is the runtime query engine
- a project directory is exported/imported via PostgreSQL `COPY`

See `src/lib/server/project-sync/index.ts`.

This means there is already a practical separation between:

- runtime storage
- portable project representation

That is useful for a future local mode, but it does not remove the current
runtime dependency on PostgreSQL.

## What Must Stay PostgreSQL for Self-Hosting

For collaborative/server operation, PostgreSQL should remain canonical.

Reasons:

- concurrent multiuser access
- transactional integrity
- existing schema and query semantics
- existing search/indexing behavior
- existing vector retrieval behavior
- existing import/export/sync logic

For scenario 1, replacing PostgreSQL would create more risk than value.

## Why the Current Native Installer Is Wrong for End Users

For a normal local single-user install, the current runtime model is too
infrastructure-heavy:

- separate PostgreSQL service
- local port management
- service manager integration
- extension management (`pgvector`)
- host-specific security policy friction (e.g. SELinux)

This is acceptable for self-hosting admins. It is poor for regular end users.

## Realistic Options for Single-User Local Installation

### Option A: SQLite/libsql/DuckDB Desktop Backend

Pros:

- much simpler installation
- likely easier packaging as an app
- no separate DB service

Cons:

- not a drop-in replacement
- full-text search needs a redesign
- vector similarity needs a redesign
- many SQL queries and migrations need rewriting
- COPY-based project sync needs adaptation
- behavioral drift from server mode becomes likely

Assessment:

This is a real product fork in runtime behavior, even if kept in one codebase.
It is not a packaging task. It is a storage-engine migration.

### Option B: Generic Storage Abstraction

Pros:

- in theory one codebase, multiple backends

Cons:

- would be fragile for the collaborative server
- lowest-common-denominator pressure on data semantics
- high implementation and test burden
- easy to get subtle concurrency and query behavior wrong

Assessment:

This should not be the first move. It is the highest-risk architectural route.

### Option C: Embedded / App-Managed PostgreSQL

Pros:

- preserves current SQL, migrations, auth, search, vector retrieval
- keeps server semantics intact
- avoids rewriting large parts of the application
- lets local install hide PostgreSQL from the user

Cons:

- packaging work is non-trivial
- needs per-platform bundling strategy
- startup and upgrade path must be carefully managed

Assessment:

This is the lowest-risk route to a real single-user desktop/local product while
keeping the collaborative system technically coherent.

## Recommended Direction

### Short Version

- Scenario 1 self-hosting: stay on PostgreSQL
- Scenario 2 single-user local: do not build on user-managed system PostgreSQL
- Preferred scenario 2 direction: app-managed embedded PostgreSQL first

### Why

It preserves:

- current schema
- current migrations
- current search behavior
- current vector retrieval
- current auth/session logic
- current project import/export/sync semantics

It avoids:

- a major SQL rewrite
- two divergent query stacks
- weakening the multiuser/server path

## Practical Product Split

The right separation is not two unrelated products, but two runtime modes:

### Server Mode

- official self-hosting path
- PostgreSQL required
- admin-facing install/update/backup docs

### Local Mode

- desktop/single-user path
- PostgreSQL bundled and app-managed, not user-managed
- no manual DB admin
- no manual port juggling
- project data still exportable/importable

## Suggested Implementation Order

1. Stabilize scenario 1 documentation and installer as an admin/self-hosting path.
2. Make `pgvector` and search dependencies explicit in ops docs.
3. Define a local runtime envelope:
   - app-owned data directory
   - bundled PostgreSQL binaries or controlled local runtime
   - managed startup/shutdown
4. Introduce a small runtime mode layer:
   - `server`
   - `local`
5. Only after that decide whether a non-PostgreSQL backend is worth exploring.

## Recommendation in One Sentence

For single-user local installation, the technically safest next move is not a
new database backend, but packaging the existing PostgreSQL-based runtime so the
user no longer has to see or manage PostgreSQL at all.
