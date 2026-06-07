# Arhitektura sustava — Secure Event Ticketing Platform

> **Projekt:** Uvod u DevOps - DevSecOps (Algebra Bernays, 2026)
> **Student:** Marin Pavlović
> **Repozitorij:** https://github.com/pikii96/devops-project-app
> **Datum:** 2026-05-31
> **Verzija:** 1.0

## 1. Cilj i opseg dokumenta

Ovaj dokument obrazlaže **arhitektonski odabir** za Secure Event Ticketing Platform i pokriva Ishod učenja **I1 — Procjena upotrebe kontejnera i servisa**. Konkretno, dokumentira:

1. **Usporedbu kontejnerskog i virtualizacijskog (VM) pristupa** s argumentima za izbor kontejnera
2. **Obrazloženje za svaki od 5 servisa** i njihovih uloga u sustavu
3. **Arhitekturu i međuservisnu komunikaciju** (sinkroni vs asinkroni, stateful vs stateless)
4. **Usklađenost arhitektonskog pristupa s ciljevima projekta** (DevSecOps lifecycle, sigurnost, skalabilnost, operativna zrelost)

Cilj nije teorijski pregled svih opcija, već **konkretno opravdanje** za odabire napravljene u ovom projektu, s referencama na stvarne implementacijske detalje (Dockerfile-ovi, Helm chart, Compose datoteka).

## 2. Kontejneri vs virtualne mašine

### 2.1 Tehnička usporedba

| Aspekt | Virtualne mašine | Kontejneri | Implikacija za projekt |
|---|---|---|---|
| **Razina izolacije** | Hardverska (hypervisor) | Procesna (Linux namespaces + cgroups) | Kontejneri imaju **manju izolaciju**, ali za web aplikaciju s pažljivim securityContext-om to je prihvatljivo |
| **Boot vrijeme** | 30-90 sekundi (OS boot) | 100ms - 2 sekunde (proces start) | **Kritično za probe-ove** — readiness probe može provjeriti čim aplikacija krene |
| **Resource overhead** | Cijeli OS po VM-u (~512MB-2GB baseline) | Samo aplikacija + runtime (~50MB) | Naših 5 servisa u K8s-u ukupno traži ~512MB RAM-a (vs. ~10GB za 5 VM-ova) |
| **Gustoća na hostu** | ~10-20 VM-ova po fizičkoj mašini | Stotine kontejnera po hostu | **Trošak hardvera** je značajno manji |
| **Portabilnost** | VM image (GB) ovisan o hypervisor-u | OCI slika (MB) standardizirana | Slika `ghcr.io/pikii96/devops-project-app/api:sha-9d8194a` radi bilo gdje gdje postoji container runtime |
| **Image build time** | 10-30 minuta | 30 sekundi - 2 minute | **CI/CD pipeline** je 10× brži (naše Faza 2 builds: 50s-1m10s) |
| **Image storage** | 1-10 GB | 50-200 MB | Naše slike (komprimirano u registriju): api 51.5MB, worker 49.4MB, frontend 51.2MB (~170MB nekomprimirano) |
| **Update strategija** | VM replace (downtime) ili in-place patching | Rolling update (zero downtime) | K8s Deployment s `maxSurge: 1, maxUnavailable: 0` daje zero-downtime |
| **Konfiguracijski drift** | Mutable (može se "potezati" tijekom vremena) | Immutable (svaka promjena = nova slika) | Garantira **reproducibilnost** — `sha-9d8194a` je isti svuda |
| **OS patch management** | Po VM-u, manualno ili kroz config mgmt | Rebuild slike + redeploy | Trivy quality gate u CI-u automatski detektira CVE-ove |

### 2.2 Kriteriji odabira — zašto kontejneri za ovaj projekt

Kontejnerski pristup je odabran iz **četiri ključna razloga**:

