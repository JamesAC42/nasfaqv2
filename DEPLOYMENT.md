# NASFAQV2 Deployment & CI/CD Runbook

**Target:** `holo.nasfaq.biz` on DigitalOcean Kubernetes (DOKS)
**Registry:** GitHub Container Registry (`ghcr.io/jamesac42/*`)
**CI/CD:** GitHub Actions → GHCR → `kubectl rollout` on DOKS
**In scope:** [`api/`](api/), [`app-client/`](app-client/), [`holonews/`](holonews/), [`superchatscraper/`](superchatscraper/), [`ytscraper/`](ytscraper/)
**Explicitly out of scope:** [`client/`](client/) (the admin dashboard is not deployed here).

This runbook is prescriptive - every section gives you a concrete next step you can execute.

---

## Table of contents

1. [Architecture overview](#1-architecture-overview)
2. [DigitalOcean provisioning walkthrough](#2-digitalocean-provisioning-walkthrough)
3. [Cluster topology on DOKS](#3-cluster-topology-on-doks)
4. [Per-service deployment spec](#4-per-service-deployment-spec)
5. [Ingress, TLS, and routing](#5-ingress-tls-and-routing)
6. [Data layer (Managed Postgres + Redis)](#6-data-layer-managed-postgres--redis)
7. [Horizontal-scaling caveats from the audit](#7-horizontal-scaling-caveats-from-the-audit)
8. [Hardware sizing for thousands of concurrent users](#8-hardware-sizing-for-thousands-of-concurrent-users)
9. [CI/CD pipeline](#9-cicd-pipeline)
10. [Performance-test plan](#10-performance-test-plan)
11. [Cloudflare & DDoS protection](#11-cloudflare--ddos-protection)
12. [Pre-launch hardening checklist](#12-pre-launch-hardening-checklist)
13. [Ops runbook (day-2)](#13-ops-runbook-day-2)

> **First time here?** Start with §2 for the provisioning checklist, then §3 to create the cluster.

---

## 1. Architecture overview

```mermaid
flowchart LR
  Users((Users)) -->|"HTTPS/WSS holo.nasfaq.biz"| LB[DO Load Balancer]
  LB --> Ingress[ingress-nginx + cert-manager]
  Ingress -->|"/*"| AppClient[app-client Deployment HPA 2 to 6]
  Ingress -->|"/api/* and /api/*/ws"| ApiWeb[api-web Deployment HPA 2 to 8]
  subgraph Workers [Singletons replicas 1]
    ApiScheduler[api-scheduler]
    Holonews[holonews]
    Superchat[superchatscraper]
    Yt[ytscraper]
  end
  ApiWeb --> Redis[(Managed Redis)]
  ApiWeb --> Postgres[(Managed Postgres + TimescaleDB)]
  ApiScheduler --> Redis
  ApiScheduler --> Postgres
  Workers --> Redis
  Workers --> Postgres
  ApiWeb <-.pubsub.-> Redis
  Workers <-.pubsub.-> Redis
```

### Service summary

| Service | Image | Replicas | Scale mode | Public? | Port | Why |
|---|---|---|---|---|---|---|
| `app-client` | `ghcr.io/jamesac42/nasfaqv2-app-client` | 2–6 | HPA (CPU 60%) | yes (`/`) | 3000 | Stateless Next.js 16 App Router |
| `api-web` | `ghcr.io/jamesac42/nasfaqv2-api` | 2–8 | HPA (CPU 60% + custom WS-conn metric) | yes (`/api/*`, `/api/*/ws`) | 5067 | HTTP + WebSocket server, stateless w.r.t. Redis pub/sub |
| `api-scheduler` | `ghcr.io/jamesac42/nasfaqv2-api` | **1** | fixed | no | 5067 | Owns the 60 s market-settlement scheduler and the 30 s livestream snapshot loop |
| `holonews` | `ghcr.io/jamesac42/nasfaqv2-holonews` | **1** | fixed | no | – | 10-min 4chan + Gemini + S3 loop |
| `superchatscraper` | `ghcr.io/jamesac42/nasfaqv2-superchatscraper` | **1** | fixed | no | – | Daily Hololyzer scrape at configured local hour |
| `ytscraper` | `ghcr.io/jamesac42/nasfaqv2-ytscraper` | **1** | fixed | no | – | YouTube API daily scrape + live-viewer polling |

---

## 2. DigitalOcean provisioning walkthrough

Everything you need to click or run in DigitalOcean before any `kubectl apply`. Do these in order - later steps depend on earlier ones.

### 2.0 One-time account prep

1. Create (or log in to) a DigitalOcean account and add a **payment method**. Baseline spend (see §8) is ~$129/mo; set up **billing alerts** at $100 / $200 / $400 under **Billing → Alerts**.
2. Create a **Team** if you plan to invite collaborators (optional).
3. Install the CLI and auth once:

```bash
# Linux
cd /tmp && wget https://github.com/digitalocean/doctl/releases/download/v1.111.0/doctl-1.111.0-linux-amd64.tar.gz
tar xf doctl-1.111.0-linux-amd64.tar.gz && sudo mv doctl /usr/local/bin
doctl auth init   # paste a Personal Access Token with read+write
doctl account get # sanity check
```

4. Generate a **Personal Access Token** at **API → Tokens** with `read` + `write` scopes named `gh-actions-nasfaq`. Save it as the `DIGITALOCEAN_ACCESS_TOKEN` GitHub Actions secret (used in §9).
5. Upload your SSH public key at **Settings → Security → SSH keys** (only needed if you later want to create droplets for one-off ops work).

### 2.1 Create a Project to group everything

Projects in DO are just organizational tags, but they make billing and resource-listing much cleaner.

```bash
doctl projects create --name nasfaq-prod \
  --purpose "Web Application" \
  --environment Production \
  --description "NASFAQ v2 public production stack"
```

Keep the project ID handy - we'll move resources into it as we create them.

### 2.2 Create a VPC (private network)

Put DOKS, Managed Postgres, and Managed Redis in the **same VPC** so they can talk over private IPs only. This is cheaper (no public egress) and faster.

```bash
doctl vpcs create \
  --name nasfaq-prod-vpc \
  --region nyc3 \
  --ip-range 10.110.0.0/20
```

Record the VPC UUID - every resource below references it with `--vpc-uuid`.

### 2.3 Create the DOKS cluster

This is the compute plane. Creation takes ~5 minutes.

```bash
doctl kubernetes cluster create nasfaq-prod \
  --region nyc3 \
  --version latest \
  --vpc-uuid <nasfaq-prod-vpc-uuid> \
  --node-pool "name=default;size=s-2vcpu-4gb;count=3;auto-scale=true;min-nodes=3;max-nodes=6" \
  --ha=false \
  --surge-upgrade=true \
  --maintenance-window "sunday=08:00" \
  --tag nasfaq
```

Notes on the knobs:
- `--ha=false` saves $40/mo. Flip to `true` before large events if you need >99.95% control-plane uptime.
- `--surge-upgrade=true` lets DOKS spin up extra nodes during upgrades so we don't have to drain and squeeze.
- `s-2vcpu-4gb` ($12/node/mo) matches the sizing math in §8. Start with 3, let autoscaler go to 6.

Pull the kubeconfig once:

```bash
doctl kubernetes cluster kubeconfig save nasfaq-prod
kubectl get nodes                 # 3 Ready nodes
kubectl create namespace nasfaq
```

Move it into the project:

```bash
doctl projects resources assign <project-id> \
  --resource="do:kubernetes:$(doctl kubernetes cluster get nasfaq-prod --format ID --no-header)"
```

### 2.4 Create Managed Postgres (with TimescaleDB)

```bash
doctl databases create nasfaq-pg \
  --engine pg --version 16 \
  --region nyc3 \
  --size db-s-2vcpu-4gb \
  --num-nodes 1 \
  --private-network-uuid <nasfaq-prod-vpc-uuid>

# Lock it to the cluster only (no public ingress)
PG_ID=$(doctl databases list --format ID,Name --no-header | awk '/nasfaq-pg/{print $1}')
CLUSTER_ID=$(doctl kubernetes cluster get nasfaq-prod --format ID --no-header)
doctl databases firewalls append "$PG_ID" --rule "k8s:$CLUSTER_ID"
```

Then enable TimescaleDB (required by [`ytscraper/internal/db/schema.sql`](ytscraper/internal/db/schema.sql)). Grab the **private** connection string from **Databases → nasfaq-pg → Connection Details → VPC Network**:

```bash
psql "postgresql://doadmin:...@private-nasfaq-pg-do-user-...:25060/defaultdb?sslmode=require" <<'SQL'
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
SQL
```

What to turn on in the DO UI:
- **Backups**: daily automatic + **PITR enabled** (free, just checkbox).
- **Standby node**: skip for now; add when you're past ~1k CCU for HA.
- **Connection pooler**: not needed yet; we use `pg.Pool` in the app. If/when we introduce PgBouncer, we can add DO's built-in pooler instead.

### 2.5 Create Managed Redis

```bash
doctl databases create nasfaq-redis \
  --engine redis --version 7 \
  --region nyc3 \
  --size db-s-1vcpu-1gb \
  --num-nodes 1 \
  --private-network-uuid <nasfaq-prod-vpc-uuid>

REDIS_ID=$(doctl databases list --format ID,Name --no-header | awk '/nasfaq-redis/{print $1}')
doctl databases firewalls append "$REDIS_ID" --rule "k8s:$CLUSTER_ID"
```

Grab the **private** `rediss://` connection string and save as the `REDIS_URL` secret later.

DO's managed Redis has **eviction policy = `noeviction`** by default. Change it to `allkeys-lru` under **Databases → nasfaq-redis → Settings → Eviction Policy** because the API uses Redis as a cache in [`api/src/services/marketCache.js`](api/src/services/marketCache.js); running out of memory with `noeviction` would 503 the cache path.

### 2.6 Object storage for images (pick one)

The audit shows [`api/`](api/) and [`holonews/`](holonews/) both write to an S3 bucket via `AWS_SW_BUCKET`. You have two options:

- **Stay on AWS S3** (what the code does today). No DO provisioning needed; just re-use the existing IAM creds as a k8s Secret.
- **Migrate to DO Spaces** (S3-compatible, ~$5/mo for 250 GiB + CDN). Create it with:

```bash
doctl spaces create nasfaq-media --region nyc3
# create an access key under API → Spaces Keys
```

Because the clients use the AWS SDK, switching to Spaces only needs an override:

```
AWS_ACCESS_KEY_ID=<spaces-key>
AWS_SECRET_ACCESS_KEY=<spaces-secret>
AWS_REGION=nyc3
AWS_SW_BUCKET=nasfaq-media
AWS_ENDPOINT_URL=https://nyc3.digitaloceanspaces.com   # add support in code if adopting
```

For this runbook we assume S3 stays; Spaces is a future-cost optimization.

### 2.7 Load Balancer (auto-provisioned, but understand it)

When you install `ingress-nginx` in §3 with `service.type=LoadBalancer`, DOKS provisions a **DigitalOcean Load Balancer** (~$12/mo). You do **not** create it manually. To see it afterwards:

```bash
kubectl -n ingress-nginx get svc
doctl compute load-balancer list
```

DNS `A` records for `holo.nasfaq.biz` point to the LB's public IP - but we're going to hide that behind Cloudflare (§11), so the DO LB ends up private to Cloudflare's IP ranges.

Recommended LB annotations once created (add these to the ingress-nginx install in §3):

- `service.beta.kubernetes.io/do-loadbalancer-protocol: "https"`
- `service.beta.kubernetes.io/do-loadbalancer-enable-proxy-protocol: "true"` (lets nginx see the real Cloudflare IP)
- `service.beta.kubernetes.io/do-loadbalancer-name: "nasfaq-prod-lb"`

### 2.8 Cloud Firewall (belt and suspenders)

VPC already isolates the Managed DBs. Add a DO Cloud Firewall so worker nodes only accept traffic from the LB and only egress to the DBs + internet. This is defense-in-depth for when something tries to talk to a worker directly.

```bash
doctl compute firewall create \
  --name nasfaq-prod-workers \
  --inbound-rules "protocol:tcp,ports:1-65535,address:10.110.0.0/20 protocol:udp,ports:1-65535,address:10.110.0.0/20" \
  --outbound-rules "protocol:tcp,ports:all,address:0.0.0.0/0 protocol:udp,ports:all,address:0.0.0.0/0 protocol:icmp,address:0.0.0.0/0" \
  --tag-names k8s:$CLUSTER_ID
```

After Cloudflare is live (§11), tighten `inbound-rules` so public ingress only accepts 443 from **Cloudflare IPv4 ranges** — see §11 for the exact list.

### 2.9 Monitoring & Uptime

- **DO Monitoring agent**: already baked into DOKS nodes. Dashboards appear under **Monitoring → Droplets/K8s**.
- **Uptime checks** (free, 3 checks on all plans): **Monitoring → Uptime → Create check** targeting:
  - `https://holo.nasfaq.biz/api/health` (every 1 min, alert on 2 consecutive failures)
  - `https://holo.nasfaq.biz/` (Next.js homepage)
  - `wss://holo.nasfaq.biz/api/market/ws` (uses the DO uptime SSL check as a proxy; true WS health comes from the app's own metrics)
- **Alert policies**: **Monitoring → Alert Policies → Create** for: node CPU > 80% (5 min), node memory > 85%, DB connection utilization > 80%, DB disk > 80%, Redis memory > 80%. Route to email + Slack webhook.

### 2.10 Provisioning checklist

- [ ] DO Project `nasfaq-prod` exists and contains all resources below.
- [ ] VPC `nasfaq-prod-vpc` created in `nyc3`.
- [ ] DOKS cluster `nasfaq-prod` running with 3 nodes, autoscale 3-6, in the VPC.
- [ ] Managed Postgres `nasfaq-pg` running, firewall restricted to cluster, `timescaledb` + `pg_stat_statements` extensions installed, PITR on.
- [ ] Managed Redis `nasfaq-redis` running, firewall restricted to cluster, eviction policy `allkeys-lru`.
- [ ] S3 (AWS) or Spaces (DO) bucket decided; credentials ready for the `nasfaq-app-secrets` Secret.
- [ ] DO Cloud Firewall covers worker nodes.
- [ ] Uptime checks + alert policies created.
- [ ] `DIGITALOCEAN_ACCESS_TOKEN` in GitHub Actions secrets.
- [ ] `doctl projects resources assign` run for cluster + both DBs.

Total monthly cost at this point (no traffic yet): cluster **$36** + LB **$12** (after §3) + Postgres **$60** + Redis **$15** = **~$123/mo**.

---

## 3. Cluster topology on DOKS

> Cluster creation itself (`doctl kubernetes cluster create ...`) lives in §2.3. This section covers **in-cluster add-ons** you install after the cluster is up.

### Install cluster add-ons

```bash
# ingress-nginx (provisions the DO LoadBalancer)
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx \
  -n ingress-nginx --create-namespace \
  --set controller.service.type=LoadBalancer \
  --set controller.config.proxy-read-timeout="3600" \
  --set controller.config.proxy-send-timeout="3600" \
  --set controller.config.use-forwarded-headers="true" \
  --set controller.config.real-ip-header="CF-Connecting-IP" \
  --set controller.service.annotations."service\.beta\.kubernetes\.io/do-loadbalancer-name"="nasfaq-prod-lb" \
  --set controller.service.annotations."service\.beta\.kubernetes\.io/do-loadbalancer-enable-proxy-protocol"="true"

# cert-manager
helm repo add jetstack https://charts.jetstack.io
helm upgrade --install cert-manager jetstack/cert-manager \
  -n cert-manager --create-namespace --set installCRDs=true
```

Apply the ClusterIssuer:

```yaml
# deploy/k8s/cluster-issuer.yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: ops@nasfaq.biz
    privateKeySecretRef:
      name: letsencrypt-prod-account-key
    solvers:
      - http01:
          ingress:
            class: nginx
```

### DNS

Once the DO Load Balancer provisioned by ingress-nginx has an external IP, point Cloudflare at it (full setup in §11):

```
# In Cloudflare DNS for nasfaq.biz:
A   holo   <LB-IP>   Proxied (orange cloud)  TTL Auto
```

For initial bring-up you can DNS-Only (grey cloud) while you validate TLS issuance, then flip to Proxied.

---

## 4. Per-service deployment spec

All app manifests live under `deploy/k8s/` in this repo. Dockerfiles live alongside each service.

### 4.1 `api` image (shared by `api-web` and `api-scheduler`)

The same container image runs both; env vars flip behavior.

```dockerfile
# api/Dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY api/package.json api/package-lock.json* ./
RUN npm ci --omit=dev

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY api/ ./
# api/src/migrations.js reads ../../ytscraper/internal/db/schema.sql at runtime.
# Bake it in so the migration Job works without the full repo:
COPY ytscraper/internal/db/schema.sql /app/schema/ytscraper-schema.sql
ENV YT_SCHEMA_PATH=/app/schema/ytscraper-schema.sql
EXPOSE 5067
USER node
CMD ["node", "src/server.js"]
```

> **One small code change needed** in [`api/src/migrations.js`](api/src/migrations.js): respect `process.env.YT_SCHEMA_PATH` before falling back to the current relative path. File as a P0 follow-up PR alongside the deployment - it keeps the image self-contained.

#### `api-web` Deployment

```yaml
# deploy/k8s/api-web.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-web
  namespace: nasfaq
spec:
  replicas: 2
  selector: { matchLabels: { app: api-web } }
  template:
    metadata:
      labels: { app: api-web }
    spec:
      containers:
        - name: api
          image: ghcr.io/jamesac42/nasfaqv2-api:latest
          ports: [{ containerPort: 5067, name: http }]
          env:
            - { name: PORT, value: "5067" }
            - { name: ENABLE_MIGRATIONS, value: "false" }
            - { name: MARKET_SETTLEMENT_SCHEDULER_ENABLED, value: "false" }
            - { name: LIVESTREAM_SNAPSHOT_OWNER, value: "false" }
            - { name: CORS_ORIGIN, value: "https://holo.nasfaq.biz" }
            - { name: AUTH_COOKIE_SECURE, value: "true" }
            - { name: PG_POOL_MAX, value: "4" }
          envFrom:
            - secretRef: { name: nasfaq-app-secrets }
          readinessProbe:
            httpGet: { path: /api/health, port: 5067 }
            periodSeconds: 5
          livenessProbe:
            httpGet: { path: /api/health, port: 5067 }
            initialDelaySeconds: 30
            periodSeconds: 15
          resources:
            requests: { cpu: "500m", memory: "768Mi" }
            limits:   { cpu: "1",    memory: "1Gi"   }
      terminationGracePeriodSeconds: 30
---
apiVersion: v1
kind: Service
metadata:
  name: api-web
  namespace: nasfaq
spec:
  selector: { app: api-web }
  ports: [{ port: 80, targetPort: 5067, name: http }]
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api-web
  namespace: nasfaq
spec:
  scaleTargetRef: { apiVersion: apps/v1, kind: Deployment, name: api-web }
  minReplicas: 2
  maxReplicas: 8
  metrics:
    - type: Resource
      resource: { name: cpu, target: { type: Utilization, averageUtilization: 60 } }
```

#### `api-scheduler` Deployment (singleton)

Identical to `api-web` except:

```yaml
metadata: { name: api-scheduler }
spec:
  replicas: 1
  strategy: { type: Recreate }   # never two at once
  template:
    spec:
      containers:
        - name: api
          env:
            - { name: MARKET_SETTLEMENT_SCHEDULER_ENABLED, value: "true" }
            - { name: LIVESTREAM_SNAPSHOT_OWNER, value: "true" }
            # other env identical
```

> **Second small code change** in [`api/src/server.js`](api/src/server.js): gate the `setInterval(refreshSnapshot, 30_000)` call behind `process.env.LIVESTREAM_SNAPSHOT_OWNER === "true"`. Today every replica runs it, producing duplicate Redis `SCAN` load (documented in §7). P1.

#### Migration Job

Run as a pre-rollout step in CI (see §9):

```yaml
# deploy/k8s/api-migrate-job.yaml (templated by CI: ${SHA})
apiVersion: batch/v1
kind: Job
metadata:
  generateName: api-migrate-
  namespace: nasfaq
spec:
  backoffLimit: 1
  ttlSecondsAfterFinished: 600
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migrate
          image: ghcr.io/jamesac42/nasfaqv2-api:${SHA}
          env:
            - { name: ENABLE_MIGRATIONS, value: "true" }
            - { name: MARKET_SETTLEMENT_SCHEDULER_ENABLED, value: "false" }
            - { name: PORT, value: "5068" }
          envFrom: [{ secretRef: { name: nasfaq-app-secrets } }]
          command: ["node", "-e", "require('./src/migrations').applySchema(require('./src/db').getPool()).then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);})"]
```

### 4.2 `app-client` image

Enable standalone output first:

```ts
// app-client/next.config.ts
const nextConfig: NextConfig = {
  output: "standalone",
  // drop the rewrites() block for prod; ingress handles /api/*
};
```

```dockerfile
# app-client/Dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY app-client/package.json app-client/package-lock.json* ./
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY app-client/ ./
ENV NEXT_PUBLIC_API_BASE=""
ENV NEXT_PUBLIC_WS_API_BASE=""
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
USER node
CMD ["node", "server.js"]
```

Deployment is analogous to `api-web` but simpler (no WS, smaller resources):

```yaml
# deploy/k8s/app-client.yaml (excerpt)
resources:
  requests: { cpu: "200m", memory: "256Mi" }
  limits:   { cpu: "500m", memory: "512Mi" }
```

### 4.3 Go services (three singletons)

Shared Dockerfile template, parameterized by service name:

```dockerfile
# holonews/Dockerfile (and identical for superchatscraper, ytscraper with their own cmd path)
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.work go.work.sum* ./
COPY 4chanscraper 4chanscraper
COPY channelscraper channelscraper
COPY holonews holonews
COPY superchatscraper superchatscraper
COPY ytscraper ytscraper
WORKDIR /src/holonews
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /out/holonews ./cmd/holonews

FROM gcr.io/distroless/static-debian12
COPY --from=build /out/holonews /holonews
USER nonroot:nonroot
ENTRYPOINT ["/holonews"]
```

> Because of [`go.work`](go.work) we need to copy the whole workspace into the build stage. That keeps the final image tiny (distroless) while letting `go build` resolve the workspace.

Each Deployment is `replicas: 1` with `strategy: { type: Recreate }`:

```yaml
# deploy/k8s/holonews.yaml (excerpt)
spec:
  replicas: 1
  strategy: { type: Recreate }
  template:
    spec:
      containers:
        - name: holonews
          image: ghcr.io/jamesac42/nasfaqv2-holonews:latest
          envFrom:
            - secretRef: { name: nasfaq-app-secrets }
            - configMapRef: { name: nasfaq-app-config }
          resources:
            requests: { cpu: "100m", memory: "128Mi" }
            limits:   { cpu: "500m", memory: "512Mi" }
```

Same pattern for `superchatscraper` and `ytscraper`.

---

## 5. Ingress, TLS, and routing

```yaml
# deploy/k8s/ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: nasfaq
  namespace: nasfaq
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-body-size: "25m"
    nginx.ingress.kubernetes.io/configuration-snippet: |
      # Block /internal/* from the public internet entirely
      # (see hardening checklist #1)
      if ($request_uri ~* "^/internal/") { return 404; }
spec:
  ingressClassName: nginx
  tls:
    - hosts: [holo.nasfaq.biz]
      secretName: holo-nasfaq-biz-tls
  rules:
    - host: holo.nasfaq.biz
      http:
        paths:
          - path: /api
            pathType: Prefix
            backend: { service: { name: api-web, port: { number: 80 } } }
          - path: /
            pathType: Prefix
            backend: { service: { name: app-client, port: { number: 80 } } }
```

Notes:

- `ws`/`wss` upgrades are auto-handled by `ingress-nginx` - no annotation needed beyond the long read/send timeouts.
- **No sticky sessions required**: [`api/src/server.js`](api/src/server.js) fans out every chat/market/livestream event through Redis pub/sub, so any pod can broadcast to its local WS clients regardless of which pod received the publisher's request.
- The one WS caveat is `statsWss.online_count` (per-pod count). See P1 fix in §7.
- `/internal/*` must never be public; see §12.

---

## 6. Data layer (Managed Postgres + Redis)

### Provision (one-time)

```bash
# TimescaleDB is available as a DO Managed Postgres extension
doctl databases create nasfaq-pg \
  --engine pg --version 16 \
  --region nyc3 --size db-s-2vcpu-4gb --num-nodes 1

doctl databases create nasfaq-redis \
  --engine redis --version 7 \
  --region nyc3 --size db-s-1vcpu-1gb

# After creation:
doctl databases firewalls append <pg-id>    --rule k8s:<doks-cluster-id>
doctl databases firewalls append <redis-id> --rule k8s:<doks-cluster-id>
```

Connect once as admin and enable the extension:

```sql
CREATE EXTENSION IF NOT EXISTS timescaledb;
```

### Secrets

Bootstrap into a k8s Secret (one-off; not checked in):

```bash
kubectl -n nasfaq create secret generic nasfaq-app-secrets \
  --from-literal=DATABASE_URL='postgresql://doadmin:...@nasfaq-pg-do-user-...:25060/defaultdb?sslmode=require' \
  --from-literal=REDIS_URL='rediss://default:...@nasfaq-redis-do-user-...:25061' \
  --from-literal=YOUTUBE_API_KEY='...' \
  --from-literal=GEMINI_API_KEY='...' \
  --from-literal=AWS_ACCESS_KEY_ID='...' \
  --from-literal=AWS_SECRET_ACCESS_KEY='...' \
  --from-literal=AWS_REGION='us-east-1' \
  --from-literal=AWS_SW_BUCKET='nasfaq-media'
```

For long-term: install [sealed-secrets](https://github.com/bitnami-labs/sealed-secrets) and commit a `SealedSecret` so the cluster is reproducible from git.

### Connection-pool math

`api/src/db.js` opens `PG_POOL_MAX` conns per pod (default 10). With managed PG at 47-conn cap (2vCPU/4GB plan) and a headroom budget of 70%:

```
max_safe_conns   = 47 × 0.7           = 32
max_api_web_pods = 8 (HPA cap)
api_scheduler    = 1
migration_job    = occasionally adds 1

PG_POOL_MAX      = floor(32 / (8 + 1)) = 3   # conservative
                 = 4 (target, documented in manifest)
```

If you ever push past HPA max 8, put **PgBouncer** in front (as a Deployment + Service in-cluster, transaction pooling mode). That's a ~30-line manifest away.

---

## 7. Horizontal-scaling caveats from the audit

Straight from the [`api/`](api/) audit, roughly in priority order:

| # | Issue | Where | Fix class | Priority |
|---|---|---|---|---|
| 1 | `statsWss.online_count` is per-pod, not global | [`api/src/server.js`](api/src/server.js) | Back with Redis `INCR`/`DECR` on connect/disconnect + periodic broadcast | P1 |
| 2 | Livestream `setInterval(refreshSnapshot, 30s)` runs on every replica → duplicate Redis `SCAN` | [`api/src/server.js`](api/src/server.js) | Gate behind `LIVESTREAM_SNAPSHOT_OWNER=true`; only `api-scheduler` sets it | P0 (blocks clean scale-out) |
| 3 | `UPDATE market.user_sessions SET last_seen_at = now()` on **every** authenticated request | [`api/src/services/auth.js`](api/src/services/auth.js) lines 229–271 | Throttle per session via Redis (`SET EX 30` guard) | P1 - real bottleneck >1k CCU |
| 4 | Chat `subscribe` calls `ensureChatTopology` in a per-channel loop | [`api/src/server.js`](api/src/server.js) ~461–476 | Call once at startup or cache result in-memory | P1 |
| 5 | `/internal/market/*` has no auth | [`api/src/server.js`](api/src/server.js) | Block at ingress (done in §5) + add route-level guard | P0 security |
| 6 | `POST/PUT/DELETE /api/channels/*` unprotected | [`api/src/routes/channels.js`](api/src/routes/channels.js) | Add `requireAdmin` | P0 security |
| 7 | Startup work (`applySchema`, catalog syncs) on every cold start | [`api/src/server.js`](api/src/server.js) `main()` | Already split: pods run with `ENABLE_MIGRATIONS=false`; the Job handles schema | Done by manifest |
| 8 | WS broadcast is single-threaded per pod | [`api/src/server.js`](api/src/server.js) | Scale out via HPA - covered by manifest | Operational |

P0 items (#2, #5, #6) should land in the same PR as the Dockerfile/manifests. P1 items are follow-ups that the runbook tracks.

---

## 8. Hardware sizing for thousands of concurrent users

We size to **"hit ~3,000 concurrent WS users with headroom to 5,000"**, which is a reasonable read of "thousands".

### Per-pod baselines (measured rules of thumb)

- `ws` + Node: ~50–80 KiB RAM per idle WS connection, ~1 vCPU saturates around 40–60 k broadcast msgs/s of ~1 KiB payloads.
- Express hot paths from audit are mostly cached via Redis within a 5 s TTL, so CPU cost per request is dominated by JSON serialization + pg round-trips.

### Pod sizing

| Workload | Requests | Limits | Replicas (steady / peak) | Rationale |
|---|---|---|---|---|
| `api-web` | 500m / 768Mi | 1000m / 1Gi | 3 / 8 | ~1k WS clients per pod + headroom for bursts |
| `api-scheduler` | 250m / 512Mi | 500m / 1Gi | 1 / 1 | One-off scheduler + snapshot loop |
| `app-client` | 200m / 256Mi | 500m / 512Mi | 2 / 4 | SSR is light; App Router streams |
| `holonews` | 100m / 128Mi | 500m / 512Mi | 1 / 1 | 10 min poll, burst for Gemini + sharp |
| `superchatscraper` | 50m / 64Mi | 200m / 256Mi | 1 / 1 | Daily schedule |
| `ytscraper` | 100m / 128Mi | 500m / 512Mi | 1 / 1 | Live-viewer polling adds sustained load |
| `ingress-nginx` | 250m / 256Mi | 500m / 512Mi | 2 (HA) | DO LB sits in front |

### Node pool

At peak the requests sum to roughly **5.3 vCPU / 7 GiB**. With 20% kube overhead and room for the HPA peak (`api-web` 8 × 0.5 + 1 GiB = 4 vCPU / 8 GiB), plan for:

- **Steady state:** 3 × `s-2vcpu-4gb` (6 vCPU / 12 GiB) = **$42/mo**
- **Peak:** autoscaler to 6 × `s-2vcpu-4gb` = $84/mo, typically only needed for market-event spikes.

### Data tier

- Managed Postgres `db-s-2vcpu-4gb` (~$60/mo) with daily backups. Upgrade vertically to `db-s-4vcpu-8gb` (~$120/mo) before hitting 5k CCU; the `last_seen_at` write-amp (§7 #3) is the first wall you hit if you don't ship the throttle fix.
- Managed Redis `db-s-1vcpu-1gb` (~$15/mo). Pub/sub + cache footprint from the audit is well under 100 MiB.

### Totals

| Tier | Monthly |
|---|---|
| DOKS control plane | $0 (DO free) |
| 3 × node pool | $42 |
| Managed Postgres | $60 |
| Managed Redis | $15 |
| DO Load Balancer | $12 |
| Container Registry (GHCR) | $0 (public/private included) |
| **Baseline** | **~$129/mo** |
| Peak (6 nodes, larger PG) | ~$245/mo |

---

## 9. CI/CD pipeline

GitHub Actions workflows live at `.github/workflows/`. Two files, two jobs each.

### Secrets required on the repo

| GH Actions Secret | Purpose |
|---|---|
| `DIGITALOCEAN_ACCESS_TOKEN` | `doctl` auth to fetch kubeconfig |
| `DOKS_CLUSTER_NAME` | e.g. `nasfaq-prod` |
| `GHCR_TOKEN` | PAT with `write:packages` (or use `GITHUB_TOKEN` - it works for GHCR inside the same org) |

### `ci.yml` — run on every PR

```yaml
# .github/workflows/ci.yml
name: ci
on:
  pull_request:
    branches: [main]
jobs:
  node:
    runs-on: ubuntu-latest
    strategy: { matrix: { app: [api, app-client] } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20", cache: npm, cache-dependency-path: ${{ matrix.app }}/package-lock.json }
      - run: npm ci
        working-directory: ${{ matrix.app }}
      - run: npm run build --if-present
        working-directory: ${{ matrix.app }}

  go:
    runs-on: ubuntu-latest
    strategy: { matrix: { svc: [holonews, superchatscraper, ytscraper] } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: "1.25" }
      - run: go build ./cmd/${{ matrix.svc }}
        working-directory: ${{ matrix.svc }}
      - run: go vet ./...
        working-directory: ${{ matrix.svc }}
```

### `deploy.yml` — build, push, migrate, roll out

```yaml
# .github/workflows/deploy.yml
name: deploy
on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  packages: write

env:
  REGISTRY: ghcr.io
  IMAGE_OWNER: jamesac42

jobs:
  build:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        include:
          - { name: api,              context: ".", dockerfile: api/Dockerfile }
          - { name: app-client,       context: ".", dockerfile: app-client/Dockerfile }
          - { name: holonews,         context: ".", dockerfile: holonews/Dockerfile }
          - { name: superchatscraper, context: ".", dockerfile: superchatscraper/Dockerfile }
          - { name: ytscraper,        context: ".", dockerfile: ytscraper/Dockerfile }
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v5
        with:
          context: ${{ matrix.context }}
          file: ${{ matrix.dockerfile }}
          push: true
          cache-from: type=gha,scope=${{ matrix.name }}
          cache-to: type=gha,mode=max,scope=${{ matrix.name }}
          tags: |
            ${{ env.REGISTRY }}/${{ env.IMAGE_OWNER }}/nasfaqv2-${{ matrix.name }}:sha-${{ github.sha }}
            ${{ env.REGISTRY }}/${{ env.IMAGE_OWNER }}/nasfaqv2-${{ matrix.name }}:latest

  deploy:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: digitalocean/action-doctl@v2
        with: { token: ${{ secrets.DIGITALOCEAN_ACCESS_TOKEN }} }
      - run: doctl kubernetes cluster kubeconfig save ${{ secrets.DOKS_CLUSTER_NAME }}

      - name: Apply manifests
        run: kubectl apply -n nasfaq -f deploy/k8s/

      - name: Run migrations (Job)
        run: |
          sed "s|\${SHA}|sha-${{ github.sha }}|" deploy/k8s/api-migrate-job.yaml \
            | kubectl apply -n nasfaq -f -
          JOB=$(kubectl -n nasfaq get job -l job-name -o name | head -1)
          kubectl -n nasfaq wait --for=condition=complete --timeout=300s $JOB

      - name: Roll images
        run: |
          TAG=sha-${{ github.sha }}
          for dep in api-web api-scheduler app-client holonews superchatscraper ytscraper; do
            case "$dep" in
              api-web|api-scheduler) IMG="nasfaqv2-api" ;;
              *) IMG="nasfaqv2-$dep" ;;
            esac
            kubectl -n nasfaq set image deploy/$dep $dep=ghcr.io/jamesac42/$IMG:$TAG
          done
          for dep in api-web api-scheduler app-client holonews superchatscraper ytscraper; do
            kubectl -n nasfaq rollout status deploy/$dep --timeout=300s
          done
```

### Operational notes

- Images are tagged with the git SHA so rollbacks are deterministic: `kubectl -n nasfaq set image deploy/api-web api=ghcr.io/jamesac42/nasfaqv2-api:sha-<prev>`.
- The migration Job runs against **the new image** before pods roll, so schema changes land first.
- Set `deploy.yml` to require PR status checks from `ci.yml` (branch protection on `main`).
- For bigger changes, cut a `preview` branch → staging namespace `nasfaq-stage` backed by a Postgres read replica or ephemeral DB.

---

## 10. Performance-test plan

All tests run against a **staging ingress** (separate DOKS namespace) or port-forwarded services. Each test maps to an audit hotspot.

### 10.1 Tooling

- [`k6`](https://k6.io) for HTTP + mixed scenarios.
- [`artillery`](https://artillery.io) for WebSocket fan-out (better WS ergonomics than k6).
- `kubectl top pods` + DO metrics + `pg_stat_statements` to read results.

```bash
# install once
brew install k6 artillery
# enable pg_stat_statements on managed PG
psql "$DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;"
```

### 10.2 Test matrix

| # | Target | Why (audit) | Shape | Pass criteria |
|---|---|---|---|---|
| T1 | `GET /api/market/hub` | Heaviest market read | k6, ramp 0→500 VU over 2m, hold 5m | P99 < 400 ms; error < 1% |
| T2 | `GET /api/market/assets` (hot & cold Redis) | 5 s cache TTL in [`api/src/services/marketCache.js`](api/src/services/marketCache.js) | k6 two runs: warm + after `FLUSHDB` | Cold P99 < 800 ms; Hot P99 < 150 ms |
| T3 | `GET /api/market/rankings` | Multiple ranking queries | k6, 200 VU, 3m | P99 < 500 ms |
| T4 | `GET /api/news` | Complex SQL with ILIKE/EXISTS/LATERAL in [`api/src/db.js`](api/src/db.js) | k6, 100 VU, pages 1–10 | P99 < 600 ms; no seq-scans on >10k rows in `EXPLAIN` |
| T5 | `POST /api/market/orders/buy` + `/sell` | Transactional contention, lock waits | k6 mixed 50/50 at 50 → 200 RPS, 100 seeded users | Zero deadlocks; lock waits `< 50 ms` P95 (`pg_stat_activity`) |
| T6 | `POST /api/prediction-markets/:slug/orders` | Heaviest tx in [`api/src/services/predictionOrderbook.js`](api/src/services/predictionOrderbook.js) | k6, 20 → 80 RPS, single market | P99 latency stable across load |
| T7 | WS fan-out on `/api/market/ws` + `/api/chat/ws` | Broadcast loop is per-pod single-thread | Artillery: 500 → 1k → 3k → 5k concurrent clients while a generator publishes 20 msg/s to `nasfaq_market:events` | Broadcast-to-receive P99 < 500 ms at 3k; pod CPU < 80% |
| T8 | Authed-browse soak | `last_seen_at` write amplification ([`api/src/services/auth.js`](api/src/services/auth.js)) | k6 1k VU cookie'd clients hitting `/api/portfolio/me` for 30 min | PG write TPS flat, not linearly growing with VU count (proves throttle fix works if shipped) |
| T9 | Chat `subscribe` storm | `ensureChatTopology` N-loop | Artillery: 500 clients each subscribing to 5 channels simultaneously | Connect-to-ready P99 < 1 s |
| T10 | Full-site mixed | Realistic traffic shape | k6 scenarios mixing T1+T3+T5+T7 at 30/40/20/10% ratios for 30 min | No alerts fire; HPA settles between 4 and 6 pods |

### 10.3 Sample k6 script (T5, mutating)

```js
// perf/t5-market-orders.js
import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  scenarios: {
    buys:  { executor: "constant-arrival-rate", rate: 50, timeUnit: "1s", duration: "5m", preAllocatedVUs: 50, exec: "buy" },
    sells: { executor: "constant-arrival-rate", rate: 50, timeUnit: "1s", duration: "5m", preAllocatedVUs: 50, exec: "sell" },
  },
  thresholds: {
    http_req_failed:   ["rate<0.01"],
    http_req_duration: ["p(99)<600"],
  },
};

const BASE = __ENV.BASE || "https://staging.holo.nasfaq.biz";
const USERS = JSON.parse(open("./users.json")); // [{ cookie, assetId }]

function post(path, body, cookie) {
  return http.post(`${BASE}${path}`, JSON.stringify(body), {
    headers: { "Content-Type": "application/json", Cookie: `nasfaq_session=${cookie}` },
  });
}

export function buy()  { const u = USERS[Math.floor(Math.random()*USERS.length)];
  check(post("/api/market/orders/buy",  { assetId: u.assetId, quantity: 1 }, u.cookie), { "200": r => r.status === 200 }); sleep(1); }
export function sell() { const u = USERS[Math.floor(Math.random()*USERS.length)];
  check(post("/api/market/orders/sell", { assetId: u.assetId, quantity: 1 }, u.cookie), { "200": r => r.status === 200 }); sleep(1); }
```

### 10.4 Sample Artillery WS script (T7)

```yaml
# perf/t7-ws-marketfanout.yml
config:
  target: "wss://staging.holo.nasfaq.biz"
  phases:
    - { duration: 60,  arrivalRate: 20  }   # 0 → 1200 VU
    - { duration: 120, arrivalRate: 50  }   # 1200 → 7200 cap by pool
  engines: { ws: {} }
scenarios:
  - engine: ws
    flow:
      - connect: { path: "/api/market/ws" }
      - loop: [ { think: 60 } ]
        count: 10
```

Run generator separately: `redis-cli -u "$REDIS_URL" -r 0 -i 0.05 PUBLISH nasfaq_market:events '{"type":"tick","ts":0}'`.

### 10.5 Reading results → remediation

| Symptom | Likely cause | Fix |
|---|---|---|
| T1/T3 P99 climbs with cache warm | Query plan regression | Check `pg_stat_statements`, add index |
| T5 deadlocks | Transaction ordering | Sort lock acquisition; shorten tx |
| T7 broadcast latency spikes at 3k | Single-thread WS loop saturated | Bump `api-web` HPA max or split WS namespaces by path |
| T8 PG write TPS grows linearly | `last_seen_at` throttle not shipped | Ship P1 fix #3 from §7 |
| T2 cold P99 > 2 s | Heavy uncached path | Lengthen TTL or precompute at scheduler |

---

## 11. Cloudflare & DDoS protection

Cloudflare sits between the public internet and the DO Load Balancer. It terminates TLS at the edge, absorbs L3/L4 DDoS (unmetered on every plan), adds L7 protections (rate limiting, WAF, bot detection), and caches static assets. The origin (DO LB) then only accepts traffic from Cloudflare IPs.

```mermaid
flowchart LR
  User((User)) -->|"HTTPS/WSS"| CF[Cloudflare edge]
  CF -->|"Proxied, real IP in CF-Connecting-IP"| DOLB[DO Load Balancer]
  DOLB --> Ingress[ingress-nginx]
  Ingress --> Pods[app-client and api-web]
```

### 11.1 Plan choice

| Plan | $/mo | What we get that matters |
|---|---|---|
| **Free** | 0 | Unmetered L3/4 DDoS, free SSL, universal SSL cert, WebSocket proxying, 5 page rules, **1 rate-limit rule**, basic bot fight mode |
| **Pro** | $25 | Image optimization, **20 page rules**, **WAF Managed Ruleset**, better Under Attack mode, polish/rocket loader |
| **Business** | $250 | 100% uptime SLA, custom WAF rules, bypass cache on cookie, prioritized support |

**Recommendation:** start on **Free**. The rate-limit, Bot Fight Mode, Managed Challenge, and Under-Attack features on Free are already meaningful for a site at ~3k CCU. Upgrade to Pro only if you need WAF managed rules or more than one rate-limit rule.

### 11.2 Onboarding `nasfaq.biz`

1. **Add site** to Cloudflare. Pick Free plan.
2. Cloudflare scans existing DNS; verify `holo` record is `A <DO-LB-IP>` with **Proxy status = Proxied (orange cloud)**.
3. Change nameservers at your domain registrar to the two Cloudflare NS records. Propagation: 5 minutes – 24 hours.
4. In Cloudflare, wait for **Active** status.

### 11.3 SSL/TLS configuration

Under **SSL/TLS → Overview**:

- **Encryption mode: Full (Strict)**. Cloudflare talks to the origin over HTTPS and validates the origin cert.
- That means the DO LB still needs a valid cert. Two options:
  - **Keep cert-manager / Let's Encrypt** (from §3). During initial bootstrap, set the DNS record to **DNS-Only (grey cloud)** so the HTTP-01 challenge from Let's Encrypt can reach the origin. Once the cert is issued and renewed, flip to **Proxied**. For ongoing renewals, switch cert-manager to **DNS-01** using the Cloudflare API (creates a `TXT` record during challenge; works regardless of proxy status).
  - **Cloudflare Origin Cert** (simpler, 15-year cert). Under **SSL/TLS → Origin Server → Create Certificate**, generate a cert for `*.nasfaq.biz, nasfaq.biz`, install as a k8s `Secret`, reference in the Ingress `tls.secretName`. No cert-manager needed. Only caveat: the cert is only trusted by Cloudflare, so you can't bypass Cloudflare to reach the origin directly with a browser.

Recommendation: **Cloudflare Origin Cert** - simpler operationally once you've committed to Cloudflare in front.

Also enable:
- **SSL/TLS → Edge Certificates → Always Use HTTPS: On**
- **SSL/TLS → Edge Certificates → HSTS: On** (6 months, include subdomains, preload) - only after you've verified everything works
- **SSL/TLS → Edge Certificates → Minimum TLS Version: 1.2**
- **SSL/TLS → Edge Certificates → TLS 1.3: On**
- **SSL/TLS → Edge Certificates → Automatic HTTPS Rewrites: On**

### 11.4 WebSocket passthrough

Cloudflare proxies WebSockets by default on every plan - **no toggle needed**. Verify under **Network → WebSockets** (should be On).

Gotchas:
- Cloudflare's 100-second request timeout on Free/Pro **does not apply** to WebSocket connections (they're treated as long-lived streams). You're fine for the chat/market/livestream WS paths in [`api/src/server.js`](api/src/server.js).
- Use `wss://` only. Cloudflare won't proxy plain `ws://` on the same hostname once SSL is Full (Strict).
- Make sure `api-web` sends TCP keepalives on WS connections (`ws` library's default is fine) so Cloudflare doesn't reap idle sockets after ~100s.

### 11.5 Caching rules

Most of our traffic is dynamic or authed. Set up Page Rules / Cache Rules so Cloudflare doesn't cache the wrong thing:

Under **Rules → Page Rules** (Free = 5 rules) or **Caching → Cache Rules** (newer, recommended):

| Order | Match | Action |
|---|---|---|
| 1 | `holo.nasfaq.biz/api/*` | **Cache Level: Bypass**, Disable Apps |
| 2 | `holo.nasfaq.biz/internal/*` | **Block** (defense in depth; origin already 404s) |
| 3 | `holo.nasfaq.biz/_next/static/*` | **Cache Level: Cache Everything**, Edge Cache TTL 1 month, Browser Cache TTL 1 year |
| 4 | `holo.nasfaq.biz/*.ico` / `*.png` / `*.svg` / `*.woff2` | **Cache Everything**, Edge TTL 1 week |
| 5 | `holo.nasfaq.biz/*` | Default - Standard cache, honor origin headers |

The Next.js build hashes files under `/_next/static/*`, so immutable long-TTL caching is safe.

### 11.6 Rate limiting (the single biggest DDoS/abuse win)

Under **Security → WAF → Rate limiting rules** (Free = 1 rule, Pro = 5):

**Rule (Free tier - spend the 1 rule on auth):**

```
Name: block-auth-bruteforce
If:   (http.request.uri.path eq "/api/auth/login")
Count: 5 requests per 1 minute per IP
Action: Managed Challenge for 10 minutes
```

**If on Pro**, add:

- `/api/market/orders/*` → 60 req/min per IP, Block 5 min (prevents order-spam abuse of the write path the audit flagged in [`api/src/services/trading.js`](api/src/services/trading.js))
- `/api/chat/*` (any POST) → 30 req/min per user → reply 429
- `/api/prediction-markets/*/orders` → 30 req/min per IP, Block 5 min

### 11.7 WAF & Bot management

Under **Security → WAF**:

- **Managed Rules (Pro+)**: enable Cloudflare Managed Ruleset and OWASP Core Rule Set on **Medium** sensitivity.
- **Custom rules (Free gets 5):**

```
Rule: block-known-bad-user-agents
Expression: (http.user_agent contains "sqlmap") or (http.user_agent contains "nmap") or (http.user_agent eq "")
Action: Block
```

```
Rule: challenge-tor-and-hosting
Expression: (ip.src.country eq "T1") or (cf.client.bot) and not (cf.verified_bot_category in {"Search Engine" "Monitoring"})
Action: Managed Challenge
```

Under **Security → Bots**: turn on **Bot Fight Mode** (Free). This auto-challenges trivially-identified bots. **Super Bot Fight Mode** (Pro) adds granular controls - definitely worth enabling on Pro.

Under **Security → Settings**:
- **Security Level: Medium**
- **Challenge Passage: 30 minutes**
- **Browser Integrity Check: On**
- **Privacy Pass Support: On**

### 11.8 DDoS features summary (automatic on Free)

- **L3/4 DDoS**: unmetered SYN flood / UDP flood / amplification mitigation - nothing to configure.
- **L7 HTTP DDoS**: automatic HTTP DDoS protection runs on every request; tune sensitivity under **Security → DDoS → HTTP DDoS attack protection → Configure**:
  - Ruleset action: **Challenge** (default) - keep as is.
  - Sensitivity: **High** - raise from default Medium if you see legit traffic surges getting blocked.
- **Under Attack Mode** (Dashboard → Overview, top-right): JS challenge for every visitor. Flip on during an active attack; flip off after.

### 11.9 Lock the origin to Cloudflare only

Once Cloudflare is proxying traffic, no one should be able to hit the DO LB directly. Two layers:

**1. Cloud Firewall (DO side)** — update the worker firewall from §2.8 to only allow 443 from Cloudflare IPv4 ranges:

```bash
# Current Cloudflare IPv4 ranges: https://www.cloudflare.com/ips-v4
CF_RANGES=$(curl -s https://www.cloudflare.com/ips-v4)
INBOUND=""
for cidr in $CF_RANGES; do
  INBOUND+="protocol:tcp,ports:443,address:$cidr "
done

doctl compute firewall update <firewall-id> \
  --name nasfaq-prod-workers \
  --inbound-rules "$INBOUND" \
  --outbound-rules "protocol:tcp,ports:all,address:0.0.0.0/0"
```

Automate this: schedule a monthly GitHub Actions job to refresh the firewall rules from Cloudflare's published list. (They change ~twice a year but the job is cheap insurance.)

**2. Origin authentication (better than IP filtering)** — under **SSL/TLS → Origin Server → Authenticated Origin Pulls**, enable and install the client cert on nginx. Cloudflare then presents a client certificate that nginx verifies before accepting requests; even a leaked IP is useless without the cert. Add this annotation to the Ingress:

```yaml
nginx.ingress.kubernetes.io/auth-tls-verify-client: "on"
nginx.ingress.kubernetes.io/auth-tls-secret: "nasfaq/cloudflare-origin-pull-ca"
nginx.ingress.kubernetes.io/auth-tls-verify-depth: "1"
```

### 11.10 Real client IP propagation

After Cloudflare proxies, every request to the origin has the Cloudflare edge IP as source. We want the **real** client IP in logs, rate limits, and audit trails.

Already configured in §3:
- `controller.config.use-forwarded-headers: "true"`
- `controller.config.real-ip-header: "CF-Connecting-IP"`

Optional but recommended: set `controller.config.proxy-real-ip-cidr` to the Cloudflare IP ranges so nginx only trusts `CF-Connecting-IP` when the immediate peer is actually Cloudflare. Refresh automation same as §11.9.

In the Node app, read client IP from `req.headers['cf-connecting-ip']` (already exposed by ingress as `X-Forwarded-For`'s first hop) when implementing the rate-limit P1 fix in §7 #3.

### 11.11 Observability on the edge

Free plan ships:
- **Analytics → Traffic**: total requests, cached %, bandwidth saved.
- **Security → Events**: per-rule hit counts (great for verifying the rate-limit rule actually fires).
- **Analytics → Performance**: origin response time, cache hit ratio.

If you upgrade to Pro, **Logpush** to S3/R2/BigQuery gives you full HTTP request logs - worth turning on once the site has real traffic.

### 11.12 Cloudflare checklist

- [ ] `nasfaq.biz` added to Cloudflare, nameservers switched, status Active.
- [ ] `holo` A record set to DO LB IP, Proxied (orange cloud).
- [ ] SSL/TLS mode **Full (Strict)**; Origin Cert installed OR cert-manager using DNS-01.
- [ ] Always HTTPS on; HSTS deferred until after cutover is stable.
- [ ] Cache rules: bypass `/api/*`, block `/internal/*`, long-cache `/_next/static/*`.
- [ ] Rate-limit rule on `/api/auth/login`.
- [ ] Bot Fight Mode on; Browser Integrity Check on.
- [ ] DO Cloud Firewall updated to allow 443 only from Cloudflare IPv4 ranges.
- [ ] Authenticated Origin Pulls configured on the Ingress.
- [ ] ingress-nginx returns correct real IP (test with `curl -v https://holo.nasfaq.biz/api/health` and inspect `req.ip` in a temporary log line).
- [ ] Uptime checks (§2.9) still green after Cloudflare cutover.

---

## 12. Pre-launch hardening checklist

- [ ] `/internal/*` blocked at ingress (annotation in §5) **and** guarded in-app. Currently has **no auth** per [`api/src/server.js`](api/src/server.js).
- [ ] Admin guard on `POST/PUT/DELETE /api/channels/*` in [`api/src/routes/channels.js`](api/src/routes/channels.js). None today.
- [ ] `AUTH_COOKIE_SECURE=true` and `CORS_ORIGIN=https://holo.nasfaq.biz` set in the Secret.
- [ ] `AUTH_SESSION_TTL_DAYS` explicitly set (default 30). Decide if you want shorter.
- [ ] Rotate any keys that appear in `env.example` files before production.
- [ ] DOKS worker firewall: allow `443` only from **Cloudflare IPv4 ranges** (see §11.9); DB/Redis firewalls allow only the DOKS cluster (§2.4–§2.5).
- [ ] Cloudflare proxy enabled on `holo` with SSL mode Full (Strict); Authenticated Origin Pulls active (§11.9).
- [ ] Cloudflare rate-limit rule live on `/api/auth/login` (§11.6).
- [ ] Container images run as non-root (`USER node` / distroless nonroot) — verified above.
- [ ] `NetworkPolicy` blocks egress from Go scrapers to anything but Postgres/Redis/required APIs (YouTube, Gemini, 4chan, Hololyzer, S3). Optional but recommended.
- [ ] Enable DO database **automated backups** (daily) and **point-in-time-restore**.
- [ ] Configure GHCR repo visibility (private) and image retention (`keep last 10`).
- [ ] Turn on GitHub **branch protection** for `main` requiring `ci.yml` to pass.
- [ ] Set up Uptime Kuma or DO Uptime checks on `https://holo.nasfaq.biz/api/health` and `wss://holo.nasfaq.biz/api/market/ws`.

---

## 13. Ops runbook (day-2)

### Common commands

```bash
# Get overview
kubectl -n nasfaq get pods,svc,ingress,hpa

# Tail logs
kubectl -n nasfaq logs -f deploy/api-web --tail=200
kubectl -n nasfaq logs -f deploy/api-scheduler
kubectl -n nasfaq logs -f deploy/ytscraper

# Rollback api-web to previous image
kubectl -n nasfaq rollout undo deploy/api-web

# Rollback to a specific SHA
kubectl -n nasfaq set image deploy/api-web api=ghcr.io/jamesac42/nasfaqv2-api:sha-<prev>
kubectl -n nasfaq rollout status deploy/api-web

# Force a pod restart (e.g. after secret change)
kubectl -n nasfaq rollout restart deploy/api-web

# HPA status
kubectl -n nasfaq describe hpa api-web

# One-off shell into a pod
kubectl -n nasfaq exec -it deploy/api-web -- sh

# Run an ad-hoc migration
kubectl -n nasfaq create job --from=job/api-migrate api-migrate-manual-$(date +%s)
```

### When to scale manually

- Upcoming known event (stream drop, contest) → `kubectl -n nasfaq scale deploy/api-web --replicas=8` before the event; HPA will keep it there if load is real.
- Postgres connection saturation (`pg_stat_activity` full) → lower `PG_POOL_MAX` env and `kubectl rollout restart deploy/api-web`; longer-term install PgBouncer.

### Incident-response quick paths

| Symptom | First check | Likely fix |
|---|---|---|
| 502s from ingress | `kubectl -n nasfaq get pods` for `CrashLoopBackOff` | `kubectl logs`, fix or rollback |
| WSS connects drop | ingress `proxy-read-timeout` reverted | re-apply `deploy/k8s/ingress.yaml` |
| Market prices stale | `api-scheduler` down | `kubectl get pods`, check scheduler logs, restart |
| No new YT data | `ytscraper` crash or YouTube quota | check logs; rotate `YOUTUBE_API_KEY` if quota |
| Holonews not updating | Gemini quota or 4chan rate limit | check logs, wait or rotate |

### Backups

- Managed Postgres: daily automated + PITR (DO).
- Before any schema-changing deploy: `doctl databases backups create <pg-id>` as an explicit extra snapshot.
- S3 bucket (`AWS_SW_BUCKET`): enable versioning on the bucket.

### Observability P2

- Install `kube-prometheus-stack` + `loki` (or use DO Monitoring).
- Alerts to add first: `api-web` pod CPU > 80% 10m, HPA at max, PG connections > 80%, any crash loop, cert expiry < 7 days, any 5xx rate > 1% over 5m.

---

## Appendix A — repo additions (what the CI/CD expects to exist)

```
.
├── DEPLOYMENT.md                    # this file
├── .github/
│   └── workflows/
│       ├── ci.yml                   # §9
│       └── deploy.yml               # §9
├── api/
│   └── Dockerfile                   # §4.1
├── app-client/
│   ├── Dockerfile                   # §4.2
│   └── next.config.ts               # add output: "standalone", remove prod rewrites
├── holonews/Dockerfile              # §4.3
├── superchatscraper/Dockerfile      # §4.3
├── ytscraper/Dockerfile             # §4.3
└── deploy/
    └── k8s/
        ├── cluster-issuer.yaml
        ├── ingress.yaml
        ├── api-web.yaml
        ├── api-scheduler.yaml
        ├── api-migrate-job.yaml
        ├── app-client.yaml
        ├── holonews.yaml
        ├── superchatscraper.yaml
        └── ytscraper.yaml
```

## Appendix B — code follow-ups flagged by this runbook

These are small, well-scoped PRs the deployment depends on or strongly benefits from. None are blocked on infra.

1. **P0** - Gate the livestream snapshot loop on `LIVESTREAM_SNAPSHOT_OWNER` in [`api/src/server.js`](api/src/server.js).
2. **P0** - Respect `YT_SCHEMA_PATH` env in [`api/src/migrations.js`](api/src/migrations.js) so the baked-in schema works.
3. **P0 security** - Add `requireAdmin` to mutating `/api/channels/*` routes in [`api/src/routes/channels.js`](api/src/routes/channels.js).
4. **P0 security** - Add route-level auth on `/internal/market/*` (in addition to ingress block) in [`api/src/server.js`](api/src/server.js).
5. **P1 scaling** - Throttle `last_seen_at` updates via Redis (`SETEX session:last:<id> 30 1`) in [`api/src/services/auth.js`](api/src/services/auth.js).
6. **P1 scaling** - Make `online_count` cluster-wide via Redis `INCR`/`DECR` in the stats WS handlers in [`api/src/server.js`](api/src/server.js).
7. **P1 scaling** - Call `ensureChatTopology` at startup only; cache the ensured set in the chat `subscribe` path in [`api/src/server.js`](api/src/server.js).
