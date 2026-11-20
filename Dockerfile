FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 DISABLE_JOBS=true
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM build AS tools
CMD ["npm", "run", "db:migrate"]

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    TZ=Asia/Tehran \
    DISABLE_JOBS=true \
    BACKUP_DIR=/data/backups \
    OFFSITE_DIR=/data/offsite \
    MIGRATIONS_PG_DIR=/app/src/db/migrations-pg \
    SEED_DIR=/app/docs/seed
RUN apt-get update && apt-get install -y --no-install-recommends tzdata curl && rm -rf /var/lib/apt/lists/* \
 && groupadd -r ascent && useradd -r -g ascent -d /app ascent && mkdir -p /data && chown ascent:ascent /data
COPY --from=build --chown=ascent:ascent /app/.next/standalone ./
COPY --from=build --chown=ascent:ascent /app/.next/static ./.next/static
COPY --from=build --chown=ascent:ascent /app/public ./public
COPY --from=build --chown=ascent:ascent /app/src/db/migrations-pg ./src/db/migrations-pg
COPY --from=build --chown=ascent:ascent /app/docs ./docs
USER ascent
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD curl -fsS http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "server.js"]
