# syntax=docker/dockerfile:1.7

# ============================================================================
# STAGE 1: BUILDER - instalira sve production dependencies
# ============================================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Kopiraj manifest datoteke prvo (Docker layer caching)
COPY package*.json ./

# npm ci je deterministicki; fallback na npm install ako nema package-lock.json
RUN if [ -f package-lock.json ]; then \
        npm ci --omit=dev; \
    else \
        npm install --omit=dev; \
    fi && \
    npm cache clean --force

# ============================================================================
# STAGE 2: RUNTIME - minimalna produkcijska slika
# ============================================================================
FROM node:20-alpine AS runtime

# tini = init process, wget = za HEALTHCHECK
RUN apk add --no-cache tini wget && \
    addgroup -S app -g 1001 && \
    adduser -S app -G app -u 1001 -h /app

WORKDIR /app

# Kopiraj node_modules iz builder stage-a
COPY --from=builder --chown=app:app /app/node_modules ./node_modules

# Kopiraj aplikacijski kod
COPY --chown=app:app package*.json ./
COPY --chown=app:app src ./src

# KLJUCNO: prebaci se na non-root korisnika
USER app

# Health check - poziva /healthz endpoint
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/healthz || exit 1

EXPOSE 8080

# tini kao PID 1 za graceful shutdown
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]
