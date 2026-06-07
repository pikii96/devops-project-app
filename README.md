# Secure Event Ticketing Platform (Sample DevSecOps Project)

[![CI Pipeline](https://github.com/pikii96/devops-project-app/actions/workflows/ci.yaml/badge.svg)](https://github.com/pikii96/devops-project-app/actions/workflows/ci.yaml)
[![Container Registry](https://img.shields.io/badge/ghcr.io-published-2ea44f?logo=docker)](https://github.com/pikii96?tab=packages&repo_name=devops-project-app)
[![Security Scanning](https://img.shields.io/badge/Trivy-quality_gate-blue?logo=aquasonar)](https://github.com/pikii96/devops-project-app/security/code-scanning)

Ovaj repozitorij je referentni uzorak aplikacije za kolegij **Uvod u DevOps - DevSecOps**.
Prikazuje cijeli tok: lokalni razvoj kroz Compose i produkcijski deployment kroz Kubernetes/Helm.

## Arhitektura

- `frontend` - web UI za pregled evenata i kupnju karata
- `api` - REST API za evente, narudzbe i health provjere
- `worker` - pozadinska obrada queue poruka
- `postgres` - trajna pohrana narudzbi
- `redis` - queue/cache sloj

## Lokalni razvoj (Docker Compose)

```bash
# Pokreni cijeli stack
docker compose up -d

# Pratite logove
docker compose logs -f
```

### Development mode (hot-reload)

Datoteka `compose.override.yaml` se automatski učitava pored `compose.yaml` i omogućava hot-reload kroz Node.js 20 ugrađeni `--watch` flag i bind mount izvora — svaki put kad spremiš izmjenu u `api/src/`, `worker/src/` ili `frontend/src/`, Node proces detektira promjenu i automatski se restartira.

```bash
# Development mode (hot-reload, default kad postoji compose.override.yaml)
docker compose up -d

# Production-like pokretanje bez override-a
docker compose -f compose.yaml up -d
```

Pristup koristi samo postojeći `node` binary u slici (`--watch` je ugrađen u Node 20+), tako da Dockerfile-ovi ostaju multi-stage hardened — nema nodemon-a, npx-a, ili dodatnih paketa u produkcijskoj slici.

### Brza validacija funkcionalnosti

1. Health API:
   ```bash
   curl http://localhost:8080/healthz
   curl http://localhost:8080/readyz
   ```
2. Dohvati evente:
   ```bash
   curl http://localhost:8080/events
   ```
3. Posalji narudzbu:
   ```bash
   curl -X POST http://localhost:8080/tickets/purchase \
     -H "Content-Type: application/json" \
     -d '{"eventId":"evt-1001","customerEmail":"student@example.com","quantity":2}'
   ```
4. Provjeri obradene narudzbe:
   ```bash
   curl http://localhost:8080/tickets/orders
   ```
5. UI:
   - Otvori `http://localhost:3000`

## Production deployment (Kubernetes/Helm)

Helm chart u direktoriju [`k8s/ticketing/`](k8s/ticketing/) deploya cijelu aplikaciju u Kubernetes cluster.

### Prerequisites

```bash
# Tools (verzije korištene u projektu)
kind v0.31.0        # Lokalni Kubernetes cluster
kubectl v1.36.1     # K8s CLI
helm v4.2.0         # Helm package manager
```

### Setup kind cluster

```bash
cd k8s/

# Kreiraj cluster s port mapiranjem 80/443
kind create cluster --config kind-cluster.yaml --name ticketing-cluster

# Instaliraj nginx-ingress controller
kubectl apply -f https://kind.sigs.k8s.io/examples/ingress/deploy-ingress-nginx.yaml

# Čekaj da Ingress controller bude Ready
kubectl wait --namespace ingress-nginx \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller \
  --timeout=120s
```

### Deploy aplikacije

```bash
cd k8s/ticketing/

# Validacija chart-a
helm lint .

# Pregled što će biti instalirano (dry-run)
helm template ticketing . | less

# Instalacija
helm install ticketing . \
  --create-namespace \
  --namespace ticketing \
  --wait \
  --timeout 5m
```

### Validacija deployment-a

```bash
# Provjeri da su svi podovi Running
kubectl get pods -n ticketing

# Očekivani output (7 podova):
# api-XXX           1/1   Running   (2 replike)
# worker-XXX        1/1   Running
# frontend-XXX      1/1   Running   (2 replike)
# postgres-0        1/1   Running
# redis-XXX         1/1   Running

# Helm release status
helm status ticketing -n ticketing
```

### Pristup aplikaciji

Na macOS Apple Silicon (Docker Desktop), koristi port-forward:

```bash
kubectl port-forward -n ingress-nginx svc/ingress-nginx-controller 8080:80 &

# Otvori browser:
open http://localhost:8080

# Ili API testovi:
curl http://localhost:8080/healthz
curl http://localhost:8080/events
curl -X POST http://localhost:8080/tickets/purchase \
  -H "Content-Type: application/json" \
  -d '{"eventId":"evt-1001","customerEmail":"k8s-test@example.com","quantity":2}'
curl http://localhost:8080/tickets/orders
```

> **Napomena**: Na Linux serveru (cloud K8s, on-prem) može se koristiti `http://ticketing.local` direktno preko Ingress-a — port-forward je workaround za macOS Docker Desktop networking ograničenje. Detalji u [RUNBOOK.md](RUNBOOK.md) sekcija 4.4.

### Rolling update i rollback

```bash
# Pregled povijesti deploya
helm history ticketing -n ticketing

# Rolling update (npr. nova verzija API-a)
helm upgrade ticketing . \
  --namespace ticketing \
  --set api.image.tag=sha-<new-commit>

# Pratite rolling update u real-time
kubectl rollout status deployment/api -n ticketing

# Rollback na prethodnu reviziju
helm rollback ticketing <revision> -n ticketing
```

## Sigurnosni elementi

- Multi-stage Docker build i non-root runtime korisnik (UID 1001)
- Secret + ConfigMap odvojena konfiguracija
- Liveness/Readiness probe za sve servise
- Resource requests/limits
- ServiceAccount + RBAC s least privilege principom
- NetworkPolicy mrežna segmentacija (default-deny ingress)
- Trivy skeniranje slika u CI pipelineu (shift-left)
- Pod-level i container-level securityContext (`allowPrivilegeEscalation: false`, `capabilities: drop ALL`)

Detalji skeniranja: [`docs/security/security-report.md`](docs/security/security-report.md)

## DevSecOps Pipeline

Projekt koristi **GitHub Actions** s **shift-left security** pristupom:

```
Build (lokalno) -> Trivy scan -> Quality gate -> GHCR push
                       |
                       v
              Upload SARIF u Security tab
```

Pipeline blokira slike s HIGH/CRITICAL ranjivostima **prije** ulaska u registry.

### Pre-built kontejnerske slike (GHCR)

Slike su automatski objavljene u **GitHub Container Registry** na svaki push u `main`:

```bash
docker pull ghcr.io/pikii96/devops-project-app/api:latest
docker pull ghcr.io/pikii96/devops-project-app/worker:latest
docker pull ghcr.io/pikii96/devops-project-app/frontend:latest
```

Za produkcijsku upotrebu preporuca se imutabilan tag:

```bash
docker pull ghcr.io/pikii96/devops-project-app/api:sha-<commit>
```

## Operativna dokumentacija

| Dokument | Sadržaj |
|---|---|
| [`docs/ARHITEKTURA.md`](docs/ARHITEKTURA.md) | Arhitektonska analiza — usporedba kontejner vs VM pristupa, obrazloženje odabira servisa, opis međuservisne komunikacije i usklađenost s ciljevima projekta (Ishod I1) |
| [RUNBOOK.md](RUNBOOK.md) | Troubleshooting runbook s 5 stvarnih incidentnih scenarija (platform mismatch, env var naming, database bootstrap, ingress reset, push-then-scan) |
| [`docs/security/security-report.md`](docs/security/security-report.md) | Sigurnosno izvješće s nalazima skeniranja, hardening iteracijama i quality gate analizom |

### Korisni linkovi

- **CI Pipeline:** [Actions tab](https://github.com/pikii96/devops-project-app/actions)
- **Sigurnosni nalazi:** [Security tab](https://github.com/pikii96/devops-project-app/security/code-scanning)
- **Pre-built slike:** [GHCR Packages](https://github.com/pikii96?tab=packages&repo_name=devops-project-app)

---

## Student

Implementirao: **Marin Pavlović**
[Algebra Bernays](https://algebra.hr/sveuciliste/), 2025./2026.
