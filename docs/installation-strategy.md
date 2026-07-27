# Installation Strategy

This project currently has an installation/documentation mismatch.

The existing `install.txt` and `installation.txt` ask end users to install:

- Docker
- Node.js
- Git
- bash

and then start the app through `./scripts/2_start_dev.sh`, which is a
developer-oriented helper that starts PostgreSQL in Docker and runs the app on
the host in Vite dev mode.

That is not a clean end-user installation story.

## Current reality

Right now there are effectively two paths in the repository:

1. Docker-backed local development
2. Host-side development against a Docker PostgreSQL instance

Neither one is the same as a simple end-user production install.

## Recommendation

The project should support exactly two documented modes, with a clear boundary:

1. Official end-user install
2. Developer setup

The end-user install must be the shortest, least surprising path. The developer
setup can stay more involved.

## Option A: Keep Docker as the official runtime

This is the lowest-maintenance option if the project wants a consistent
cross-platform install story now.

If this option is chosen:

- End-user docs should say only:
  - install Docker Desktop or Docker Engine
  - clone repo
  - copy `.env`
  - run `docker compose up -d`
- Node.js should disappear from the end-user guide
- `install.txt` and `installation.txt` should stop pointing users to
  `./scripts/2_start_dev.sh`
- host-side scripts should be documented as developer-only helpers

This is technically the most coherent option with the repository state that is
currently visible on this machine.

## Option B: Make host-native install the official runtime

This is viable only if the application really supports it end to end.

That means the project must provide all of the following:

- a real host-side production start command
- a real host-side stop/restart mechanism
- a documented PostgreSQL setup without Docker
- migration instructions against native PostgreSQL
- a clear location for persistent data
- startup instructions for Linux, macOS, and Windows/WSL
- an update path
- a rollback path

Without those pieces, a "native install guide" would be aspirational rather
than operational.

## Minimum requirements for a real native install guide

If the goal is to make open-source self-hosting user-friendly without Docker,
the guide should be structured like this:

### 1. Supported platforms

- Linux
- macOS
- Windows via WSL2, if truly supported

### 2. Prerequisites

- Node.js version
- PostgreSQL version
- any required system packages

### 3. Database setup

- create database
- create user
- enable required extensions
- set `DATABASE_URL`

### 4. App setup

- clone repo
- `cp .env.example .env`
- set `SESSION_SECRET`
- `npm install`
- `node scripts/migrate.js`
- `npm run build`
- `node build/index.js`

### 5. Service setup

- `systemd` unit on Linux
- optional launchd example on macOS
- clear note on Windows support boundaries

### 6. Data and backup

- what lives in PostgreSQL
- what lives in local files
- how to back up both

### 7. Update workflow

- stop service
- backup DB + local state
- pull/update
- install deps
- migrate
- restart
- smoke test

### 8. Rollback

- restore previous code
- restore previous DB dump
- restart old version

## Practical next step

Before rewriting the public install docs, the project needs one explicit
decision:

- Either Docker remains the official end-user runtime
- Or host-native install becomes a first-class supported runtime

Only after that choice should `install.txt`, `installation.txt`, and `README.md`
be rewritten.

## Immediate doc fix worth doing

Even before that strategic decision, the current docs should stop presenting
`./scripts/2_start_dev.sh` as a normal end-user installation command. It is a
developer convenience script, not a clean production/runtime entrypoint.
