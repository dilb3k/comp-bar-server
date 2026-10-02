import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { verifyDatabaseReadiness } from '../lib/database-readiness';
import { ProductModel } from '../modules/products/product.model';
import { InventoryEntryModel } from '../modules/inventory/inventory.model';
import { DailySnapshotModel } from '../modules/snapshots/snapshot.model';
import { ProductTombstoneModel } from '../modules/products/product-tombstone.model';
import { IdempotencyKeyModel } from '../modules/idempotency/idempotency.model';
import { SubscriptionModel } from '../modules/subscriptions/subscription.model';
import { SubscriptionGrantModel } from '../modules/subscriptions/subscription-grant.model';
import { PaymentModel } from '../modules/payments/payment.model';
import { UserModel } from '../modules/auth/user.model';
import { ProcurementModel } from '../modules/procurements/procurement.model';
before(async()=>{
  assert.match(process.env.MONGODB_URL??'',/^mongodb:\/\/127\.0\.0\.1:\d+\/hisvex_integration\?/);
  await mongoose.connect(process.env.MONGODB_URL!.replace('/hisvex_integration?','/hisvex_readiness?'));
  await Promise.all([ProductModel,InventoryEntryModel,DailySnapshotModel,ProductTombstoneModel,IdempotencyKeyModel,SubscriptionModel,SubscriptionGrantModel,PaymentModel,UserModel,ProcurementModel].map(model=>model.init()));
});
after(async()=>{await mongoose.connection.dropDatabase();await mongoose.disconnect();});
test('readiness accepts migrated database including procurement indexes',async()=>{await verifyDatabaseReadiness();});
test('missing procurement unique index fails closed before serving writes',async()=>{
  await ProcurementModel.collection.dropIndex('idx_unique_owner_localid');
  await assert.rejects(verifyDatabaseReadiness(),/procurements/);
  await ProcurementModel.createIndexes();await verifyDatabaseReadiness();
});
test('legacy receipt TTL is rejected even when all required indexes exist',async()=>{
  await IdempotencyKeyModel.collection.createIndex({createdAt:1},{name:'legacy_ttl',expireAfterSeconds:100});
  await assert.rejects(verifyDatabaseReadiness(),/remove legacy TTL/);
  await IdempotencyKeyModel.collection.dropIndex('legacy_ttl');await verifyDatabaseReadiness();
});
