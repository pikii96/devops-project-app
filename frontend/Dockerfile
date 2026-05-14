# syntax=docker/dockerfile:1.7

# ============================================================================
# STAGE 1: BUILDER - instalira production dependencies
# Frontend koristi: express, dotenv (servira static HTML iz src/public)
# ============================================================================
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./

RUN if [ -f package-lock.json ]; then \
        npm ci --omit=dev; \
    else \
        npm install --omit=dev; \
    fi && \
    npm cache clean --force

# ============================================================================
# STAGE 2: RUNTIME - hardened slika
# Frontend Express server servira static HTML iz src/public/ na portu 3000
# Ima /healthz endpoint pa imamo HEALTHCHECK
# Uklanjamo npm i yarn iz runtime sloja (security hardening)
# ============================================================================
FROM node:20-alpine AS runtime

RUN apk add --no-cache tini wget && \
    addgroup -S app -g 1001 && \
    adduser -S app -G app -u 1001 -h /app && \
    rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/bin/npm \
           /usr/local/bin/npx \
           /opt/yarn-* \
           /usr/local/bin/yarn \
           /usr/local/bin/yarnpkg

WORKDIR /app

COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --chown=app:app package*.json ./
COPY --chown=app:app src ./src

USER app

# Health check - poziva /healthz endpoint na port 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/healthz || exit 1

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]