// Seeds a disposable Mongo instance with exactly what scenario.js needs:
// one bootstrap superAdmin, a wide pool of "cold" products (never touched
// except by ordinary sales, so their buyPrice/unit/stockEpoch stay
// predictable for the whole run), and a small set of "hot" products used
// deliberately to create contention (many cashiers hitting the same stock,
// and a Bozorchi procurement batch racing a cashier sale on the same item).
//
// Deliberately defines its own minimal, inline Mongoose schemas instead of
// importing anything from backend/src/dist — this harness must stay fully
// decoupled from the application source tree. Field names/collection names
// below are hand-matched to backend/src/modules/{auth/user.model.ts,
// products/product.model.ts} as of this writing; only field *shapes* are
// shared, no code.
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');

const COLD_PRODUCT_COUNT = Number(process.env.LOAD_COLD_PRODUCTS || 400);
const HOT_PRODUCT_COUNT = Number(process.env.LOAD_HOT_PRODUCTS || 5);
const ADMIN_USERNAME = 'load-admin';
const ADMIN_PASSWORD = 'load-test-password-123';

const userSchema = new mongoose.Schema({
  username: String, phone_number: String, password: String, role: String,
  isActive: Boolean, isPayed: Boolean, securityVersion: Number, activeSessionId: { type: String, default: null },
}, { timestamps: true });
const UserModel = mongoose.model('User', userSchema, 'users');

const productSchema = new mongoose.Schema({
  ownerAdminId: String, localId: String, deviceId: String, name: String,
  quantity: Number, stockEpoch: { type: Number, default: 0 }, unit: String,
  buyPrice: Number, sellPrice: Number, displayIndex: Number,
}, { timestamps: true });
const ProductModel = mongoose.model('Product', productSchema, 'products');

const inventorySchema = new mongoose.Schema({
  ownerAdminId: String, localId: String, deviceId: String, productId: String,
  productName: String, unit: String, date: String, startQuantity: Number,
  currentQuantity: Number, buyPrice: Number, sellPrice: Number, note: String,
}, { timestamps: true });
const InventoryEntryModel = mongoose.model('InventoryEntry', inventorySchema, 'inventory_entries');

function businessDateToday() {
  // Matches getCurrentBusinessDate's output shape (YYYY-MM-DD) closely
  // enough for a fresh seed where "today" has had zero activity yet — the
  // backend's own getCurrentBusinessDate/getEffectiveHour will compute the
  // real key at request time; this is only the key THIS seed script uses to
  // pre-create today's InventoryEntry rows so first-sale reconciliation
  // checks don't trip on a missing baseline for high-volume hot products.
  const now = new Date();
  return now.toISOString().slice(0, 10);
}

async function main() {
  const uri = process.argv[2];
  if (!uri) throw new Error('Usage: node seed.cjs <mongodb-uri>');
  await mongoose.connect(uri, { maxPoolSize: 20 });

  const passwordHash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  const admin = await UserModel.create({
    username: ADMIN_USERNAME, phone_number: '', password: passwordHash,
    role: 'superAdmin', isActive: true, isPayed: true, securityVersion: 0, activeSessionId: null,
  });
  const ownerAdminId = admin._id.toString();
  const today = businessDateToday();

  const coldProducts = Array.from({ length: COLD_PRODUCT_COUNT }, (_, i) => ({
    ownerAdminId, localId: `cold-${i}`, deviceId: 'load-harness', name: `Cold Product ${i}`,
    quantity: 1_000_000, unit: 'dona', buyPrice: 10, sellPrice: 20, displayIndex: i + 1, stockEpoch: 0,
  }));
  const hotProducts = Array.from({ length: HOT_PRODUCT_COUNT }, (_, i) => ({
    ownerAdminId, localId: `hot-${i}`, deviceId: 'load-harness', name: `Hot Product ${i}`,
    quantity: 5000, unit: 'dona', buyPrice: 10, sellPrice: 20, displayIndex: 10_000 + i, stockEpoch: 0,
  }));
  const conflictProduct = {
    ownerAdminId, localId: 'conflict-0', deviceId: 'load-harness', name: 'Cashier/Bozorchi Conflict Product',
    quantity: 5000, unit: 'dona', buyPrice: 10, sellPrice: 20, displayIndex: 20_000, stockEpoch: 0,
  };

  const allProducts = [...coldProducts, ...hotProducts, conflictProduct];
  await ProductModel.insertMany(allProducts);
  await InventoryEntryModel.insertMany(
    allProducts.map((p) => ({
      ownerAdminId, localId: `${today}-${p.localId}`, deviceId: 'load-harness', productId: p.localId,
      productName: p.name, unit: p.unit, date: today, startQuantity: p.quantity, currentQuantity: p.quantity,
      buyPrice: p.buyPrice, sellPrice: p.sellPrice, note: '',
    })),
  );

  const fixtures = {
    ownerAdminId,
    adminUsername: ADMIN_USERNAME,
    adminPassword: ADMIN_PASSWORD,
    coldProductIds: coldProducts.map((p) => p.localId),
    hotProductIds: hotProducts.map((p) => p.localId),
    conflictProductId: conflictProduct.localId,
    initialBuyPrice: 10,
    initialUnit: 'dona',
    initialStockEpoch: 0,
    businessDate: today,
  };
  writeFileSync(join(__dirname, 'fixtures.json'), JSON.stringify(fixtures, null, 2));
  console.log(`Seeded ${allProducts.length} products (${COLD_PRODUCT_COUNT} cold, ${HOT_PRODUCT_COUNT} hot, 1 conflict) + 1 superAdmin.`);
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
