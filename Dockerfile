# syntax=docker/dockerfile:1
# SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
# SPDX-License-Identifier: AGPL-3.0-or-later

FROM node:20-bookworm AS build
WORKDIR /app
ENV NODE_ENV=development
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:20-bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates postgresql-client tini \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=5174
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/docs ./docs
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/package.json ./package.json
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh \
    && mkdir -p /app/projekte /app/uploads /app/.model-cache /app/coach-library /app/backups
EXPOSE 5174
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["node", "build/index.js"]
