# Sigurnosno izvješće — API servis (Container Image)

> **Projekt:** Secure Event Ticketing Platform
> **Servis:** API (`ticketing-api`)
> **Datum:** 2026-05-14 (Iteracija 1) / 2026-05-27 (Iteracija 2 i 3)
> **Skener:** Aqua Trivy v0.70.0 (lokalno) / v0.36.0 (CI/CD)
> **Bazna slika:** `node:20-alpine` (Alpine Linux 3.23.4)

## 1. Cilj

Demonstrirati DevSecOps proces upravljanja ranjivostima kontejnerskih slika kroz:
1. **Detekciju** ranjivosti automatiziranim skeniranjem
2. **Analizu** lokacije i konteksta nalaza
3. **Implementaciju** korektivnih mjera (hardening)
4. **Verifikaciju** kroz re-skeniranje
5. **Evidenciju** rezultata (JSON, SARIF, Markdown)
6. **Kontinuirano poboljšanje** kroz arhitektonske promjene CI/CD-a

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
| Imutabilan tag | `sha-<commit>` u CI/CD | ✅ |
| Automatska detekcija novih CVE-ova | CI/CD pipeline + GitHub Security | ✅ |
| Quality gate (blokira HIGH/CRITICAL) | `exit-code: '1'` u CI/CD | ✅ |
| Shift-left security | Scan PRIJE push u registry | ✅ |

## 8. Tagging strategija (politika objave slika)

| Tag | Namjena | Primjer | Promjenjiv? |
|---|---|---|---|
| `sha-<commit>` | **Produkcija** (CI/CD) | `sha-2a3d441` | NE (imutabilan) |
| `vX.Y.Z` | **Release** (semantic versioning) | `v1.0.0` | NE |
| `latest` | Posljednji uspješni build | `latest` | DA (samo dev) |
| `<branch>` | Pomoćni tag (testna okruženja) | `main`, `develop` | DA |

**Pravilo:** U Kubernetes/Helm chart-u uvijek koristiti `sha-<commit>` tag — nikad `latest`.

## 9. Iteracija 2 — Detekcija novih CVE-ova kroz CI/CD pipeline

> **Datum:** 2026-05-27
> **Trigger:** Automatsko Trivy skeniranje u GitHub Actions workflow-u
> **Status:** Detektirano → Remedijirano → Verificirano ✅

### 9.1 Kontekst

Nakon implementacije CI/CD pipeline-a s automatskim Trivy skeniranjem (commit `2123507`), GitHub Security tab je detektirao **2 nove ranjivosti** u aplikacijskim ovisnostima koje nisu postojale u trenutku prvotnog hardening-a Faze 1.

Ovaj nalaz **potvrđuje vrijednost kontinuiranog skeniranja** — sigurnosni krajolik se mijenja brže od ritma deployment-a aplikacije.

### 9.2 Detektirane ranjivosti

| CVE | Package | Severity | Instalirana verzija | Fix verzija | Tip ovisnosti |
|---|---|---|---|---|---|
| CVE-2026-41907 | `uuid` | HIGH | 10.0.0 | 14.0.0+ | Direktna (API) |
| CVE-2026-8723 | `qs` | MEDIUM | 6.15.1 | 6.15.2+ | Transitivna (Express) |

#### Analiza CVE-2026-41907 (uuid)
Out-of-bounds write u v3/v5/v6 UUID generatorima — može dovesti do silent partial writes u caller-buffere kad se proslijedi nedostatan output buffer ili previsoki offset. Direktna ovisnost API servisa korištena za generiranje `order_id` u narudžbama.

#### Analiza CVE-2026-8723 (qs)
`qs.stringify` baca neuhvatljivi `TypeError` kad se koristi `arrayFormat: 'comma'` + `encodeValuesOnly: true` na nizu koji sadrži `null` ili `undefined`. Transitivna ovisnost dolazi kroz Express framework koji koristi `qs` za parsiranje query string-ova.

### 9.3 Remedijacija

Proveden je standardni DevSecOps ciklus ažuriranja paketa:

```bash
# API servis (direktna uuid ovisnost)
cd api
npm install uuid@latest      # 10.0.0 → 14.0.0 (major upgrade)
npm update                   # ažuriranje svih transitive ovisnosti

# Worker servis (samo transitive)
cd ../worker
npm update

# Frontend servis (express → noviji qs)
cd ../frontend
npm update
```

Lock fajlovi (`package-lock.json`) regenerirani su s ažuriranim verzijama u sva tri servisa.

