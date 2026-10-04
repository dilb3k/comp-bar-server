import { AsyncLocalStorage } from "node:async_hooks";
import mongoose, { Schema, type ClientSession } from "mongoose";

type Context = { session: ClientSession; owners: Map<string, number>; afterCommit: Array<() => void> };
const context = new AsyncLocalStorage<Context>();
const ownerSchema = new Schema({ _id: String, revision: { type: Number, default: 0 } },
  { collection: "owner_write_versions", versionKey: false });
export const OwnerWriteVersion = mongoose.models.OwnerWriteVersion ?? mongoose.model("OwnerWriteVersion", ownerSchema);

export const currentSession = () => context.getStore()?.session;
export const currentRevision = (owner: string) => context.getStore()?.owners.get(owner);

/** External effects must never run in a transaction callback MongoDB may retry. */
export function afterCommit(effect: () => void) {
  const scope = context.getStore();
  if (scope) scope.afterCommit.push(effect);
  else effect();
}

async function lockOwner(owner: string, scope: Context) {
  if (scope.owners.has(owner)) return;
  // A write conflicts only with this account. Unlike an expiring lease,
  // a crashed transaction releases the lock without losing operations.
  const fence: any = await OwnerWriteVersion.findOneAndUpdate({ _id: owner }, { $inc: { revision: 1 } },
    { new: true, session: scope.session });
  if (!fence) throw new Error("Missing owner write fence");
  scope.owners.set(owner, fence.revision);
}

export async function ensureOwnerFence(owner: string) {
  // Materialize the lock outside the transaction so two first-ever writers
  // retry a write conflict instead of aborting on an upsert E11000.
  try { await OwnerWriteVersion.updateOne({ _id: owner }, { $setOnInsert: { revision: 0 } }, { upsert: true }); }
  catch (error: any) { if (error?.code !== 11000) throw error; }
}

export async function transactionScope(owner: string) {
  const inherited = context.getStore();
  if (!inherited) await ensureOwnerFence(owner);
  const session = inherited?.session ?? await mongoose.startSession();
  return {
    session,
    async run<T>(work: () => Promise<T>): Promise<T> {
      if (inherited) { await lockOwner(owner, inherited); return work(); }
      let effects: Array<() => void> = [];
      const result = await session.withTransaction(async () => {
        const scope: Context = { session, owners: new Map(), afterCommit: [] };
        effects = scope.afterCommit;
        return context.run(scope, async () => { await lockOwner(owner, scope); return work(); });
      }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary" });
      for (const effect of effects) {
        try { effect(); } catch (error) { console.error("Post-commit notification failed", error); }
      }
      return result as T;
    },
    async close() { if (!inherited) await session.endSession(); },
  };
}

export async function withOwnerTransaction<T>(owner: string, work: (session: ClientSession) => Promise<T>): Promise<T> {
  const scope = await transactionScope(owner);
  try { return await scope.run(() => work(scope.session)); }
  finally { await scope.close(); }
}

/** Consistent multi-query reads without taking the account writer fence. */
export async function withReadSnapshot<T>(work:()=>Promise<T>):Promise<T> {
  if(currentSession()) return work();
  const session=await mongoose.startSession();
  try {
    return await session.withTransaction(()=>context.run({session,owners:new Map(),afterCommit:[]},work),{
      readConcern:{level:'snapshot'},readPreference:'primary',writeConcern:{w:'majority'},
    }) as T;
  } finally {await session.endSession()}
}
