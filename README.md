# Secure Event Ticketing Platform (Sample DevSecOps Project)

[![CI Pipeline](https://github.com/pikii96/devops-project-app/actions/workflows/ci.yaml/badge.svg)](https://github.com/pikii96/devops-project-app/actions/workflows/ci.yaml)
[![Container Registry](https://img.shields.io/badge/ghcr.io-published-2ea44f?logo=docker)](https://github.com/pikii96?tab=packages&repo_name=devops-project-app)
[![Security Scanning](https://img.shields.io/badge/Trivy-quality_gate-blue?logo=aquasonar)](https://github.com/pikii96/devops-project-app/security/code-scanning)

Ovaj repozitorij je referentni uzorak aplikacije za kolegij **Uvod u DevOps - DevSecOps**.
Prikazuje cijeli tok: lokalni razvoj kroz Compose i produkcijski deployment kroz Kubernetes manifeste.

## Arhitektura

- `frontend` - web UI za pregled evenata i kupnju karata
- `api` - REST API za evente, narudzbe i health provjere
- `worker` - pozadinska obrada queue poruka
- `postgres` - trajna pohrana narudzbi
- `redis` - queue/cache sloj

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

## Sigurnosni elementi

- Multi-stage Docker build i non-root runtime korisnik
- Secret + ConfigMap odvojena konfiguracija
- Liveness/Readiness probe
- Resource requests/limits
- ServiceAccount + RBAC
- NetworkPolicy segmentacija
- Trivy skeniranje slika u CI pipelineu

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

### Korisni linkovi

- **CI Pipeline:** [Actions tab](https://github.com/pikii96/devops-project-app/actions)
- **Sigurnosni nalazi:** [Security tab](https://github.com/pikii96/devops-project-app/security/code-scanning)
- **Pre-built slike:** [GHCR Packages](https://github.com/pikii96?tab=packages&repo_name=devops-project-app)

---

## Student

Implementirao: **Marin Pavlović**
[Algebra Bernays](https://algebra.hr/sveuciliste/), 2025./2026.