#### 2.2.1 Brzina i agilnost razvoja
- **Developer onboarding**: novi developer pokreće `docker compose up -d` i u 30 sekundi ima cijeli stack pokrenut lokalno. S VM-ovima bi trebalo Vagrant + Ansible + 20 minuta.
- **Lokalna ↔ produkcijska paritet**: Compose za lokalno, Helm za K8s — **isti Dockerfile**, ista slika, ista konfiguracija. VM bi zahtjevao odvojene image-e za dev/prod.
- **CI/CD ciklus**: prosječni pipeline trajanje **1m 53s** za build + scan + push 3 slike. VM build bi bio 15-30 minuta.

#### 2.2.2 Sigurnost kroz immutability
- **Immutable infrastructure**: jednom kad se slika sa sha tagom objavi i prođe Trivy gate, ne mijenja se. VM-ovi se često "potezaju" kroz vrijeme što stvara security debt.
- **Cattle, not pets**: ako se kontejner pokvari, ubije se i podigne novi. VM-ovi traže debugging što povećava MTTR.
- **Reproducible builds**: source kod + Dockerfile → identična slika. VM-ovi imaju varijabilnu provenance (kernel patche, manualne izmjene, drift).

#### 2.2.3 Resource efficiency
- **Naših 5 servisa** u K8s-u koristi **~700MB RAM-a ukupno**. Ekvivalent VM-ovima bi tražio ~10GB.
- **Density**: jedan kind node s 4GB RAM-a može pokrenuti **sve naše replike + sustavni K8s** + ostatak za debugging.
- **Brzo skaliranje**: `helm upgrade --set api.replicaCount=10` u 10 sekundi. VM autoscaling u cloud-u traje 3-5 minuta.

#### 2.2.4 Ekosistem DevSecOps alata
- **Trivy** skenira slike u CI-u; ekvivalentni alati za VM-ove (Nessus, Qualys) su skuplji i kompliciraniji.
- **K8s native**: probes, NetworkPolicy, RBAC, Secret management — sve je dostupno gotovo iz kutije.
- **Helm** za versioning; **rollback** u 5 sekundi. VM rollback je tehnički teško (osim kroz snapshot-e koji su skupi).

### 2.3 Kada bi VM bio bolji izbor

Postoje scenariji gdje bi VM bio prikladniji, ali se **ne odnose na naš projekt**:

| Scenarij | Zašto VM | Naša situacija |
|---|---|---|
| Legacy Windows aplikacije | Container Windows support je ograničen | Mi imamo cross-platform Node.js |
| Striktni regulatorni zahtjevi za hardware izolaciju | PCI-DSS klase 1, defense workloads | Mi smo edukacijski projekt, nemamo te zahtjeve |
| Aplikacije koje trebaju specifičan kernel | Custom kernel modules, real-time kernel | Naša aplikacija je standardna web aplikacija |
| Multi-tenant SaaS s untrusted workloads | Container escape je veći rizik | Mi smo single-tenant projekt |
| Specijalizirani hardware (GPU passthrough) | Nije podržano u svim K8s setup-ima | Ne koristimo GPU |

**Zaključak**: za ovaj projekt — web aplikacija s mikroservisnom arhitekturom, edukacijski kontekst, potreba za brzom isporukom i DevSecOps integracijom — kontejnerski pristup je **objektivno najbolji izbor**.

## 3. Odabir servisa i njihove uloge

Arhitektura je **podijeljena u 5 servisa**, svaki s jasno definiranom odgovornosti. Ovo je primjena **Single Responsibility Principle** na nivou servisa.

### 3.1 Frontend (Web UI)

**Tehnologija**: Node.js 20 + Express, statički HTML/CSS/JS
**Image**: `ghcr.io/pikii96/devops-project-app/frontend:sha-9d8194a` (51.2 MB)
**Port**: 3000
**Skalabilnost**: 2 replike (horizontal scaling u K8s-u)
**State**: Stateless

**Zadaća**:
- Serbira statički HTML s formom za kupovinu karata
- Vraća konfiguracijski endpoint (`/config`) koji informira browser o API base URL-u
- Health check endpoint (`/healthz`)

