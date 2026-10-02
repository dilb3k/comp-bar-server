// k6 load/concurrency scenario for comp-bar-server's backend. Run only
// against the disposable server+DB this harness spins up (see run.sh) —
// never against a real deployment or shared dev database.
//
// Mix (per spec "Prompt 20"):
//   ~50% read-heavy  (GET /api/products)
//   ~35% write-heavy (POST /api/inventory/sales — split across a wide
//                      "cold" product pool and a small "hot" pool so both
//                      ordinary throughput AND same-row contention are
//                      exercised)
//   ~10% Bozorchi-vs-Kassir conflict (one shared product, hit by both a
//        cashier sale and a procurement batch submit)
//   ~5%  RBAC check (procurement-scope token probing an out-of-allowlist
//        route, must stay 403 under load too)
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:4000';
const fixtures = JSON.parse(open('./fixtures.json'));

// Inlined instead of importing k6-utils from jslib.k6.io — keeps this
// script runnable with zero network access beyond BASE_URL itself.
function randomIntBetween(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randomFloatBetween(min, max) { return Math.random() * (max - min) + min; }
function randomItem(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// app.ts has `app.set("trust proxy", 1)`, so express-rate-limit's apiLimiter
// (200 req/min, keyed by req.ip) reads this header. Every VU gets its own
// synthetic IP so 1000 VUs are modeled as 1000 distinct real users each
// subject to their OWN 200/min budget — not 1000 users artificially
// collapsed onto k6's single local IP, which would make the rate limiter
// (not the database/transaction layer) the entire bottleneck under test.
// This is a test-side header only; no application code is touched.
function clientIp() {
  return `10.${(__VU >> 16) & 255}.${(__VU >> 8) & 255}.${__VU & 255}`;
}

const errors5xx = new Rate('errors5xx');
const reconciliationConflicts = new Counter('reconciliation_conflicts_409');
const rbacBlocked403 = new Counter('rbac_blocked_403');
const rateLimited429 = new Counter('rate_limited_429');
const successfulSales = new Counter('successful_sales');
const successfulProcurements = new Counter('successful_procurements');

export const options = {
  scenarios: {
    main: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 200 },
        { duration: '60s', target: 200 },
        { duration: '30s', target: 1000 },
        { duration: '60s', target: 1000 },
        { duration: '20s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    // Real backend failures only — 403/409/422 are expected business-logic
    // outcomes under contention and are tracked separately below, not
    // counted against this.
    errors5xx: ['rate<0.01'],
    http_req_duration: ['p(95)<800', 'p(99)<2000'],
  },
};

function classify(res, tags) {
  const isServerFailure = res.status === 0 || res.status === 500 || res.status === 502 || res.status === 503 || res.status === 504;
  errors5xx.add(isServerFailure, tags);
  if (res.status === 409) reconciliationConflicts.add(1);
  if (res.status === 403) rbacBlocked403.add(1);
  if (res.status === 429) rateLimited429.add(1);
  return isServerFailure;
}

export function setup() {
  const loginRes = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify({
    username: fixtures.adminUsername,
    password: fixtures.adminPassword,
    deviceId: 'load-harness-admin-device',
  }), { headers: { 'Content-Type': 'application/json' } });
  check(loginRes, { 'admin login succeeded': (r) => r.status === 200 });
  const adminToken = loginRes.json('data.token');

  const procRes = http.post(`${BASE_URL}/api/auth/login/procurement`, JSON.stringify({
    username: fixtures.adminUsername,
    password: fixtures.adminPassword,
  }), { headers: { 'Content-Type': 'application/json' } });
  check(procRes, { 'procurement-scope login succeeded': (r) => r.status === 200 });
  const procurementToken = procRes.json('data.token');

  return { adminToken, procurementToken };
}

function authHeaders(token) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Forwarded-For': clientIp() };
}

function sellOne(token, productId, tags) {
  const body = {
    deviceId: `k6-vu-${__VU}`,
    lines: [{
      productId,
      quantity: 1,
      expectedBuyPrice: fixtures.initialBuyPrice,
      expectedUnit: fixtures.initialUnit,
      expectedStockEpoch: fixtures.initialStockEpoch,
    }],
  };
  const res = http.post(`${BASE_URL}/api/inventory/sales`, JSON.stringify(body), {
    headers: { ...authHeaders(token), 'Idempotency-Key': `sale-${__VU}-${__ITER}-${Date.now()}-${Math.random()}` },
    tags,
  });
  const failed = classify(res, tags);
  check(res, { 'sale: not a server failure': () => !failed });
  if (res.status === 200) successfulSales.add(1);
  return res;
}

function submitProcurement(token, productId, tags) {
  const body = { items: [{ productId, name: 'Cashier/Bozorchi Conflict Product', quantity: 2, buyPrice: randomIntBetween(10, 15) }] };
  const res = http.post(`${BASE_URL}/api/procurements`, JSON.stringify(body), {
    headers: { ...authHeaders(token), 'Idempotency-Key': `proc-${__VU}-${__ITER}-${Date.now()}-${Math.random()}` },
    tags,
  });
  const failed = classify(res, tags);
  check(res, { 'procurement submit: not a server failure': () => !failed });
  if (res.status === 201) successfulProcurements.add(1);
  return res;
}

export default function (data) {
  const r = Math.random();

  if (r < 0.50) {
    // Read-heavy: product list + occasional single-product lookup.
    const res = http.get(`${BASE_URL}/api/products`, { headers: authHeaders(data.adminToken), tags: { kind: 'read_list' } });
    const failed = classify(res, { kind: 'read' });
    check(res, { 'read: 200': (r2) => r2.status === 200, 'read: not a server failure': () => !failed });
  } else if (r < 0.70) {
    // Write-heavy, wide pool: different products, no expected contention.
    sellOne(data.adminToken, randomItem(fixtures.coldProductIds), { kind: 'write_cold' });
  } else if (r < 0.85) {
    // Write-heavy, narrow pool: same handful of products, deliberate
    // same-row contention to exercise transaction serialization.
    sellOne(data.adminToken, randomItem(fixtures.hotProductIds), { kind: 'write_hot' });
  } else if (r < 0.95) {
    // Bozorchi vs Kassir: one shared product, racing writers.
    if (Math.random() < 0.7) {
      sellOne(data.adminToken, fixtures.conflictProductId, { kind: 'conflict_cashier' });
    } else {
      submitProcurement(data.procurementToken, fixtures.conflictProductId, { kind: 'conflict_procurement' });
    }
  } else {
    // RBAC under load: a procurement-scope token must still be rejected
    // outside its allowlist, even while the system is under heavy load.
    const blocked = http.get(`${BASE_URL}/api/debtors`, { headers: authHeaders(data.procurementToken), tags: { kind: 'rbac_probe' } });
    check(blocked, { 'procurement scope blocked from /debtors (403)': (r2) => r2.status === 403 });
    const allowed = http.get(`${BASE_URL}/api/products`, { headers: authHeaders(data.procurementToken), tags: { kind: 'rbac_probe' } });
    const failed = classify(allowed, { kind: 'rbac_probe' });
    check(allowed, { 'procurement scope allowed on /products (200)': (r2) => r2.status === 200, 'rbac probe: not a server failure': () => !failed });
  }

  // Realistic per-user think-time — also keeps each VU's own request rate
  // comfortably under its personal 200/min apiLimiter budget (now that each
  // VU has its own synthetic IP, see clientIp() above) instead of firing as
  // fast as the network round-trip allows.
  sleep(randomFloatBetween(0.3, 1.2));
}
