# syntax=docker/dockerfile:1.7

# ============================================================================
# STAGE 1: BUILDER - instalira production dependencies
# Worker koristi: pg, redis, dotenv (bez Express-a)
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
# STAGE 2: RUNTIME - hardened slika za background worker
# Bez HEALTHCHECK (nema HTTP servera)
# Bez EXPOSE (nema port-a)
# Bez wget (nema HTTP health probe)
# tini je kljucan: worker ima while(true) petlju, treba pravilan SIGTERM
# Uklanjamo npm i yarn iz runtime sloja (security hardening)
# ============================================================================
FROM node:20-alpine AS runtime

RUN apk add --no-cache tini && \
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

# Worker NEMA HEALTHCHECK jer nema HTTP endpoint
# U Kubernetesu cemo dodati exec probe (pgrep node)
# Worker NEMA EXPOSE jer ne osluskuje na portu

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/worker.js"]