**Zašto zaseban servis**:
- **Različita skalabilna potreba** od API-ja — frontend može imati 10× više requesta (statika, JS bundle), dok API ima poslovnu logiku
- **Sigurnosno odvajanje** — frontend ne treba pristup bazi ili Redis-u (NetworkPolicy enforce-a)
- **Tehnološka neovisnost** — može se zamijeniti React/Vue verzijom bez utjecaja na backend

### 3.2 API servis (REST endpoint)

**Tehnologija**: Node.js 20 + Express + pg + redis client
**Image**: `ghcr.io/pikii96/devops-project-app/api:sha-9d8194a` (51.5 MB)
**Port**: 8080
**Skalabilnost**: 2 replike, može rasti horizontalno
**State**: Stateless (svako stanje je u Postgres-u ili Redis-u)

**Zadaća**:
- REST endpointi: `/events`, `/tickets/purchase`, `/tickets/orders`, `/healthz`, `/readyz`
- Validacija ulaznih podataka
- Komunikacija s Redis-om (queue order) i Postgres-om (read orders)

**Zašto zaseban servis**:
- **Glavni business logic sloj** — ovdje se događa autorizacija, validacija, orchestration
- **Skalabilnost neovisna od frontend-a** — API ima drugačiji performance profile
- **Lakše testirati** — API kao zasebna jedinica može imati svoje integration testove

### 3.3 Background worker

**Tehnologija**: Node.js 20 + pg + redis client (BRPOP loop)
**Image**: `ghcr.io/pikii96/devops-project-app/worker:sha-9d8194a` (49.4 MB)
**Port**: nema (no HTTP listener)
**Skalabilnost**: 1 replika (može rasti za multi-consumer pattern)
**State**: Stateless

**Zadaća**:
- BRPOP-a Redis queue (`ticket_orders` lista)
- Procesira svaku narudžbu (validacija, INSERT u Postgres `ticket_orders`)
- Logira status

**Zašto zaseban servis (najvažniji argument za kontejnerski pristup)**:
- **Asinkronost** — API može odmah vratiti `Order queued` (sub-100ms response), worker procesira u pozadini
- **Decoupling** — ako Postgres pati od opterećenja, worker bekflje (radi sporije), ali API nije pogođen
- **Različiti scale pattern** — API treba scale na peak (kupovine), worker može biti konstantan i procesirati queue
- **Resilience** — ako worker padne, narudžbe ostaju u Redis-u i procesiraju se kad worker dođe natrag

**Bez zasebnog worker-a**, sva obrada bila bi sinkrona u API-ju, što bi:
- Učinila API spore (kupac čeka da svi INSERT-i prođu)
- Vezala dostupnost API-ja za dostupnost baze
- Onemogućila batch processing ili retry logiku

### 3.4 PostgreSQL baza

**Tehnologija**: PostgreSQL 16 (Alpine variant)
**Image**: `postgres:16-alpine` (oficijalna)
**Port**: 5432
**Skalabilnost**: 1 instanca (StatefulSet)
**State**: Stateful — PersistentVolumeClaim 1Gi

**Zadaća**:
- Trajna pohrana narudžbi (`ticket_orders` tablica)
- Transakcijska konzistentnost (ACID)
- Schema bootstrap kroz `init.sql` ConfigMap (vidi RUNBOOK 4.3)

**Zašto zaseban servis**:
- **Persistent state** — različit lifecycle od stateless servisa
- **StatefulSet umjesto Deployment** — garantira stabilno ime poda (`postgres-0`), stabilan PVC, sequential start/stop
- **Sigurnosno enkapsuliran** — NetworkPolicy dozvoljava pristup **samo** API-ju i Worker-u, ne frontend-u

**Alternativa**: managed cloud database (RDS, Cloud SQL). U produkciji preporučljivo zbog backup-a i high availability, ali za edukacijski projekt self-managed unutar K8s-a je dovoljno.

