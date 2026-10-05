# Backend capacity changes — 2026-10-05

Implemented in source; no production deployment was performed.

## Runtime and traffic

`npm start` launches `backend/dist/cluster.js`. `WEB_CONCURRENCY=auto` uses available CPU cores, capped by RAM (640 MiB per worker) and the database connection budget. Explicit worker counts obey the same caps. `npm run start:single` remains available for development/diagnosis. Do not wrap this entry point in another PM2 cluster.

The primary process prepares migrations/index readiness once, closes its temporary database client, then forks API workers. Only slot 0 runs scheduled jobs. In a multi-replica deployment set `RUN_SCHEDULED_JOBS=false` on other replicas. Worker exits trigger bounded exponential restart delays; five exits within a minute stop the cluster. SIGTERM drains HTTP and closes database/report workers, with a 30-second primary deadline. OCR initializes lazily instead of allocating an OCR worker in every process at boot.

| Policy | Default per IP | Shared boundary |
|---|---:|---|
| Read/HEAD | 3,000 / minute | All workers under one cluster primary |
| Write | 600 / minute | Same |
| Login, registration, reset, refresh, OTP | 10 / 15 minutes | Same; survives API worker restart |
| Payment callbacks and bot mutations | 120 / minute | Same |
| Public product images | 600 / minute, plus read budget | Same |
| Health | Exempt | Probes remain available |

Auth routes also retain the general read/write policy, including phone verification polling. API traffic shaping runs before JSON parsing. Counters use a bounded, incremental-cleanup in-memory store (200,000 keys); full stores or unavailable IPC fail closed. Each worker caps pending IPC at 2,048 calls. Counters are local to a primary, **not shared between independent hosts**, and reset on primary restart. Fleet-wide limits need a shared edge/Redis limiter. The existing `trust proxy=1` assumes exactly one trusted ingress; prevent direct public access that bypasses that ingress.

HTTP backlog is 4,096 (subject to OS limits), keep-alive 65 seconds, header timeout 66 seconds, request timeout 120 seconds. Successful production access logs are sampled at 1%; all error responses remain logged. `HTTP_LOG_SAMPLE_RATE=1` restores full logging.

## MongoDB connections

There is one reused Mongoose connection/client per API process, no client per request, no database client in report threads. Defaults: `maxPoolSize=100`, `minPoolSize=10`, `socketTimeoutMS=45000`, `waitQueueTimeoutMS=5000`, `maxConnecting=2`, `maxIdleTimeMS=60000`. The maximum is reduced as workers/replicas grow:

```
perWorkerPool = min(100, floor((budget - reserve) / (workers * replicas * topologyMembers)) - 2)
```

Defaults: budget 660, reserve 24, replicas 2, topology members 3. This gives pool maximum 100 for one worker, 51 for two, 24 for four, 11 for eight; minimum is capped at the resulting maximum. Count rolling deployment overlap in `DEPLOYMENT_REPLICAS`; include all other applications in the reserve. These are conservative application settings, not a claim about the user's actual Atlas tier. Read the deployed Atlas limit before changing the budget. A client can have a pool per topology server and monitoring sockets, so multiplying 100 blindly by CPU count is unsafe. [MongoDB connection pool documentation](https://www.mongodb.com/docs/drivers/node/current/connect/connection-options/connection-pools/).

## Read cache, lean queries and expensive work

Catalog/detail, procurement summary and analytics return cached serialized responses. Per-worker limits: 32 MiB, 2,000 entries, 1 MiB per entry, 5-second TTL, 1,024 distinct in-flight fills. Concurrent misses for the same key share a promise. Keys include owner, transaction revision, permission scope/tier, business date and query. Every request checks the current owner revision on the primary with majority read concern. Committed inventory/product/procurement writes advance this revision in the same transaction, invalidating every worker's old entry. Failed loads are not cached. Cache responses remain private/no-store; credentials, sessions and subscriptions are always checked against the database before a cache lookup.

Lean audit converted read-only product lists/details/dashboard, inventory range reads, snapshot reads, v2 sync pages, procurement lists/details, debtor lists, session identity projections, active subscriptions and ID-only product probes. Public serializers preserve dates, IDs, tenant-field removal and legacy defaults. Analytics use Mongo aggregation (already plain objects); ledger and payment history already use lean/aggregate. Document reads needed for `save()`, transaction mutations, auth password methods or legacy sync `toJSON()` remain hydrated intentionally.

