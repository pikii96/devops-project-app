# Sigurnosno izvješće — API servis (Container Image)

> **Projekt:** Secure Event Ticketing Platform
> **Servis:** API (`ticketing-api`)
> **Datum:** 2026-05-14
> **Skener:** Aqua Trivy v0.70.0
> **Bazna slika:** `node:20-alpine` (Alpine Linux 3.23.4)

## 1. Cilj

Demonstrirati DevSecOps proces upravljanja ranjivostima kontejnerskih slika kroz:
1. **Detekciju** ranjivosti automatiziranim skeniranjem
2. **Analizu** lokacije i konteksta nalaza
3. **Implementaciju** korektivnih mjera (hardening)
4. **Verifikaciju** kroz re-skeniranje
5. **Evidenciju** rezultata (JSON, SARIF, Markdown)

## 2. Metodologija skeniranja

Korišten je [Aqua Trivy](https://trivy.dev/) skener s konfiguracijom:
- `--severity HIGH,CRITICAL` (fokus na bitne nalaze)
- Tri formata izvještaja: `table` (čitljiv), `json` (CI/CD), `sarif` (GitHub Security)

```bash
trivy image --severity HIGH,CRITICAL --format sarif --output scan.sarif ticketing-api:<tag>
```

## 3. Rezultati — Baseline (prije hardening-a)

**Tag:** `ticketing-api:baseline`
**Datoteke:** `01-baseline-scan.{txt,json,sarif}`

| Komponenta | Ranjivosti | Lokacija | Kritičnost |
|---|---|---|---|
| `cross-spawn` | 1 HIGH | `/usr/local/lib/node_modules/npm/...` | CVE-2024-21538 |
| `glob` | 1 HIGH | `/usr/local/lib/node_modules/npm/...` | CVE-2025-64756 |
| `minimatch` | 3 HIGH | `/usr/local/lib/node_modules/npm/...` | CVE-2026-26996, CVE-2026-27903, CVE-2026-27904 |
| `tar` | 6 HIGH | `/usr/local/lib/node_modules/npm/...` | CVE-2026-23745, CVE-2026-23950, CVE-2026-24842, CVE-2026-26960, CVE-2026-29786, CVE-2026-31802 |
| **Aplikacijski paketi** (`/app/node_modules/*`) | **0** | Tvoja aplikacija | — |

**Ukupno: 11 HIGH, 0 CRITICAL**

### 3.1 Analiza

Sve ranjivosti pronađene **isključivo u npm CLI alatu** koji dolazi s `node:20-alpine` baznom slikom. Aplikacijski paketi (`express`, `pg`, `redis`, `uuid`) **nemaju nijednu ranjivost**.

Risk assessment:
- Iako su nalazi tehnički prisutni, **runtime aplikacija ne koristi npm CLI** (`CMD ["node", "src/server.js"]`)
- Napadač bi morao prvo dobiti **shell access** unutar kontejnera da iskoristi npm CVE
- Non-root user (UID 1001) dodatno ograničava potencijalne posljedice

## 4. Korektivna mjera — Hardening

**Princip:** "Least surface" — uklanjamo sve što runtime aplikacija ne treba.

### Implementacija (Dockerfile)
```dockerfile
RUN apk add --no-cache tini wget && \
    addgroup -S app -g 1001 && \
    adduser -S app -G app -u 1001 -h /app && \
    rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/bin/npm \
           /usr/local/bin/npx \
           /opt/yarn-* \
           /usr/local/bin/yarn \
           /usr/local/bin/yarnpkg
```

### Obrazloženje
- **npm CLI** je potreban samo tijekom builda (u `builder` stage-u), ne runtime-u
- **`node` binary** ostaje — aplikacija normalno radi
- **yarn** se uklanja kao alternativni paketni manager (također neiskorišten)

## 5. Rezultati — Hardened (poslije hardening-a)

**Tag:** `ticketing-api:hardened`
**Datoteke:** `02-hardened-scan.{txt,json,sarif}`

**Ukupno: 0 HIGH, 0 CRITICAL** ✅

## 6. Usporedba i metrika poboljšanja

| Metrika | Baseline | Hardened | Poboljšanje |
|---|---|---|---|
| HIGH ranjivosti | 11 | 0 | **-100%** |
| CRITICAL ranjivosti | 0 | 0 | — |
| Veličina slike (~) | 211 MB | ~170 MB | **~-20%** |
| Attack surface | npm CLI prisutan | npm CLI uklonjen | minimaliziran |

## 7. Implementirane sigurnosne prakse

| Praksa | Implementacija | Status |
|---|---|---|
| Multi-stage build | Builder + Runtime razdvojeni | ✅ |
| Minimalna bazna slika | Alpine Linux (~5 MB OS) | ✅ |
| Non-root user | UID 1001 (`app`) | ✅ |
| Health check | HTTP probe na `/healthz` | ✅ |
| Init process | `tini` kao PID 1 za graceful shutdown | ✅ |
| Image hardening | Uklanjanje npm/yarn iz runtime | ✅ |
| `.dockerignore` | Sprječava ulazak `.env`, `node_modules`, `.git` | ✅ |
| Skeniranje ranjivosti | Trivy s automatiziranim izvještajem | ✅ |
| Imutabilan tag | `sha-<commit>` u CI/CD (slijedi) | ⏳ |

## 8. Tagging strategija (politika objave slika)

| Tag | Namjena | Primjer | Promjenjiv? |
|---|---|---|---|
| `sha-<commit>` | **Produkcija** (CI/CD) | `sha-86648a7` | NE (imutabilan) |
| `vX.Y.Z` | **Release** (semantic versioning) | `v1.0.0` | NE |
| `latest` | Posljednji uspješni build | `latest` | DA (samo dev) |
| `<branch>` | Pomoćni tag (testna okruženja) | `main`, `develop` | DA |

**Pravilo:** U Kubernetes/Helm chart-u uvijek koristiti `sha-<commit>` tag — nikad `latest`.

## 9. Reference

- Trivy dokumentacija: https://trivy.dev/latest/
- Alpine security: https://alpinelinux.org/security/
- Docker security best practices: https://docs.docker.com/develop/security-best-practices/
- CIS Docker Benchmark: https://www.cisecurity.org/benchmark/docker

## 10. Privici

- `01-baseline-scan.txt` — tabela baseline ranjivosti
- `01-baseline-scan.json` — JSON format (CI/CD integracija)
- `01-baseline-scan.sarif` — SARIF format (GitHub Security tab)
- `02-hardened-scan.txt` — tabela nakon hardening-a (0 nalaza)
- `02-hardened-scan.json` — JSON nakon hardening-a
- `02-hardened-scan.sarif` — SARIF nakon hardening-a