### 3.5 Redis (queue + cache)

**Tehnologija**: Redis 7 (Alpine variant)
**Image**: `redis:7-alpine` (oficijalna)
**Port**: 6379
**Skalabilnost**: 1 instanca (Deployment)
**State**: Ephemeral (emptyDir, `--save ""`, `--appendonly no`)

**Zadaća**:
- **Queue** između API-ja i Worker-a (lista `ticket_orders`)
- **Potencijalno cache** za eventove (read-heavy operacije)

**Zašto zaseban servis i zašto Redis**:
- **Specijalizirana baza** — Redis je 100× brži od Postgres-a za queue operacije
- **Atomic LPUSH/RPOP** — garantira da se narudžba ne procesira dvaput
- **Decoupling** — API i Worker komuniciraju preko Redis-a, ne direktno

**Zašto ephemeral storage**:
- Queue je tranzijentan — narudžbe se ne smiju izgubiti dugoročno, ali queue per se nije source of truth (Postgres je)
- Ako Redis padne između LPUSH i RPOP, narudžba se može izgubiti (rijetka šansa) — u produkciji bi se koristio Redis AOF + replication

## 4. Arhitektura i međuservisna komunikacija

### 4.1 Visoka razina

```
Internet
    │
    ▼
┌─────────────────┐
│ Ingress Nginx   │  (vanjski pristup, regex routing)
└─────────────────┘
    │
    ├─────────────────┐
    ▼                 ▼
┌──────────┐    ┌──────────┐
│ Frontend │    │   API    │
│ (2 rep.) │    │ (2 rep.) │
└──────────┘    └──────────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
   ┌─────────┐  ┌──────────┐ ┌──────────┐
   │ Redis   │  │ Postgres │ │  Worker  │
   │ (1 rep) │  │ (1 rep)  │ │ (1 rep)  │
   └─────────┘  └──────────┘ └──────────┘
        ▲                          │
        └──────────────────────────┘
              (BRPOP queue)
```

### 4.2 Tipovi komunikacije

| Komunikacijski par | Protokol | Sinkroni/Async | Format | Primjer |
|---|---|---|---|---|
| Browser → Ingress | HTTP/1.1 | Sync | HTML/JSON | `GET /events` |
| Ingress → Frontend | HTTP/1.1 | Sync | HTML/JSON | proxy_pass |
| Ingress → API | HTTP/1.1 | Sync | JSON | proxy_pass |
| Frontend → API (kroz Ingress) | HTTP/1.1 | Sync | JSON | `fetch("/tickets/purchase")` |
| API → Redis | RESP | Sync (push) | binary | `LPUSH ticket_orders {...}` |
| Worker ← Redis | RESP | Sync (long-poll) | binary | `BRPOP ticket_orders 0` |
| Worker → Postgres | PostgreSQL wire | Sync | SQL | `INSERT INTO ticket_orders ...` |
| API → Postgres | PostgreSQL wire | Sync | SQL | `SELECT * FROM ticket_orders` |

### 4.3 Tipičan tok narudžbe (end-to-end)

```
1. Korisnik u browseru klikne "Purchase"
   └─> POST /tickets/purchase JSON payload

2. Ingress routira na API servis (regex: /tickets/.*)
   └─> API dobiva HTTP request

3. API validira payload (eventId, customerEmail, quantity)
   └─> Ako validan, generira UUID za order_id

4. API LPUSH-a narudžbu u Redis queue
   └─> Redis vraća OK (mikroseconds)

5. API odgovara browseru s 200 + {orderId, message: "Order queued"}
   └─> Korisnik vidi potvrdu odmah (~50ms total)

6. Worker (u pozadini) BRPOP-uje queue
   └─> Dobiva narudžbu

7. Worker INSERT-uje u Postgres ticket_orders
   └─> Postgres vraća OK, narudžba je sada perzistentna

8. (Opcionalno) Worker logira success ili šalje email
```

