# transact-qda container release via GHCR

## Goal

The official runtime artifact for `transact-qda` is a published Docker
image in GitHub Container Registry (GHCR), not a local source build on
every workstation.

Canonical image name:

`ghcr.io/joeriben/transact-qda`

The Compose runtime pulls that image by default through `TQDA_IMAGE`.

## What gets published

- multi-arch app image for `linux/amd64` and `linux/arm64`
- database remains `pgvector/pgvector:pg16`
- migrations still run in the app entrypoint on startup

## Release process

1. Verify the branch locally:
   - `npm run check`
   - `npm run build`
   - `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build`
   - smoke-test login / maps / backups
2. Merge to the release branch.
3. Push a Git tag such as:
   - `v0.7.0`
   - `v0.7.0-rc.1`
4. GitHub Actions publishes the image to GHCR.
5. Roll out that exact tag to users by setting:
   - `TQDA_IMAGE=ghcr.io/joeriben/transact-qda:<tag>`

Do not ask users to track floating `latest` if you want a controlled
test rollout.

## Package visibility

Default: publish the GHCR image publicly.

That keeps the open-source installation path simple:

- no GitHub login required for normal users
- `docker compose pull` works out of the box
- releases can still be pinned to exact tags

## What users do

1. Clone the repo.
2. Copy `.env.example` to `.env`.
3. Set `SESSION_SECRET`.
4. Set `TQDA_IMAGE` to the released tag.
5. Start:
   - `docker compose pull`
   - `docker compose up -d`

## Development vs runtime

- Official runtime:
  - `docker compose up -d`
  - pulls GHCR image
- Local development build:
  - `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build`

These must stay separate. Do not mix "official install path" and
"developer local build path" in the same instructions again.
