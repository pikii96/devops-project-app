# Runbook — Secure Event Ticketing Platform

> **Projekt:** Uvod u DevOps - DevSecOps (Algebra Bernays, 2026)
> **Student:** Marin Pavlović
> **Repozitorij:** https://github.com/pikii96/devops-project-app
> **Verzija:** 1.0
> **Zadnje ažuriranje:** 2026-05-31

## 1. Svrha dokumenta

Ovaj runbook služi kao **operativni vodič** za dijagnostiku i rješavanje stvarnih incidenata koji su nastali tijekom razvoja i deployment-a Secure Event Ticketing Platforme.

Svaki scenarij je **stvarno se dogodio** tijekom rada na projektu i dokumentiran je s ciljem:

- **Brze remedijacije** budućih sličnih incidenata
- **Učenja iz iskustva** za nove članove tima
- **Prevencije ponavljanja** kroz arhitektonske izmjene

## 2. Sistematski troubleshooting postupak

Kad nešto pukne, **uvijek slijedi ovaj redoslijed**:

```
1. PROVJERI STATUS - kubectl get pods -n ticketing
                   - helm status ticketing -n ticketing

2. ODREDI SLOJ KOJI PUCA:
   - Aplikacijski sloj  → kubectl logs <pod>
   - Mrezni sloj        → kubectl get svc/endpoints/ingress
   - Storage sloj       → kubectl get pvc
   - K8s sloj           → kubectl describe pod + events

3. DIJAGNOZIRAJ - kubectl describe pod <ime>
                - kubectl logs <ime> --previous
                - kubectl get events --sort-by='.lastTimestamp'

4. IZOLIRAJ - port-forward svc da zaobides Ingress
            - kubectl exec da udes u pod
            - testiraj iz susjednog poda

5. MITIGIRAJ - rollback, scale, restart, ili patch

6. DOKUMENTIRAJ - ovaj runbook + commit message + security-report
```

## 3. Quick reference tablica