**Ključna karakteristika**: koraci 1-5 traju ~50ms iz perspektive korisnika. Koraci 6-8 mogu trajati sekunde, ali korisnik to ne vidi.

### 4.4 Service discovery i DNS

U Kubernetes-u svaki Service dobiva DNS naziv u formatu `<service>.<namespace>.svc.cluster.local`:

| Servis | DNS naziv | Tko ga koristi |
|---|---|---|
| `api` | `api.ticketing.svc.cluster.local` | Frontend (ali zaobiđen kroz Ingress!) |
| `frontend` | `frontend.ticketing.svc.cluster.local` | Ingress controller |
| `postgres` | `postgres.ticketing.svc.cluster.local` | API, Worker |
| `redis` | `redis.ticketing.svc.cluster.local` | API, Worker |

**Bitno**: cluster DNS je dostupan **samo unutar cluster-a**. Browser u korisnikovom kompjuteru ga ne može razriješiti — zato browser komunicira s API-jem **kroz Ingress** (`/events`, `/tickets/purchase`), ne direktno na cluster DNS. (Vidi RUNBOOK 4.4 za detalje.)

### 4.5 Stateful vs stateless dizajn

**Stateless servisi** (Frontend, API, Worker):
- Mogu se replicirati horizontalno bez problema
- Pad jedne replike ne uzrokuje gubitak podataka
- Rolling update je trivijalan (K8s `Deployment` strategy)
- Sigurnosno otvorenije za experimenting

**Stateful servis** (Postgres):
- StatefulSet umjesto Deployment (stabilan PVC, stable pod identity)
- Skaliranje zahtjeva careful planning (read replicas, sharding)
- Backup strategija je ključna (u produkciji: pg_dump cron, ili managed RDS)

**Ephemeral state** (Redis):
- Zaseban od stateless (ima podatke, ali nisu source of truth)
- Ako padne, narudžbe u queue-u se mogu izgubiti (worst case: 0-5 sekundi narudžbi)
- Trade-off: brzina vs durability

## 5. Usklađenost arhitektonskog pristupa s ciljevima projekta

### 5.1 Ciljevi projekta (iz uputa)

1. Demonstrirati cijeli DevOps/DevSecOps ciklus (lokalni razvoj → CI/CD → produkcija)
2. Sigurna isporuka i orkestracija
3. Observability i troubleshooting
4. Praktična primjena modernih praksi

### 5.2 Mapiranje arhitektura → ciljevi

| Cilj projekta | Kako arhitektura podupire | Konkretno u našem projektu |
|---|---|---|
| **Lokalni razvoj** | Docker Compose s istim slikama kao K8s | `compose.yaml` pokreće cijeli stack u 30s |
| **CI/CD pipeline** | Container-native: matrix build 3 slike paralelno | GitHub Actions: 1m 53s end-to-end |
| **Sigurna isporuka** | Slike skenirane prije push-a; immutable tag-ovi | Trivy quality gate, sha-9d8194a |
| **Orkestracija** | K8s native koncepti (Deployment, StatefulSet, Service) | Helm chart s 22 manifesta |
| **Observability** | Probes, structured logging, K8s events | Liveness + readiness za sve servise |
| **Troubleshooting** | kubectl + helm history + runbook | RUNBOOK.md s 5 incidenata |
| **Modern practices** | Helm, NetworkPolicy, RBAC, ConfigMap/Secret | Implementirano u sva 22 manifesta |

### 5.3 DevSecOps lifecycle pokrivenost

```
Plan       → Design ovog dokumenta (ARHITEKTURA.md)
Develop    → Compose za lokalno (Faza 1)
Build      → Multi-stage Dockerfile-ovi (multi-stage, non-root)
Test       → Trivy scan + health probe validation
Release    → GHCR push samo s passing gate-om
Deploy     → Helm upgrade s rolling strategy
Operate    → kubectl + helm + runbook
Monitor    → K8s events + logs + (budući Prometheus/Grafana)
```