Analytics aggregation executes in MongoDB asynchronously with existing query timeouts. A per-process admission gate permits 4 expensive analytics operations plus 128 waiting requests (5-second queue deadline), avoiding an unbounded aggregation stampede. Report export has its own one-active/four-waiting gate. CSV/Excel/PDF formatting runs in a lazy worker thread, with 128 MiB old-generation limit, 60-second job timeout and 30-second idle teardown. Receipt export uses a cursor, closes it in `finally`, yields between batches, and explicitly rejects more than 50,000 item rows, 10,000 batches or 8 MiB of raw receipts with a localized request to narrow the date range; it never returns a silently truncated report.

## Reproducible verification

```
npm run build
npm run check
npm test
node --test scripts/architecture.test.cjs
node scripts/test-integration.cjs
npm run test:capacity
```

The integration harness creates and removes a disposable loopback MongoDB replica set, never loads `.env`, and accepts no production database target. Requires a local `mongod` executable. Capacity options: `CAPACITY_CONNECTIONS=500..1000` (default 1000), `CAPACITY_REQUESTS>=10000` (default 12000), `CAPACITY_PRODUCTS_PER_STORE=1..1000` (default 100).

Regression checks include cluster restart/limit sharing and graceful process exit, immediate cross-instance cache invalidation, tenant isolation, revoked sessions, auth brute-force protection, bounded caches/queues, serializer compatibility and worker-generated XLSX contents. The capacity test checks stock, daily reports, receipts, indexed lookup, real socket peak, pool checkout failures and all checked-out connections returning to zero.

## Measured local run

Machine: Apple M2, 8 logical CPUs, Node v26.4.0, macOS. Two independent API processes with production HTTP/cache/pool settings; separate integration tests exercise the actual cluster entry and IPC. 1,000 tenants, 100 products per tenant, 100,000 products and inventory rows. No mocked HTTP/database work or automatic retries.

| Workload | Requests | Successes | p50 ms | p95 ms | p99 ms | req/s |
|---|---:|---:|---:|---:|---:|---:|
| Sale, including connection ramp | 1,000 | 1,000 | 1,622 | 3,017 | 3,129 | 311 |
| Idempotent replay on other instance | 1,000 | 1,000 | 314 | 349 | 353 | 2,687 |
| Product detail/catalog | 9,000 | 9,000 | 370 | 619 | 675 | 2,965 |
| Procurement analytics | 1,000 | 1,000 | 265 | 287 | 292 | 3,375 |

Total: **12,000/12,000 successful**, 6.919 seconds measured workload, 1,734 req/s; overall p50 335 ms, p95 1,310 ms, p99 2,828 ms. Peak HTTP sockets: **1,000**, created sockets: 1,000. Peak checked-out Mongo connections: 100 per process, returned to 0; checkout failures: 0. Final RSS: 309/241 MiB, JS heaps: 82/71 MiB. Event-loop p99 during catalog traffic: 60/47 ms; maximum delay across all phases: 80 ms. Cache hits: 8,000; coalesced fills: 980; misses: 1,020. Stock, inventory, daily reports and idempotency receipts all matched 1,000 successful sales; replay applied none twice. Indexed lookup examined one key/document.

TCP establishment is ramped at up to 32 handshakes per 100 ms; first-wave latency includes that client queue. Later waves reuse 1,000 established sockets. The earlier unpaced cold-start run produced 466 transport errors (ECONNRESET/EPIPE) while opening sockets; no pool timeout occurred. That failed run is retained in `evidence/local-capacity-cold-burst.json`. This is consistent with local accept-queue pressure, not proof of its exact kernel cause. Production ingress/OS backlog and connection ramp behavior still require testing on the actual host.

Raw successful measurements: `evidence/local-capacity.json`. This is a short local mixed burst, **not evidence of 10,000 simultaneous users**, sustained soak stability, Atlas-tier throughput, WAN/TLS latency, or multi-region failover. The Render blueprint currently specifies a free plan; the test makes no capacity claim for that plan. No paid hosting changes were made.

## Final checks

`npm run build`, `npm run check` and `git diff --check` passed. The full disposable-database integration suite passed 111/111 tests, architecture tests 6/6 and business rules 34/34. Build and these 151 regression tests were also run against an isolated copy of the staged commit, excluding unrelated local changes. The recorded 12,000-request capacity run passed 1/1. There is no separate backend lint script.