| Simptom | Mogući uzrok | Sekcija |
|---|---|---|
| `ImagePullBackOff` | Platform mismatch ili pogrešan tag | [#4.1](#41-platform-mismatch-arm64-vs-amd64) |
| `CrashLoopBackOff` s `NaN` greškom | Env var ne dolazi do aplikacije | [#4.2](#42-env-var-naming-mismatch-port-vs-api_port) |
| `relation does not exist` | Database schema nije inicijalizirana | [#4.3](#43-database-schema-nije-inicijalizirana) |
| HTTP `Connection reset by peer` | Networking layer problem (macOS) | [#4.4](#44-ingress-connection-reset-na-macos-u) |
| HIGH/CRITICAL CVE u registry-u | Push-then-scan anti-pattern | [#4.5](#45-push-then-scan-anti-pattern) |

## 4. Incidentni scenariji

### 4.1 Platform mismatch (arm64 vs amd64)

#### Simptom
Kubernetes podovi ostaju u statusu `ImagePullBackOff` više od 5 minuta:

```bash
$ kubectl get pods -n ticketing
NAME                   READY   STATUS             RESTARTS   AGE
api-7bbc6799d9-gsv6j   0/1     ImagePullBackOff   0          15m
```

#### Dijagnostika

```bash
# 1. Pogledaj events za točan razlog
kubectl get events -n ticketing --sort-by='.lastTimestamp' | grep -i "image\|pull"

# Tipičan output:
# Failed to pull image "ghcr.io/.../api:sha-13c5c18":
#   no match for platform in manifest: not found
```

**Ključna fraza**: `no match for platform in manifest`.

#### Korijenski uzrok

CI/CD pipeline (GitHub Actions na `ubuntu-latest`) gradi slike samo za **linux/amd64**. Lokalni development environment (MacBook Air s Apple Silicon) zahtjeva **linux/arm64**. Manifest slike ne sadrži arm64 verziju, pa pull pada.

#### Mitigation (privremeno)

Učitaj postojeće lokalne arm64 slike u kind cluster:

```bash
# Build slike lokalno (Mac automatski radi za arm64)
docker build -t ticketing-api:local ./api
docker build -t ticketing-worker:local ./worker
docker build -t ticketing-frontend:local ./frontend

# Učitaj direktno u kind cluster (zaobiđi registry)
kind load docker-image ticketing-api:local --name ticketing-cluster
kind load docker-image ticketing-worker:local --name ticketing-cluster
kind load docker-image ticketing-frontend:local --name ticketing-cluster

# Upgrade Helm chart s lokalnim slikama
helm upgrade ticketing . \
  --namespace ticketing \
  --set api.image.repository=ticketing-api \
  --set api.image.tag=local \
  --set worker.image.repository=ticketing-worker \
  --set worker.image.tag=local \
  --set frontend.image.repository=ticketing-frontend \
  --set frontend.image.tag=local \
  --set global.imagePullPolicy=Never
```

#### Preventiva (trajno)

Nadogradi CI/CD pipeline na **multi-arch build** s Docker Buildx-om:

```yaml
# .github/workflows/ci.yaml
- name: Set up QEMU
  uses: docker/setup-qemu-action@v3

- name: Set up Docker Buildx
  uses: docker/setup-buildx-action@v3

- name: Build and push multi-arch image
  uses: docker/build-push-action@v6
  with:
    context: ./${{ matrix.service }}
    platforms: linux/amd64,linux/arm64
    push: true
    tags: ${{ steps.meta.outputs.tags }}
```

QEMU + Buildx omogućava emulaciju arhitektura u jednom workflow-u.

#### Reference

- Pipeline run gdje je problem detektiran: Pipeline #10
- Multi-arch fix commit: [TBD nakon implementacije]
- Docker dokumentacija: https://docs.docker.com/build/building/multi-platform/

---

### 4.2 Env var naming mismatch (PORT vs API_PORT)

#### Simptom
Pod-ovi ulaze u `CrashLoopBackOff` odmah po pokretanju. Aplikacija puca pri startu:

```bash
$ kubectl logs -n ticketing api-XXX --tail=10

Failed to start API: RangeError [ERR_SOCKET_BAD_PORT]:
  options.port should be >= 0 and < 65536. Received type number (NaN).
    at Server.listen (node:net:2059:5)
```

#### Dijagnostika

```bash
# 1. Provjeri da kontejner ima env varijablu
kubectl exec -n ticketing api-XXX -- env | grep -i port

# Ako CrashLoopBackOff sprječava exec, provjeri Deployment spec:
kubectl get deployment api -n ticketing -o yaml | grep -A 3 "name: PORT"

# 2. Provjeri što aplikacija OČEKUJE (source code u slici)
docker run --rm ticketing-api:dev cat /app/src/server.js | grep -i "port\|listen"

# Output:
# const port = Number(process.env.API_PORT || 8080);
#                              ^^^^^^^^
#                              Aplikacija očekuje API_PORT, ne PORT!
```

#### Korijenski uzrok

Aplikacija (naslijeđena iz Faze 1) koristi **specifične** env var nazive:
- `API_PORT` (ne generički `PORT`)
- `FRONTEND_PORT` (ne generički `PORT`)

Docker Compose deklaracija u Fazi 1 koristila je iste specifične nazive. Tijekom migracije na Kubernetes, koristio se generički `PORT` iz Helm šablona, što je rezultiralo nedostatkom očekivane env varijable u podu. Posljedica: `parseInt(undefined) = NaN`, koji puca pri `app.listen(NaN)`.

#### Mitigation

Ažuriraj `values.yaml` s ispravnim env var nazivima:

```yaml
api:
  env:
    NODE_ENV: production
    API_PORT: "8080"        # NE 'PORT'

frontend:
  env:
    NODE_ENV: production
    FRONTEND_PORT: "3000"   # NE 'PORT'
    API_BASE_URL: "http://api.ticketing.svc.cluster.local:8080"
```

I u `api-deployment.yaml`:
```yaml
- name: API_PORT                        # NE 'PORT'
  value: {{ .Values.api.env.API_PORT | quote }}
```

`helm upgrade` automatski rolling update-a podove. Logovi sada pokazuju `API listening on port 8080`.

#### Preventiva

1. **Provjeri source code prije pisanja K8s manifest-a** — uvijek pogledaj koje env varijable aplikacija stvarno čita:
   ```bash
   grep -r "process.env\." ./api/src
   ```

2. **Standardiziraj naming convention u source kodu** — koristi generičke nazive (`PORT`, `LOG_LEVEL`) umjesto specifičnih (`API_PORT`). Trebao bi biti dio code review-a.

3. **Validation na startup-u** — aplikacija bi trebala fail-fast s jasnom porukom ako ključna env varijabla nedostaje:
   ```javascript
   const port = process.env.API_PORT;
   if (!port) throw new Error("API_PORT must be set");
   ```

#### Reference

- Commit s fix-om: `helm upgrade revision 3`
- Source kod referenca: `api/src/server.js:32`
- Faza 1 compose: `compose.yaml` (originalno koristio `API_PORT`)

---

### 4.3 Database schema nije inicijalizirana

#### Simptom
API vraća 500 grešku pri čitanju narudžbi:

```bash
$ curl http://localhost:8080/tickets/orders
{"error":"Unable to read orders",
 "details":"relation \"ticket_orders\" does not exist"}
```

Worker insertira u Redis queue, ali ne piše u Postgres. POST `/tickets/purchase` "uspijeva" (vraća order_id), ali GET `/tickets/orders` puca.

#### Dijagnostika

```bash
# 1. Provjeri da li tablica uopće postoji
kubectl exec -n ticketing postgres-0 -- psql -U ticketing -d tickets -c "\dt"

# Output:
# Did not find any relations.   ← TABLICA NE POSTOJI

# 2. Provjeri postoji li init.sql u repu
find . -name "*.sql" -not -path "*/node_modules/*"
# Output: ./infra/postgres/init.sql

# 3. Provjeri kako je u Compose-u bilo namješteno
grep -A 5 "init.sql" compose.yaml
# - ./infra/postgres/init.sql:/docker-entrypoint-initdb.d/init.sql:ro

# 4. Provjeri da Postgres pod NEMA mount za init.sql
kubectl describe pod postgres-0 -n ticketing | grep -i "mount\|volume"
# Postoji samo postgres-data PVC, nema init script
```

#### Korijenski uzrok

Docker Compose imao je volume mapiranje `./infra/postgres/init.sql:/docker-entrypoint-initdb.d/init.sql:ro` koje **automatski izvršava SQL pri prvom pokretanju** Postgres image-a.

Tijekom migracije na Kubernetes, ovo mapiranje **nije bilo replicirano**. PostgreSQL StatefulSet je radio, ali baza je bila prazna — bez `ticket_orders` tablice.

#### Mitigation

1. **Kreiraj ConfigMap iz init.sql-a**:
```yaml
# k8s/ticketing/templates/postgres-init-configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: postgres-init
data:
  init.sql: |
    CREATE TABLE IF NOT EXISTS ticket_orders (
        id SERIAL PRIMARY KEY,
        order_id TEXT UNIQUE NOT NULL,
        event_id TEXT NOT NULL,
        customer_email TEXT NOT NULL,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        status TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_ticket_orders_created_at
      ON ticket_orders (created_at DESC);
```

2. **Mount-aj u StatefulSet** (`/docker-entrypoint-initdb.d/`):
```yaml
volumeMounts:
  - name: postgres-init
    mountPath: /docker-entrypoint-initdb.d
    readOnly: true
volumes:
  - name: postgres-init
    configMap:
      name: postgres-init
```

3. **Reset Postgres PVC** (init.sql ide samo pri **prvom** pokretanju):
```bash
kubectl scale statefulset postgres -n ticketing --replicas=0
kubectl wait --for=delete pod postgres-0 -n ticketing --timeout=60s
kubectl delete pvc -n ticketing postgres-data-postgres-0
helm upgrade ticketing . [...]
```

4. **Verifikacija**:
```bash
kubectl exec -n ticketing postgres-0 -- psql -U ticketing -d tickets -c "\dt"
# Output sad pokazuje: ticket_orders | table | ticketing  ✅
```

#### Preventiva

**Trajno rješenje za produkciju**: implementiraj **database migration tool** umjesto init scripta:

| Pristup | Pros | Cons |
|---|---|---|
| `init.sql` u ConfigMap | Jednostavno | Ne radi kad već postoje podaci |
| Migration tool (Flyway, Liquibase) | Versionirane migracije | Veća kompleksnost |
| Aplikacijska migration | Auto-bootstrap | Concurrent issues |

Za projekt ovog opsega init.sql je OK, ali u produkciji **Flyway** kao K8s Job koji se izvršava prije svakog deploy-a je standardni pristup.

#### Reference

- ConfigMap template: `k8s/ticketing/templates/postgres-init-configmap.yaml`
- StatefulSet izmjene: `k8s/ticketing/templates/postgres-statefulset.yaml`
- Postgres docker-entrypoint-initdb.d: https://hub.docker.com/_/postgres

---

### 4.4 Ingress connection reset na macOS-u

#### Simptom
HTTP zahtjev preko host porta 80 vraća `Connection reset by peer`:

```bash
$ curl -v http://localhost/healthz
* Connected to localhost (127.0.0.1) port 80
> GET /healthz HTTP/1.1
> Host: localhost
* Recv failure: Connection reset by peer
curl: (56) Recv failure: Connection reset by peer
```

Ali zahtjev iz unutar cluster-a radi:
```bash
$ kubectl run test-c --rm -i --restart=Never \
    --image=curlimages/curl --namespace=ingress-nginx \
    -- curl -s -H "Host: localhost" \
       http://ingress-nginx-controller/healthz
{"status":"ok","service":"api"}   ← Radi unutar cluster-a
```

#### Dijagnostika

Sistematska provjera od najnižeg sloja prema gore:

```bash
# 1. Aplikacija direktno (port-forward na Service)
kubectl port-forward -n ticketing svc/api 8080:8080 &
curl http://localhost:8080/healthz
# ✅ Radi - aplikacija je OK

# 2. Frontend Service
kubectl port-forward -n ticketing svc/frontend 3000:3000 &
curl http://localhost:3000/
# ✅ Radi - service je OK

# 3. Ingress controller iznutra
kubectl run test-c --rm -i --image=curlimages/curl --namespace=ingress-nginx \
  -- curl -s -H "Host: localhost" http://ingress-nginx-controller/healthz
# ✅ Radi - ingress je OK

# 4. Host port mapping
docker port ticketing-cluster-control-plane
# 80/tcp -> 0.0.0.0:80   ← Mapping postoji
# 443/tcp -> 0.0.0.0:443

# 5. Ali curl s host-a na port 80
curl -v http://localhost/healthz
# ❌ Connection reset by peer

# Zaključak: sve INTERNO radi, ali macOS ne propušta na port 80
```

#### Korijenski uzrok

Docker Desktop na **Apple Silicon Mac-ovima** koristi **VirtualizationFramework + VirtioFS** umjesto nativnog Docker daemon-a. Specifični edge-case je port forwarding za **privilegirane portove (1-1024)** koji ponekad propada bez jasne greške — TCP handshake prolazi, ali HTTP request handler na strani Docker Desktop networking layer-a vraća reset.

Ovo NIJE Kubernetes problem niti aplikacijski problem — problem je u **Docker Desktop networking-u na M-čip Mac-u**.

#### Mitigation

Tri opcije, sve rade:

**Opcija 1: kubectl port-forward (preporučeno za demo)**
```bash
kubectl port-forward -n ingress-nginx svc/ingress-nginx-controller 8080:80 &
curl http://localhost:8080/healthz
# Otvori browser: http://localhost:8080
```

**Opcija 2: NodePort umjesto Ingress**
Promijeni Service type na `NodePort` i pristupaj direktno:
```yaml
service:
  type: NodePort
  nodePort: 30080
```

**Opcija 3: Promjena host porta u kind config-u**
```yaml
extraPortMappings:
  - containerPort: 80
    hostPort: 8081     # umjesto 80
```

Treba recreate kind cluster.

#### Preventiva

1. **Dokumentirati pretpostavke o radnom okruženju** — Linux runner-i nemaju ovaj problem.

2. **Multi-platform testing** u CI/CD — testirati na Linux runner-u prije release-a.

3. **Razmišljati o LoadBalancer-u** za produkciju (cloud K8s) — u cloud-u ovo nije problem.

#### Reference

- Docker Desktop issue tracker: https://github.com/docker/for-mac/issues
- kind networking: https://kind.sigs.k8s.io/docs/user/loadbalancer/

---

### 4.5 Push-then-scan anti-pattern

#### Simptom
GHCR registry sadrži slike s HIGH/CRITICAL ranjivostima, ali CI/CD pipeline je "uspio". Sigurnosni gate prepoznaje ranjivost **nakon** što su slike već javno dostupne u registry-u.

```
[CI/CD pipeline output]
✅ Build & push image to GHCR     (slika je već vani!)
❌ Trivy scan: 2 HIGH vulnerabilities
❌ Pipeline FAILED
```

#### Dijagnostika

Pregled redoslijeda koraka u `.github/workflows/ci.yaml`:

```yaml
# Loš redoslijed (push-then-scan):
- name: Build and push image to GHCR
  uses: docker/build-push-action@v6
  with:
    push: true

- name: Trivy quality gate
  uses: aquasecurity/trivy-action@v0.36.0
  with:
    image-ref: ghcr.io/.../api:sha-${{ github.sha }}
    exit-code: '1'
```

Trivy se izvršava **nakon** push-a. Pad gate-a ne uklanja sliku iz registry-a.

#### Korijenski uzrok

Anti-pattern u DevSecOps design-u pipeline-a. Sigurnosne provjere moraju **prethoditi** operativnim akcijama (push). Inače je registry kompromitiran čak i ako se merge spriječi.

#### Mitigation

Refaktor pipeline-a u **shift-left security** redoslijed:

```yaml
# Dobar redoslijed (scan-then-push):
- name: Build image locally
  uses: docker/build-push-action@v6
  with:
    load: true                          # Local Docker daemon, ne registry
    tags: ${{ matrix.service }}:scan

- name: Trivy SARIF (visibility)
  uses: aquasecurity/trivy-action@v0.36.0
  with:
    image-ref: ${{ matrix.service }}:scan
    format: sarif
    exit-code: '0'

- name: Upload SARIF
  uses: github/codeql-action/upload-sarif@v3
  if: always()

- name: Trivy quality gate (blocking)
  uses: aquasecurity/trivy-action@v0.36.0
  with:
    image-ref: ${{ matrix.service }}:scan
    severity: 'CRITICAL,HIGH'
    exit-code: '1'

- name: Push to GHCR (only if gate passed)
  if: github.event_name == 'push' && github.ref == 'refs/heads/main'
  uses: docker/build-push-action@v6
  with:
    context: ./${{ matrix.service }}
    push: true
    tags: ${{ steps.meta.outputs.tags }}
```

#### Preventiva

1. **Code review checklist** — uvijek pitati: "Da li sigurnosna provjera **prethodi** akciji koja može imati side effects?"

2. **Defense in depth** — ne oslanjaj se na jedan kontrol:
   - Build-time skeniranje (Trivy)
   - Runtime skeniranje (Falco, OPA)
   - Image signing (Cosign)
   - Admission controllers (Kyverno, Gatekeeper)

3. **Branch protection** — main grana zahtjeva passing CI prije merge-a.

#### Reference

- Commit s fix-om: `2a3d441`
- Pipeline #8 (failed): GitHub Actions historija
- Pipeline #9 (success): GitHub Actions historija
- Iteracija 3 u `docs/security/security-report.md`: sekcija 10

---

## 5. Korisne naredbe — cheatsheet

### Status check
```bash
# Najbrži pregled cijelog stanja
kubectl get all -n ticketing
helm status ticketing -n ticketing

# Sve podove s wide info
kubectl get pods -n ticketing -o wide

# Watch live promjene
kubectl get pods -n ticketing -w
```

### Logovi
```bash
# Trenutni logovi
kubectl logs -n ticketing <pod>

# Prošli kontejner (ako je crashed)
kubectl logs -n ticketing <pod> --previous

# Svi podovi servisa
kubectl logs -n ticketing -l app.kubernetes.io/component=api --tail=20

# Live tail
kubectl logs -n ticketing <pod> -f
```

### Debugging
```bash
# Detaljno o podu
kubectl describe pod -n ticketing <pod>

# Eventi - često sadrže pravi razlog
kubectl get events -n ticketing --sort-by='.lastTimestamp'

# Shell unutar poda
kubectl exec -it -n ticketing <pod> -- /bin/sh

# Test iz susjednog poda (network debug)
kubectl run test --rm -i --restart=Never \
  --image=curlimages/curl --namespace=ticketing \
  -- curl http://api:8080/healthz
```

### Networking
```bash
# Port-forward (zaobiđi Ingress)
kubectl port-forward -n ticketing svc/api 8080:8080

# DNS test iz cluster-a
kubectl run dnsutils --rm -i --restart=Never \
  --image=tutum/dnsutils --namespace=ticketing \
  -- nslookup postgres.ticketing.svc.cluster.local

# Service endpoints
kubectl get endpoints -n ticketing
```

### Helm operacije
```bash
# Status i historija
helm status ticketing -n ticketing
helm history ticketing -n ticketing

# Pregled što bi se promijenilo (dry-run)
helm upgrade ticketing . --namespace ticketing --dry-run

# Rollback
helm rollback ticketing <revision> -n ticketing

# Render bez instalacije (debug šablona)
helm template ticketing . | less
```

### Recovery operacije
```bash
# Reset jednog deployment-a (force pull)
kubectl rollout restart deployment <name> -n ticketing

# Recreate svih podova (rolling)
kubectl delete pods -n ticketing -l app.kubernetes.io/component=<comp>

# Scale na 0 i nazad (cold restart)
kubectl scale deployment <name> -n ticketing --replicas=0
kubectl scale deployment <name> -n ticketing --replicas=2

# Postgres reset (briše podatke!)
kubectl scale statefulset postgres -n ticketing --replicas=0
kubectl wait --for=delete pod postgres-0 -n ticketing
kubectl delete pvc -n ticketing postgres-data-postgres-0
helm upgrade ticketing . [...]
```

## 6. Eskalacija i pomoć

Ako runbook ne pokriva tvoj problem:

1. **Provjeri Iteracije 1-3** u `docs/security/security-report.md` — možda smo već prošli kroz sličan problem
2. **GitHub Issues** repozitorija — otvori novi issue s template-om "Bug report"
3. **Kubernetes oficijalna dokumentacija**: https://kubernetes.io/docs/concepts/
4. **Trivy dokumentacija**: https://trivy.dev/latest/

## 7. Verzioniranje runbook-a

| Verzija | Datum | Promjena | Autor |
|---|---|---|---|
| 1.0 | 2026-05-31 | Initial release s 5 scenarija | Marin Pavlović |

---

> **Princip**: Svaki novi incident → novi entry u runbook. Operativno znanje **mora** biti dokumentirano da preživi rotaciju ljudi.