### 5.4 Skalabilnost arhitekture

Arhitektura podržava **horizontalno skaliranje** za sve servise koji to trebaju:

| Servis | Trenutno | Maks (smisleno) | Strategija |
|---|---|---|---|
| Frontend | 2 replike | 50+ | HPA na CPU/memory |
| API | 2 replike | 20+ | HPA na request rate |
| Worker | 1 replika | 10 (concurrent BRPOP consumers) | HPA na queue depth (KEDA) |
| Postgres | 1 instanca | Vertical scale + read replicas | Master-replica, eventually multi-shard |
| Redis | 1 instanca | Cluster mode | Redis Cluster + Sentinel |

Helm chart već **omogućava** ovo — samo treba postaviti `replicaCount` u values.yaml.

### 5.5 Sigurnosne implikacije arhitekture

Mikroservisna arhitektura donosi **defense in depth**:

1. **Network segmentation** — NetworkPolicy default-deny + explicit allow
2. **Least privilege** — RBAC dozvoljava SA samo `get` na vlastiti CM/Secret
3. **Image hardening** — multi-stage build, non-root user (UID 1001), `drop: ALL` capabilities
4. **Immutable infrastructure** — sha tagovi, nikad `latest` u produkciji
5. **Secrets management** — odvojen Secret objekt s base64 (u produkciji: External Secrets + Vault)
6. **Supply chain** — Trivy gate u CI-u prije objave

Više detalja u `security-report.md` (Iteracije 1-4).

### 5.6 Operativne implikacije

| Aspekt | Realna mjerena vrijednost |
|---|---|
| Vrijeme od commit-a do production deploya | ~5 minuta (pipeline + helm upgrade) |
| Vrijeme rolling update-a (2→3 replike) | ~10 sekundi |
| Vrijeme rollback-a (helm rollback) | ~5 sekundi |
| Zero-downtime kroz rolling update | ✅ Potvrđeno kroz curl tijekom demo-a |
| MTTR (Mean Time To Recovery) za incidente | Vidi RUNBOOK — većina < 5 minuta |
| Lokalno onboarding novog developera | `docker compose up -d` → 30 sekundi |

## 6. Zaključak

Kontejnerska mikroservisna arhitektura odabrana za Secure Event Ticketing Platform je **objektivno opravdana** za:

1. **Tehnički profil aplikacije** — web/REST aplikacija s asinkronim background processing-om
2. **Operativni profil** — potreba za brzom isporukom i automatiziranom orkestracijom
3. **Sigurnosni profil** — DevSecOps integracija kroz cijeli lifecycle
4. **Edukacijski cilj** — demonstrira moderne DevOps prakse koje su industry standard

Pet odabranih servisa (Frontend, API, Worker, Postgres, Redis) reflektira **logičko razdvajanje odgovornosti** umjesto monolita, što omogućuje:
- Neovisno skaliranje
- Sigurnosno odvajanje (NetworkPolicy)
- Tehnološku evoluciju (svaki servis se može mijenjati neovisno)
- Operacijsku zrelost (rolling update, rollback, observability)

Implementacija je u potpunosti dokumentirana kroz:
- [`compose.yaml`](../compose.yaml) — lokalni razvojni stack
- [`k8s/ticketing/`](../k8s/ticketing/) — Helm chart za produkciju (22 K8s manifesta)
- [`docs/security/security-report.md`](security/security-report.md) — sigurnosne iteracije (1-4)
- [`RUNBOOK.md`](../RUNBOOK.md) — operativni runbook s incidentima

## 7. Reference

- The Twelve-Factor App: https://12factor.net/
- Container vs VM: NIST SP 800-190 (Application Container Security Guide)
- Microservices Patterns (Chris Richardson, 2018)
- Kubernetes Patterns (Bilgin Ibryam, Roland Huß, 2019)
- CNCF Landscape: https://landscape.cncf.io/
