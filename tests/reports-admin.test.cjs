const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadSource } = require('./helpers/load-source.cjs');
const root = 'backend/src/modules/';
const plain = value => JSON.parse(JSON.stringify(value));

function ledgerHarness(receipts = []) {
  let filter, sort;
  const analytics = loadSource(root + 'procurements/procurement.analytics.ts', {
    '../../config/env': { env: { TIMEZONE_OFFSET: 5 } },
    '../../utils/business-day': {},
    '../products/product.model': {}, '../snapshots/snapshot.model': {}, './procurement.model': {},
  });
  const ledger = loadSource(root + 'procurements/procurement.ledger.ts', {
    './procurement.analytics': analytics,
    '../../config/env': { env: { TIMEZONE_OFFSET: 5 } },
    '../../utils/business-day': { getCurrentBusinessDate: () => '2026-10-04', getEffectiveHour: () => 0 },
    './procurement.model': { ProcurementModel: { find(value) { filter = value; return { sort(value) { sort = value; return { maxTimeMS() { return this; }, lean() { return { cursor() { return { async *[Symbol.asyncIterator]() { yield* receipts; }, async close() {} }; } }; } }; } }; } } },
  });
  return { ...ledger, filter: () => filter && plain(filter), sort: () => plain(sort) };
}
const actor = { userId: 'owner-a', role: 'admin', tier: 'pro' };
const query = { period: 'custom', from: '2026-10-01', to: '2026-10-31' };
const receipt = (index, unit = 'kg') => ({ localId: 'batch-' + index, ownerAdminId: 'owner-a', date: '2026-10-04', supplier: 'Cola, "supplier"', totalCost: 0.3, items: [{ name: '=HYPERLINK("unsafe")', unit, quantity: 0.1 + 0.2, buyPrice: 1, lineCost: 0.3 }] });

test('receipt export includes every batch beyond UI pagination, scopes owner and dates, and preserves units/precision', async () => {
  const h = ledgerHarness(Array.from({ length: 205 }, (_, i) => receipt(i, i ? 'kg' : 'dona')));
  const data = await h.procurementLedger(actor, query, 'uz');
  assert.deepEqual(h.filter(), { ownerAdminId: 'owner-a', date: { $gte: query.from, $lte: query.to } });
  assert.deepEqual(h.sort(), { date: 1, createdAt: 1, localId: 1 });
  assert.equal(data.rows.length, 210);
  assert.equal(data.rows[4][4], 0.3);
  assert.equal(data.rows.at(-1)[4], '0.3 dona / 61.2 kg');
  assert.equal(data.rows.at(-1)[7], 61.5);
  assert.equal(data.rows.at(-1)[8], 205);
});
test('receipt export refuses free and procurement-only accounts before querying; empty reports and Russian labels remain valid', async () => {
  const h = ledgerHarness();
  for (const denied of [{ ...actor, tier: 'tekin' }, { ...actor, scope: 'procurement' }]) await assert.rejects(h.procurementLedger(denied, query, 'uz'));
  assert.equal(h.filter(), undefined);
  const data = await h.procurementLedger(actor, query, 'ru');
  assert.equal(data.rows[0][0], 'Приходы');
  assert.equal(data.rows.at(-1)[7], 0);
});
test('receipt CSV blocks formulas and quotes delimiters; XLSX writes the same numeric table with frozen headers', async () => {
  const data = await ledgerHarness([receipt(1)]).procurementLedger(actor, query, 'uz');
  const { procurementCsv, procurementExport } = loadSource(root + 'procurements/procurement.export.ts');
  const csv = procurementCsv(data);
  assert.ok(csv.startsWith('\uFEFFsep=,\r\n'));
  assert.ok(csv.includes('"\'=HYPERLINK(""unsafe"")"'));
  assert.ok(csv.includes('"Cola, ""supplier"""'));
  assert.equal(csv.includes('0.30000000000000004'), false);
  const output = await procurementExport(plain(data), 'xlsx');
  const ExcelJS = require('exceljs'), book = new ExcelJS.Workbook();
  await book.xlsx.load(output.body);
  const sheet = book.getWorksheet('Kirimlar');
  assert.equal(sheet.getCell('E5').value, 0.3);
  assert.equal(sheet.getCell('H6').value, 0.3);
  assert.equal(sheet.getCell('D5').value, '=HYPERLINK("unsafe")');
  assert.equal(sheet.getCell('D5').type, ExcelJS.ValueType.String);
  assert.equal(sheet.views[0].ySplit, 4);
});
test('ledger validation rejects invalid dates, reversed ranges, unrecognised reports and unsupported PDF', () => {
  const { procurementAnalyticsQuerySchema: schema } = loadSource(root + 'procurements/procurement.validation.ts');
  for (const input of [{ ...query, from: '2026-02-30' }, { ...query, to: '2026-09-30' }, { ...query, report: 'unknown' }, { ...query, report: 'receipts', format: 'pdf' }]) assert.equal(schema.safeParse(input).success, false);
  assert.equal(schema.safeParse({ ...query, report: 'receipts', format: 'xlsx' }).success, true);
});