### 9.4 Verifikacija

Nakon rebuild-a API slike, lokalno Trivy skeniranje:

```bash
docker build -t ticketing-api:test ./api
trivy image --severity HIGH,CRITICAL ticketing-api:test
```

**Rezultat**: `Total: 0 (HIGH: 0, CRITICAL: 0)` ✅

Dodatna verifikacija sa `npm audit` u sva tri servisa:
- `api` → `found 0 vulnerabilities`
- `worker` → `found 0 vulnerabilities`
- `frontend` → `found 0 vulnerabilities`

### 9.5 Metrike iteracije

| Metrika | Prije remedijacije | Poslije remedijacije |
|---|---|---|
| HIGH ranjivosti (Trivy) | 1 (uuid) | 0 |
| MEDIUM ranjivosti (Trivy) | 1 (qs) | 0 |
| npm audit findings | 1 moderate | 0 |
| GitHub Security alerts | 2 open | 2 auto-resolved |
| Vrijeme detekcije → fix | ~30 minuta | — |

Auto-resolve nakon commit-a `1f48075`:
- **Alert #2** (uuid HIGH): *Fixed via commit 1f48075*
- **Alert #1** (qs MEDIUM): *Fixed via commit 1f48075*

### 9.6 Lekcija

Sigurnosni krajolik se mijenja kontinuirano. Implementacija automatskog skeniranja u CI/CD pipeline-u nije samo "nice to have" — već **operativno nužna** za održavanje sigurnosti aplikacije nakon prvotnog deployment-a.

> *Princip: "Security is not a state, it's a continuous process."*

## 10. Iteracija 3 — Shift-left security pattern u CI/CD-u

> **Datum:** 2026-05-27
> **Trigger:** Pipeline #8 (commit `0d06271`) failed na auth GHCR-a — prilika za arhitektonsko poboljšanje
> **Status:** Refaktor → Verificirano kroz Pipeline #9 (commit `2a3d441`) ✅

### 10.1 Kontekst

Prvotna implementacija GHCR push-a u CI/CD pipeline-u (commit `0d06271`) imala je redoslijed:

```
Build slike → Push u GHCR → Trivy scan iz GHCR-a → Quality gate
```

Pipeline je pao jer Trivy GitHub Action nije imao GHCR credentials da povuče upravo objavljenu sliku natrag za skeniranje. Naizgled tehnički problem otkrio je **dublju sigurnosnu manu** u dizajnu pipeline-a.

### 10.2 Sigurnosni problem prvotnog dizajna

Čak i da je Trivy uspješno skenirao sliku, redoslijed je bio **konceptualno pogrešan**:

> Ako slika ima HIGH/CRITICAL ranjivost, pipeline je već push-ao tu ranjivu sliku u registry **prije** detekcije. Quality gate u tom trenutku samo blokira merge — ali slika je već dostupna svima koji imaju pristup registry-u.

```mermaid
Problem:  [Build] → [Push] → [Scan] → ❌ Quality gate FAIL
                       ↑
                  Ranjiva slika već u registry!
```

### 10.3 Rješenje — Shift-left security pattern

Redoslijed je promijenjen tako da skeniranje **PRETHODI** push-u:

```mermaid
Rješenje: [Build lokalno] → [Scan] → [Quality gate] → [Push]
                                          ↓
                                    FAIL = stop, slika ostaje
                                    izvan registry-a
```

### 10.4 Tehničke promjene (commit `2a3d441`)

Izmjene u `.github/workflows/ci.yaml`:

1. **Build s `load: true`** — slika ide u lokalni Docker daemon CI runner-a:
   ```yaml
   - name: Build image locally (for scanning)
     uses: docker/build-push-action@v6
     with:
       context: ./${{ matrix.service }}
       load: true
       tags: ${{ matrix.service }}:scan
       cache-from: type=gha
       cache-to: type=gha,mode=max
   ```

2. **Trivy skenira lokalnu sliku** — bez potrebe za GHCR auth:
   ```yaml
   - name: Run Trivy vulnerability scanner (quality gate)
     uses: aquasecurity/trivy-action@v0.36.0
     with:
       image-ref: ${{ matrix.service }}:scan
       format: 'table'
       severity: 'CRITICAL,HIGH'
       exit-code: '1'
       ignore-unfixed: true
   ```

