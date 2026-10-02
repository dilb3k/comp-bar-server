import mongoose from 'mongoose';
import {ProductModel} from '../modules/products/product.model';
import {InventoryEntryModel} from '../modules/inventory/inventory.model';
import {DailySnapshotModel} from '../modules/snapshots/snapshot.model';
import {ProductTombstoneModel} from '../modules/products/product-tombstone.model';
import {IdempotencyKeyModel} from '../modules/idempotency/idempotency.model';
import {SubscriptionModel} from '../modules/subscriptions/subscription.model';
import {SubscriptionGrantModel} from '../modules/subscriptions/subscription-grant.model';
import {PaymentModel} from '../modules/payments/payment.model';
import {UserModel} from '../modules/auth/user.model';
import {ProcurementModel} from '../modules/procurements/procurement.model';
/** Fail closed before accepting traffic; migrations are a maintenance task. */
export async function verifyDatabaseReadiness() {
  const db=mongoose.connection.db!;
  const models=[ProductModel,InventoryEntryModel,DailySnapshotModel,ProductTombstoneModel,IdempotencyKeyModel,SubscriptionModel,SubscriptionGrantModel,PaymentModel,UserModel,ProcurementModel];
  const failures:string[]=[];
  for(const model of models) {
    const collection=model.collection.name;
    const indexes=await db.collection(collection).listIndexes().toArray().catch((error:any)=>{if(error.code===26)return [];throw error});
    for(const [key,options] of model.schema.indexes()) {
      if(!options.unique&&!['idx_owner_server_version','idx_owner_initial_pull'].includes(options.name??''))continue;
      if(!indexes.some(index=>JSON.stringify(index.key)===JSON.stringify(key)&&!!index.unique===!!options.unique&&!!index.sparse===!!options.sparse&&JSON.stringify(index.partialFilterExpression)===JSON.stringify(options.partialFilterExpression))) failures.push(`${collection}: ${options.name??JSON.stringify(key)}`);
    }
    if(['idempotency_keys','product_tombstones'].includes(collection)&&indexes.some(i=>i.expireAfterSeconds!==undefined))failures.push(`${collection}: remove legacy TTL`);
  }
  if(failures.length)throw Error(`Reliability migration required before serving writes: ${failures.join('; ')}`);
}