function historyHarness() {
  const calls = [];
  const module = loadSource(root + 'payments/payment-history.service.ts', {
    './payment.model': { PaymentModel: { aggregate: async pipeline => { calls.push(plain(pipeline)); return [{ items: [{ _id: 'p', userId: 'u', account: { username: 'shop', password: 'must not leak' }, senderCardDetails: { fullName: 'Owner', cardNumber: '8600 1234 5678 9012' }, receiptHash: 'private-hash', amount: 100, status: 'completed' }], summary: [{ total: 251, settledAmount: 100, pendingAmount: 0 }], count: [{ total: 251 }] }]; } } },
    '../auth/user.model': { UserModel: { collection: { name: 'users' } } },
  });
  return { ...module, calls };
}
test('history paginates all records, counts the full filtered set, and joins account details only for the visible page', async () => {
  const h = historyHarness(), data = await h.listPaymentHistory({ page: 3, limit: 25, status: 'completed', method: 'manual_card' });
  assert.equal(data.summary.total, 251); assert.equal(data.totalPages, 11);
  const pipeline = h.calls[0], facet = pipeline.at(-1).$facet;
  assert.deepEqual(pipeline[0].$match, { status: 'completed', method: 'manual_card' });
  assert.equal(facet.items[1].$skip, 50); assert.equal(facet.items[2].$limit, 25);
  assert.ok(facet.items[3].$lookup);
  assert.equal(data.items[0].sender.card, '•••• 9012');
  for (const key of ['password', 'receiptHash', 'receiptFileId', 'ocr', '_id']) assert.equal(Object.hasOwn(data.items[0], key), false);
});
test('history search escapes regex input and date boundaries include the full final Tashkent day', () => {
  const h = historyHarness(), match = h.historyMatch({ page: 1, limit: 25, from: '2026-10-04', to: '2026-10-04' });
  assert.equal(match.createdAt.$gte.toISOString(), '2026-10-03T19:00:00.000Z');
  assert.equal(match.createdAt.$lt.toISOString(), '2026-10-04T19:00:00.000Z');
  const search = h.historySearch('shop.*[a]');
  assert.equal(search.$or[0]['account.username'].$regex, 'shop\\.\\*\\[a\\]');
});
test('bot review queue excludes Click, orders oldest first, limits pages and retains reconciliation cases', async () => {
  const h = historyHarness(), data = await h.listReviewQueue(2, 5);
  assert.equal(data.total, 251); assert.equal(data.totalPages, 51);
  const pipeline = h.calls[0];
  assert.equal(pipeline[0].$match.method, 'manual_card');
  assert.deepEqual(pipeline[0].$match.$or[1], { needsReconciliation: true });
  assert.equal(pipeline[1].$facet.items[1].$skip, 5);
  assert.equal(pipeline[1].$facet.items[2].$limit, 5);
});

test('admin history and receipt routes enforce the real superadmin guard and keep receipt bytes private', async () => {
  const { authorize } = loadSource(root + 'auth/auth.middleware.ts', {
    './auth.utils': {}, './auth.repository': {}, '../subscriptions/subscription.service': {},
  });
  let reads = 0;
  const { paymentHistoryRoutes, paymentHistoryQuerySchema } = loadSource(root + 'payments/payment-history.routes.ts', {
    '../auth/auth.middleware': { authorize },
    './payment-history.service': { listPaymentHistory: async () => { reads++; return { items: [] }; } },
    './payment-receipt.model': { PaymentReceiptModel: { findOne: () => ({ select: async () => ({ contentType: 'image/webp', bytes: Buffer.from('private-receipt') }) }) } },
  });
  const request = (url, auth) => new Promise(resolve => {
    const headers = {}, req = { method: 'GET', url, originalUrl: url, headers: {}, query: {}, auth };
    const res = { setHeader: (key, value) => headers[key] = value, status() { return this; }, json: body => resolve({ body, headers }), send: body => resolve({ body, headers }) };
    paymentHistoryRoutes.handle(req, res, error => resolve({ error, headers }));
  });
  for (const auth of [undefined, { role: 'admin' }]) { const result = await request('/', auth); assert.ok([401, 403].includes(result.error.statusCode)); }
  assert.equal(reads, 0);
  const history = await request('/', { role: 'superAdmin' });
  assert.deepEqual(plain(history.body), { success: true, data: { items: [] } });
  assert.equal(history.headers['Cache-Control'], 'private, no-store');
  const receipt = await request('/' + 'a'.repeat(24) + '/receipt', { role: 'superAdmin' });
  assert.ok(Buffer.isBuffer(receipt.body)); assert.equal(receipt.body.toString(), 'private-receipt');
  assert.equal(receipt.headers['Content-Type'], 'image/webp');
  for (const query of [{ page: 0 }, { limit: 101 }, { status: 'unsafe' }, { from: '2026-02-30' }, { from: '2026-10-04', to: '2026-09-04' }]) assert.equal(paymentHistoryQuerySchema.safeParse(query).success, false);
});