3. **GHCR push tek nakon prolaska gate-a** — uz uvjet da je `main` grana:
   ```yaml
   - name: Push image to GHCR (only after passing Trivy quality gate)
     if: github.event_name == 'push' && github.ref == 'refs/heads/main'
     uses: docker/build-push-action@v6
     with:
       context: ./${{ matrix.service }}
       push: true
       tags: ${{ steps.meta.outputs.tags }}
       cache-from: type=gha
   ```

4. **Pull request-ovi se skeniraju, ali ne push-aju** — sigurnosni guardrail.

### 10.5 Verifikacija — Pipeline #9 (commit `2a3d441`)

Rezultati nakon push-a:

| Job | Status | Duration |
|---|---|---|
| Hello World Test | ✅ | 4s |
| Build & Scan api | ✅ | ~45s |
| Build & Scan worker | ✅ | ~42s |
| Build & Scan frontend | ✅ | ~46s |
| **Total pipeline** | ✅ Success | **1m 53s** |

**GHCR rezultat:** 3 nova paketa objavljena s tagovima `sha-2a3d441`, `latest`, `main`:
- [`ghcr.io/pikii96/devops-project-app/api`](https://github.com/pikii96/devops-project-app/pkgs/container/devops-project-app%2Fapi)
- [`ghcr.io/pikii96/devops-project-app/worker`](https://github.com/pikii96/devops-project-app/pkgs/container/devops-project-app%2Fworker)
- [`ghcr.io/pikii96/devops-project-app/frontend`](https://github.com/pikii96/devops-project-app/pkgs/container/devops-project-app%2Ffrontend)

**GitHub Security tab:** 0 otvorenih alerts, 2 auto-resolved (iz Iteracije 2).

### 10.6 Operativne metrike

| Metrika | Vrijednost |
|---|---|
| Vrijeme detekcije problema | < 1 minuta (CI feedback) |
| Vrijeme refaktora | ~15 minuta |
| Pipeline duration (s GHA cache) | 1m 53s |
| Cache hit ratio (drugi build) | 53% |
| Število servisa koji se paralelno grade | 3 (matrix strategy) |

### 10.7 Lekcije za DevSecOps zrelost

1. **Failed pipeline nije neuspjeh** — to je signal o dizajnerskim manama koje se trebaju adresirati prije produkcije.
2. **Shift-left znači više od testiranja** — uključuje i organizaciju samog pipeline-a tako da sigurnosne provjere prethode operativnim akcijama.
3. **Defense in depth** — quality gate je sada **četverostruka** sigurnosna barijera:
   - Lokalni `npm audit` tijekom razvoja
   - Trivy scan u CI/CD-u (informativni SARIF)
   - Trivy quality gate (blokirajući)
   - GHCR push samo s `main` grane (sprječava da PR-ovi objave neispitan kod)

> *Princip: "Bad images should never enter the registry. Period."*

## 11. Reference

- Trivy dokumentacija: https://trivy.dev/latest/
- Alpine security: https://alpinelinux.org/security/
- Docker security best practices: https://docs.docker.com/develop/security-best-practices/
- CIS Docker Benchmark: https://www.cisecurity.org/benchmark/docker
- CVE-2026-41907 (uuid): https://github.com/advisories
- CVE-2026-8723 (qs): https://github.com/advisories
- OWASP DevSecOps Guidelines: https://owasp.org/www-project-devsecops-guideline/
- GitHub Actions docs: https://docs.github.com/en/actions

## 12. Privici

### Iteracija 1 (hardening)
- `01-baseline-scan.txt` — tabela baseline ranjivosti
- `01-baseline-scan.json` — JSON format (CI/CD integracija)
- `01-baseline-scan.sarif` — SARIF format (GitHub Security tab)
- `02-hardened-scan.txt` — tabela nakon hardening-a (0 nalaza)
- `02-hardened-scan.json` — JSON nakon hardening-a
- `02-hardened-scan.sarif` — SARIF nakon hardening-a

### Iteracija 2 (CVE remedijacija)
- `03-iteracija2-detected.txt` — Trivy nalazi za uuid i qs CVE-e
- `03-iteracija2-fixed.txt` — Trivy scan nakon remedijacije (0 nalaza)

### Iteracija 3 (shift-left pattern)
- `04-iteracija3-pipeline8-failed.png` — screenshot pipeline #8 (push-then-scan, failed)
- `04-iteracija3-pipeline9-success.png` — screenshot pipeline #9 (scan-then-push, green)
- `04-iteracija3-ghcr-packages.png` — screenshot GHCR Packages stranice