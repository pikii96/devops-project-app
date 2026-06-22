# Secure Event Ticketing Platform

[![CI Pipeline](https://github.com/pikii96/devops-project-app/actions/workflows/ci.yaml/badge.svg)](https://github.com/pikii96/devops-project-app/actions/workflows/ci.yaml)
[![Container Registry](https://img.shields.io/badge/ghcr.io-published-2ea44f?logo=docker)](https://github.com/pikii96?tab=packages&repo_name=devops-project-app)
[![Security Scanning](https://img.shields.io/badge/Trivy-quality_gate-blue?logo=aquasonar)](https://github.com/pikii96/devops-project-app/security/code-scanning)

Ovaj repozitorij je rješenje projektnog zadatka za kolegij **Uvod u DevOps - DevSecOps** na Sveučilištu Algebra Bernays.

Platforma demonstrira cjeloviti DevSecOps tok jedne višeslojne aplikacije: od lokalnog razvoja kroz Docker Compose, preko produkcijskog deploymenta na Kubernetes s Helm chart-om, do CI/CD pipeline-a s integriranim automatiziranim testiranjem i sigurnosnim skeniranjem (Trivy quality gate, shift-left pristup).

---

## Sadržaj

1. [Pregled aplikacije i arhitekture](#pregled-aplikacije-i-arhitekture)
2. [Struktura repozitorija](#struktura-repozitorija)
3. [Brzi početak (TL;DR)](#brzi-početak-tldr)
4. [Dio 1 - Lokalni razvoj (Docker Compose)](#dio-1---lokalni-razvoj-docker-compose)
5. [Dio 2 - Kubernetes deployment (Helm)](#dio-2---kubernetes-deployment-helm)
6. [Dio 3 - CI/CD pipeline](#dio-3---cicd-pipeline)
7. [DevSecOps kontrole](#devsecops-kontrole)
8. [API referenca](#api-referenca)
9. [Troubleshooting](#troubleshooting)
10. [Operativna dokumentacija](#operativna-dokumentacija)
11. [Akademska napomena](#akademska-napomena)
12. [Napomena o umjetnoj inteligenciji](#napomena-o-umjetnoj-inteligenciji)

---

## Pregled aplikacije i arhitekture

### Što aplikacija radi

Jednostavna platforma za prodaju ulaznica za evente. Korisnik kroz preglednik odabire event, šalje narudžbu, narudžba ulazi u Redis queue, a pozadinski worker ju asinkrono upisuje u PostgreSQL bazu podataka. Svi servisi imaju liveness i readiness sonde, non-root korisnika (UID 1001), te odvojene konfiguracijske (`ConfigMap`) i tajne (`Secret`) objekte.

### Servisi

| Servis     | Tehnologija          | Port | Uloga                                                    |
| ---------- | -------------------- | ---- | -------------------------------------------------------- |
| `frontend` | Node.js / Express    | 3000 | Statički web UI (HTML+JS), proxy konfiguracije API URL-a |
| `api`      | Node.js / Express    | 8080 | REST API: eventi, narudžbe, health/ready sonde           |
| `worker`   | Node.js              | -    | Pozadinska obrada - `BRPOP` iz Redisa, upis u Postgres   |
| `postgres` | PostgreSQL 16-alpine | 5432 | Trajna pohrana narudžbi (`ticket_orders`)                |
| `redis`    | Redis 7-alpine       | 6379 | Queue narudžbi (`ticket_orders` lista)                   |

### Tok jedne narudžbe

1. Preglednik dohvaća `GET /config` od frontenda → dobiva `apiBaseUrl`
2. Preglednik radi `GET {apiBaseUrl}/events` → API vraća popis evenata
3. Korisnik klikne "Purchase" → `POST {apiBaseUrl}/tickets/purchase`
4. API stavlja narudžbu na Redis listu i vraća `202 Accepted` s `orderId`
5. Worker u beskonačnoj petlji radi `BRPOP` na listi i upisuje narudžbu u Postgres
6. Korisnik može provjeriti status preko `GET {apiBaseUrl}/tickets/orders` → API čita zadnjih 50 iz baze

---

## Struktura repozitorija

```
devops-project-app/
├── README.md                       # ovaj dokument
├── RUNBOOK.md                      # operativni runbook (6 incidentnih scenarija)
├── compose.yaml                    # Dio 1: lokalni dev stack
├── compose.override.yaml           # hot-reload override (auto-loaded)
├── .env.example                    # primjer env varijabli (kopirati u .env)
├── .gitignore                      # ignorira .env i node_modules
│
├── api/                            # REST API servis
│   ├── Dockerfile                  # multi-stage hardened (non-root, UID 1001)
│   ├── package.json
│   ├── src/server.js
│   └── tests/api.test.js           # Jest unit testovi (8 testova)
├── frontend/                       # web UI servis
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── server.js
│       └── public/index.html
├── worker/                         # background processor
│   ├── Dockerfile
│   ├── package.json
│   └── src/worker.js
│
├── docs/
│   ├── ARHITEKTURA.md              # arhitektonska analiza (Ishod I1)
│   ├── VODIC-ZA-POCETNIKE.md       # edukacijski vodič kroz projekt
│   └── security/
│       └── security-report.md      # sigurnosno izvješće (4 iteracije)
│
├── infra/
│   └── postgres/init.sql           # inicijalni DB schema (Compose)
│
├── k8s/
│   ├── kind-cluster.yaml           # konfiguracija lokalnog kind clustera
│   └── ticketing/                  # Helm chart (Dio 2)
│       ├── Chart.yaml
│       ├── values.yaml             # konfiguracija servisa, replika, resursa
│       └── templates/              # 22 Kubernetes manifesta
│           ├── namespace.yaml
│           ├── configmap.yaml      # app config (host-ovi, log level)
│           ├── secret.yaml         # POSTGRES_PASSWORD (placeholder)
│           ├── postgres-init-configmap.yaml  # SQL schema bootstrap
│           ├── serviceaccount.yaml # namjenski SA bez auto-mount token-a
│           ├── rbac.yaml           # Role + RoleBinding (least-privilege)
│           ├── postgres-statefulset.yaml  # PostgreSQL s PVC 1Gi
│           ├── redis-deployment.yaml
│           ├── api-deployment.yaml         # 2 replike
│           ├── worker-deployment.yaml
│           ├── frontend-deployment.yaml    # 2 replike
│           ├── ingress.yaml        # nginx Ingress s regex routing-om
│           ├── networkpolicy.yaml  # default-deny + 6 granularnih politika
│           └── _helpers.tpl
│
└── .github/
    └── workflows/
        └── ci.yaml                 # Dio 3: hello → test → build → scan → push
```

---

## Brzi početak (TL;DR)

Ako želiš samo vidjeti aplikaciju kako radi, lokalno:

```bash
git clone https://github.com/pikii96/devops-project-app.git
cd devops-project-app

cp .env.example .env
docker compose up -d
```

Otvori `http://localhost:3000` u pregledniku. Detalji u [Dio 1](#dio-1---lokalni-razvoj-docker-compose).

---

## Dio 1 - Lokalni razvoj (Docker Compose)

### Preduvjeti

| Alat                                      | Verzija           | Napomena                                                       |
| ----------------------------------------- | ----------------- | -------------------------------------------------------------- |
| Docker / Podman                           | bilo koja nedavna | Compose podrška obavezna (`docker compose` / `podman compose`) |
| `git`                                     | 2.x               | Za clone repozitorija                                          |
| Slobodni portovi `3000` i `8080` na hostu | -                 | Mogu se prepisati kroz `.env` (`API_PORT`, `FRONTEND_PORT`)    |

### Setup (samo prvi put)

```bash
# 1. Klonaj repozitorij
git clone https://github.com/pikii96/devops-project-app.git
cd devops-project-app

# 2. Kreiraj lokalni .env iz template-a
cp .env.example .env

# 3. (opcionalno) Promijeni POSTGRES_PASSWORD u .env za vlastitu lozinku
```

> `.env` je u `.gitignore` - nikad ga ne commitaj. Sve produkcijske tajne idu u Kubernetes `Secret` objekte (vidi Dio 2).

### Pokretanje stack-a

```bash
# Build i pokretanje u pozadini
docker compose up -d

# Pratiti logove
docker compose logs -f
```

Stack je spreman kad u logovima vidiš:

```
api       | API listening on port 8080
frontend  | Frontend listening on port 3000
worker    | Worker started and waiting for jobs...
```

Postgres i Redis imaju definirane `healthcheck` blokove, a `api`, `worker` i `frontend` imaju `depends_on: condition: service_healthy` - Compose tek nakon zelenih health checkova pokreće aplikacijske servise.

### Hot-reload tijekom razvoja

Datoteka `compose.override.yaml` se automatski učitava pored `compose.yaml` i omogućava hot-reload kroz Node.js 20 ugrađeni `--watch` flag i bind mount izvora — svaki put kad spremiš izmjenu u `api/src/`, `worker/src/` ili `frontend/src/`, Node proces detektira promjenu i automatski restartira kontejner.

```bash
# Development mode (hot-reload, default kad postoji compose.override.yaml)
docker compose up -d

# Production-like pokretanje bez override-a
docker compose -f compose.yaml up -d
```

Pristup koristi samo postojeći `node` binary u slici (`--watch` je ugrađen u Node 20+), tako da Dockerfile-ovi ostaju multi-stage hardened — nema `nodemon`-a, `npx`-a, ili dodatnih paketa u produkcijskoj slici.

### Validacija

Otvori u pregledniku: **<http://localhost:3000>** (treba se vidjeti web UI s listom evenata).

Kroz `curl`:

```bash
# Liveness API-ja
curl -s http://localhost:8080/healthz
# → {"status":"ok","service":"api"}

# Readiness (testira Postgres + Redis konekcije)
curl -s http://localhost:8080/readyz
# → {"status":"ready"}

# Lista evenata
curl -s http://localhost:8080/events | head

# Kreiranje narudžbe
curl -s -X POST http://localhost:8080/tickets/purchase \
  -H "Content-Type: application/json" \
  -d '{"eventId":"evt-1001","customerEmail":"student@example.com","quantity":2}'
# → {"message":"Order queued","orderId":"<uuid>"}

# Provjera obrađenih narudžbi (worker upisuje u bazu)
curl -s http://localhost:8080/tickets/orders | head
```

### Zaustavljanje

```bash
# Zaustavi i ukloni kontejnere - volume s podacima ostaje sačuvan
docker compose down

# Zaustavi i obriši sve uključujući volumes (briše podatke baze!)
docker compose down -v
```

### Pokretanje testova lokalno

```bash
cd api
npm install
npm test
# → 8 passed, 8 total, ~280ms
```

---

## Dio 2 - Kubernetes deployment (Helm)

Helm chart u direktoriju [`k8s/ticketing/`](k8s/ticketing/) deploya cijelu aplikaciju u Kubernetes cluster s **22 manifest datoteke**.

### Preduvjeti

| Alat                         | Verzija            | Napomena                                                       |
| ---------------------------- | ------------------ | -------------------------------------------------------------- |
| `kubectl`                    | v1.36.x            | Konfiguriran i spojen na klaster                               |
| `helm`                       | v4.2.0             | Helm package manager                                           |
| Kubernetes klaster           | v1.35+             | bilo koja od opcija ispod                                      |
| `kind` (opcionalno)          | v0.31.0            | Za lokalni razvojni klaster                                    |

**Opcije za Kubernetes klaster:**

- **Lokalno (preporučeno):** [kind](https://kind.sigs.k8s.io/) - konfiguracija u `k8s/kind-cluster.yaml`
- **Lokalno alternativa:** [k3s](https://k3s.io/) ili [minikube](https://minikube.sigs.k8s.io/)
- **Cloud:** GKE, AKS, EKS - chart radi bez izmjena
- **OpenShift:** Treba dodatno koristiti `Route` umjesto `Ingress`

> **Važno za NetworkPolicy enforcement:** kind klaster koristi `kindnet` CNI po defaultu koji **ne enforce-a** `NetworkPolicy` objekte. Manifesti se primijene bez greške, ali pravila nisu operativna. Za pravo testiranje NetworkPolicy potreban je Calico ili Cilium CNI. Helm chart sadrži valjane manifeste koji rade na production K8s clusterima (EKS, GKE, AKS).

### Setup kind clustera

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

### Priprema prije prvog deployanja

#### 1. Postavi pravu lozinku u `Secret`

Defaultne vrijednosti u `k8s/ticketing/templates/secret.yaml` su placeholder-i s prefiksom `CHANGE-IN-PROD`. Za stvarno produkcijsko deployanje, generiraj nove vrijednosti i nadjačaj ih kroz `--set` parametar ili custom values fajl:

```bash
helm install ticketing . \
  --namespace ticketing --create-namespace \
  --set secret.postgresPassword="$(openssl rand -base64 32)" \
  --set secret.redisPassword="$(openssl rand -base64 32)" \
  --wait
```

> Za produkciju razmotri `Sealed Secrets`, `External Secrets Operator` ili HashiCorp Vault za sigurno upravljanje tajnama.

#### 2. Postavi hostname za Ingress

`k8s/ticketing/templates/ingress.yaml` koristi hostname `ticketing.local` s regex routing-om. Dodaj redak u `/etc/hosts`:

```bash
# Saznaj IP Ingress controller-a
kubectl get svc -n ingress-nginx ingress-nginx-controller

# Dodaj mapping (zamijeni IP)
echo "127.0.0.1 ticketing.local" | sudo tee -a /etc/hosts
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

### Validacija na klasteru

```bash
# Provjeri da su svi podovi Running
kubectl get pods -n ticketing

# Očekivani output (7 podova):
# api-XXX           1/1   Running   (2 replike)
# worker-XXX        1/1   Running
# frontend-XXX      1/1   Running   (2 replike)
# postgres-0        1/1   Running
# redis-XXX         1/1   Running

# Pregled svih objekata u namespace-u
kubectl get all,configmap,secret,networkpolicy,ingress -n ticketing

# Helm release status
helm status ticketing -n ticketing
```

### Test aplikacije

```bash
# Direktan health check (zaobilazi Ingress)
API_POD=$(kubectl get pod -n ticketing -l app=api -o jsonpath='{.items[0].metadata.name}')
kubectl exec -n ticketing $API_POD -- wget -qO- http://localhost:8080/healthz

# Test kroz Ingress
curl -s http://ticketing.local/healthz
curl -s http://ticketing.local/events

# Test kreiranja narudžbe
curl -s -X POST http://ticketing.local/tickets/purchase \
  -H "Content-Type: application/json" \
  -d '{"eventId":"evt-1001","customerEmail":"student@example.com","quantity":2}'

# Frontend u pregledniku
# → http://ticketing.local
```

### Rolling update i rollback

Detaljne upute u [RUNBOOK.md](RUNBOOK.md). Brza referenca:

```bash
# Pregled povijesti deploya
helm history ticketing -n ticketing

# Rolling update (npr. nova verzija API-a)
helm upgrade ticketing . \
  --namespace ticketing \
  --set api.image.tag=sha-<new-commit>

# Pratiti rolling update u real-time
kubectl rollout status deployment/api -n ticketing

# Rollback na prethodnu reviziju
helm rollback ticketing <revision> -n ticketing
```

### Uklanjanje

```bash
# Helm uninstall (čuva namespace)
helm uninstall ticketing -n ticketing

# Ili obriši cijeli namespace
kubectl delete namespace ticketing
```

---

## Dio 3 - CI/CD pipeline

GitHub Actions workflow je u [`.github/workflows/ci.yaml`](.github/workflows/ci.yaml). Implementira **secure-by-default DevSecOps pipeline** s quality gate-om i automatiziranim testiranjem prije objave slika u registry.

### Triggeri

| Trigger                     | Akcije                                                       |
| --------------------------- | ------------------------------------------------------------ |
| `push` na `main`            | hello → test → build → Trivy scan → push na GHCR (ako pass)  |
| `pull_request` prema `main` | hello → test → build → Trivy scan (bez push-a)               |

### Koraci pipeline-a

```
Hello → Test → Build (matrix x3) → Trivy scan → Quality gate → GHCR push
                                        │
                                        ▼
                                 SARIF u Security tab
```

1. **Hello World Test** — osnovna validacija da pipeline radi (~3 sekunde)
2. **Run API tests** — 8 Jest unit testova s mock-iranim PostgreSQL, Redis i UUID modulima (~15 sekundi)
3. **Build** — Multi-stage `production` slike za 3 servisa paralelno (matrix strategija)
4. **Trivy scan (SARIF)** — skenira lokalnu sliku za `CRITICAL` i `HIGH` ranjivosti
5. **Quality gate** — pipeline pada ako scan nađe issue s dostupnim fix-om (`exit-code: 1`)
6. **Security tab** — SARIF report uploadan u GitHub Security → Code scanning
7. **Push na GHCR** — izvršava se SAMO ako svi prethodni koraci uspiju I trigger je `push` na `main`

Prosječno trajanje pipeline-a: **1 minutu i 43 sekunde**.

### Quality gate - princip "secure-by-default"

```
Build (lokalno) → Test → Trivy scan → Push (samo ako scan prođe)
```

Ranjiva slika ili kod koji ne prolazi testove **nikada** ne završi u registry-ju. To znači da Kubernetes manifesti (koji povlače slike s GHCR-a) nikad ne deployaju kompromitiranu sliku osim kroz manualnu intervenciju.

- `ignore-unfixed: true` - preskačemo OS-level CVE-ove za koje ne postoji upstream patch
- `severity: 'CRITICAL,HIGH'` - block samo na visokorizičnim ranjivostima

### Tagovi slika

Svaki uspješan build na `main`-u producira tri taga:

```
ghcr.io/pikii96/devops-project-app/<service>:latest        # uvijek najnovija
ghcr.io/pikii96/devops-project-app/<service>:main          # main grana
ghcr.io/pikii96/devops-project-app/<service>:sha-<commit>  # immutable, za produkciju
```

`sha-<commit>` tag omogućuje preciznu reprodukciju build-a kasnije i preporučen je za produkcijski deploy.

### Pre-built kontejnerske slike (GHCR)

Slike su automatski objavljene u **GitHub Container Registry** na svaki push u `main`:

```bash
docker pull ghcr.io/pikii96/devops-project-app/api:latest
docker pull ghcr.io/pikii96/devops-project-app/worker:latest
docker pull ghcr.io/pikii96/devops-project-app/frontend:latest

# Za produkcijsku upotrebu preporuča se imutabilan tag
docker pull ghcr.io/pikii96/devops-project-app/api:sha-<commit>
```

---

## DevSecOps kontrole

Pregled sigurnosnih elemenata kroz cijeli stack:

| Kontrola                                  | Implementacija                                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Multi-stage build (slim production slike) | `*/Dockerfile` - odvojeni builder i runtime stageovi (~51 MB komprimirano)                       |
| Non-root korisnik u kontejneru            | `*/Dockerfile` - UID 1001 (`USER node`)                                                          |
| Image vulnerability scan                  | `.github/workflows/ci.yaml` - Trivy quality gate                                                  |
| Automatizirani testovi                    | `api/tests/api.test.js` - 8 Jest testova s mock-iranim ovisnostima                              |
| Tajne odvojene od konfiguracije           | `k8s/ticketing/templates/secret.yaml` vs `configmap.yaml`                                        |
| `.env` nije commitan                      | `.gitignore` blokira; samo `.env.example` u repu                                                 |
| Liveness + Readiness sonde                | Svi deployment-i u `k8s/ticketing/templates/`                                                    |
| Resource requests + limits                | Svi `Deployment` manifesti u `k8s/ticketing/templates/`                                          |
| ServiceAccount least-privilege            | `k8s/ticketing/templates/serviceaccount.yaml` - `automountServiceAccountToken: false`            |
| RBAC s resourceNames                      | `k8s/ticketing/templates/rbac.yaml` - Role čita SAMO ticketing-secret i ticketing-config         |
| Pod security context                      | `runAsNonRoot: true`, `runAsUser: 1001`, `fsGroup: 1001`                                         |
| Container security context                | `allowPrivilegeEscalation: false`, `capabilities: drop: [ALL]`                                   |
| NetworkPolicy default-deny                | `k8s/ticketing/templates/networkpolicy.yaml` - sve blokirano osim eksplicitno dopuštenog          |
| Granularni network rules                  | postgres/redis: samo iz api+worker; api: iz frontend+ingress; frontend: iz ingress               |
| Immutable image tagging                   | sha-tag politika za produkcijske deploye                                                          |
| CI permissions least-privilege            | `.github/workflows/ci.yaml` - samo `contents:read`, `packages:write`, `security-events:write`    |
| SARIF report u GitHub Security tab        | `.github/workflows/ci.yaml` - `codeql-action/upload-sarif`                                       |

Detalji skeniranja kroz 4 iteracije: [`docs/security/security-report.md`](docs/security/security-report.md)

---

## API referenca

| Metoda | Endpoint            | Opis                                                     |
| ------ | ------------------- | -------------------------------------------------------- |
| GET    | `/healthz`          | Liveness probe - vraća 200 ako proces radi               |
| GET    | `/readyz`           | Readiness probe - testira Postgres + Redis konekcije     |
| GET    | `/events`           | Lista dostupnih evenata (statički seed)                  |
| POST   | `/tickets/purchase` | Kreira narudžbu (`eventId`, `customerEmail`, `quantity`) - vraća `202 Accepted` |
| GET    | `/tickets/orders`   | Zadnjih 50 narudžbi iz Postgresa                         |

Frontend ima dodatno:

| Metoda | Endpoint   | Opis                                           |
| ------ | ---------- | ---------------------------------------------- |
| GET    | `/`        | Statička HTML stranica                         |
| GET    | `/config`  | Vraća `{ apiBaseUrl }` koji preglednik koristi |
| GET    | `/healthz` | Liveness frontend procesa                      |

---

## Troubleshooting

Za detaljne scenarije i rješenja vidi [RUNBOOK.md](RUNBOOK.md) — sadrži 6 stvarnih incidentnih scenarija s sistematskim troubleshooting postupkom.

### Najčešći lokalni problemi (Compose)

| Simptom                                       | Uzrok                              | Rješenje                                                         |
| --------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------- |
| Port `3000` ili `8080` zauzet                 | Drugi proces sluša port            | Prepiši kroz `.env` (`API_PORT`, `FRONTEND_PORT`)                |
| Frontend pokazuje "Failed to initialize"      | API ne radi ili `apiBaseUrl` krivi | `curl http://localhost:8080/readyz` i provjeri logove API-ja     |
| Worker ne procesira narudžbe                  | Worker pao ili Redis prazan        | `docker compose logs worker`, `redis-cli llen ticket_orders`     |
| Kontejner restart-a u petlji                  | Vjerojatno crash u app logici      | `docker compose logs <service>` za stack trace                   |
| Hot-reload ne radi                            | `compose.override.yaml` obrisan    | Vrati fajl ili koristi `node --watch` ručno                      |

### Najčešći Kubernetes problemi

| Simptom                          | Rješenje                                                                    |
| -------------------------------- | --------------------------------------------------------------------------- |
| Pod u `ImagePullBackOff`         | Slika ne postoji u registry-ju ili manifest pokazuje na krivi tag           |
| `CrashLoopBackOff` na api/worker | Vjerojatno auth fail prema Postgresu - `kubectl logs ...` i provjeri Secret |
| `pending` PVC                    | Klaster nema `default` StorageClass - `kubectl get storageclass`            |
| Ingress vraća 502                | Frontend pod nije ready ili `endpoints` prazan - vidi RUNBOOK              |
| Platform mismatch arm64/amd64    | CI gradi amd64, lokalni dev je arm64 - vidi RUNBOOK scenarij 4.1            |

---

## Operativna dokumentacija

| Dokument | Sadržaj |
|---|---|
| [`docs/ARHITEKTURA.md`](docs/ARHITEKTURA.md) | Arhitektonska analiza — usporedba kontejner vs VM pristupa, obrazloženje odabira servisa, opis međuservisne komunikacije i usklađenost s ciljevima projekta (Ishod I1) |
| [`RUNBOOK.md`](RUNBOOK.md) | Operativni runbook s 6 stvarnih incidentnih scenarija (platform mismatch, env var naming, database bootstrap, ingress reset, push-then-scan, compose override regression) |
| [`docs/security/security-report.md`](docs/security/security-report.md) | Sigurnosno izvješće s nalazima skeniranja, hardening iteracijama i quality gate analizom (4 iteracije) |

### Korisni linkovi

- **CI Pipeline:** [Actions tab](https://github.com/pikii96/devops-project-app/actions)
- **Sigurnosni nalazi:** [Security tab](https://github.com/pikii96/devops-project-app/security/code-scanning)
- **Pre-built slike:** [GHCR Packages](https://github.com/pikii96?tab=packages&repo_name=devops-project-app)

---

## Akademska napomena

Repozitorij je vlastiti rad u sklopu kolegija **Uvod u DevOps - DevSecOps** na Sveučilištu Algebra Bernays. Prati ishode učenja definirane u projektnom zadatku "Secure Event Ticketing Platform".

---

## Student

Implementirao: **Marin Pavlović**
[Algebra Bernays Sveučilište](https://algebra.hr/sveuciliste/), 2025./2026.
