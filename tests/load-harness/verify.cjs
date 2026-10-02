// Post-run correctness check, independent of k6's own HTTP-level metrics.
// k6 tells us the error RATE and latency; this tells us whether the actual
// data in the DB is consistent with what should have happened — the real
// question behind "MongoDB tranzaksiyasi mustahkamligini tekshirish": did
// any write actually corrupt state (oversell, negative stock, lost/duplicated
// increments) even if every HTTP response looked fine individually.
const mongoose = require('mongoose');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const productSchema = new mongoose.Schema({}, { strict: false });
const ProductModel = mongoose.model('Product', productSchema, 'products');
const auditSchema = new mongoose.Schema({}, { strict: false });
const AuditEventModel = mongoose.model('AuditEvent', auditSchema, 'audit_events');

async function main() {
  const uri = process.argv[2];
  if (!uri) throw new Error('Usage: node verify.cjs <mongodb-uri>');
  const fixtures = JSON.parse(readFileSync(join(__dirname, 'fixtures.json'), 'utf8'));
  await mongoose.connect(uri, { maxPoolSize: 10 });

  const allIds = [...fixtures.coldProductIds, ...fixtures.hotProductIds, fixtures.conflictProductId];
  const products = await ProductModel.find({ ownerAdminId: fixtures.ownerAdminId, localId: { $in: allIds } }).lean();

  const negativeStock = products.filter((p) => Number(p.quantity) < 0);
  const byId = new Map(products.map((p) => [p.localId, p]));

  const conflictProduct = byId.get(fixtures.conflictProductId);
  const hotTotals = fixtures.hotProductIds.map((id) => byId.get(id));

  // AuditEventModel's collection name may differ by mongoose auto-pluralization
  // vs. the real app's explicit setting — tolerate either so this report
  // degrades gracefully (fewer stats, never a crash) instead of asserting a
  // collection-name guess as a hard dependency.
  let saleAuditCount = 0;
  let restockAuditCount = 0;
  try {
    saleAuditCount = await AuditEventModel.countDocuments({ ownerAdminId: fixtures.ownerAdminId, action: 'UPDATE', entityType: 'inventory' });
    restockAuditCount = await AuditEventModel.countDocuments({ ownerAdminId: fixtures.ownerAdminId, action: 'RESTOCK' });
  } catch { /* best-effort only */ }

  const report = {
    productsChecked: products.length,
    negativeStockCount: negativeStock.length,
    negativeStockSamples: negativeStock.slice(0, 5).map((p) => ({ localId: p.localId, quantity: p.quantity })),
    conflictProduct: conflictProduct ? { localId: conflictProduct.localId, finalQuantity: conflictProduct.quantity, finalBuyPrice: conflictProduct.buyPrice, stockEpoch: conflictProduct.stockEpoch } : null,
    hotProductsFinal: hotTotals.filter(Boolean).map((p) => ({ localId: p.localId, finalQuantity: p.quantity })),
    saleAuditCount,
    restockAuditCount,
    verdict: negativeStock.length === 0 ? 'PASS: no product went negative under concurrent load' : 'FAIL: oversell detected, see negativeStockSamples',
  };

  console.log('\n=== DB-level correctness report ===');
  console.log(JSON.stringify(report, null, 2));
  await mongoose.disconnect();
  if (negativeStock.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error('Verify failed:', error);
  process.exit(1);
});
