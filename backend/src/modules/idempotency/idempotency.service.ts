import { createHash } from "node:crypto";
import { withOwnerTransaction, currentSession } from "../../lib/transaction";
import { AppError } from "../../utils/app-error";
import { IdempotencyKeyModel, type IIdempotencyKey } from "./idempotency.model";

type Result<T> = { status: number; data: T };
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => [k, canonical(v)]));
  return value;
}

/** A durable receipt is committed atomically with all business writes. */
export async function withIdempotency<T>(
  ownerAdminId: string, key: string | undefined, fn: () => Promise<Result<T>>,
  request?: { operation: string; payload: unknown },
): Promise<Result<T>> {
  if (!key || typeof key !== 'string' || key.length > 200) throw new AppError("A stable operation ID is required", 422, undefined, "IDEMPOTENCY_KEY_REQUIRED");
  const fingerprint = request ? createHash("sha256").update(JSON.stringify(canonical(request))).digest("hex") : undefined;
  function replay(existing: IIdempotencyKey): Result<T> {
    if(request&&!existing.fingerprint)throw new AppError("Legacy operation receipt cannot verify this intent; retain it for reconciliation",409,undefined,"LEGACY_RECEIPT_RECONCILIATION_REQUIRED");
    if (existing.fingerprint && fingerprint !== existing.fingerprint) {
      throw new AppError("Operation ID was already used for a different request", 409, undefined, "IDEMPOTENCY_CONFLICT");
    }
    if (existing.state === "IN_PROGRESS") throw new AppError("Operation is still being processed", 409, undefined, "OPERATION_IN_PROGRESS");
    return { status: existing.responseStatus, data: existing.responseBody as T };
  }
  if (key && !currentSession()) {
    // Completed receipts are immutable. Positive hits can bypass the writer
    // fence, which prevents retry storms from serializing fresh operations.
    const completed = await IdempotencyKeyModel.findOne({ ownerAdminId, key, state: "COMPLETED" })
      .read("primary").readConcern("majority").lean<IIdempotencyKey>();
    if (completed) return replay(completed);
  }
  return withOwnerTransaction(ownerAdminId, async (session) => {
    if (key) {
      const existing = await IdempotencyKeyModel.findOne({ ownerAdminId, key }).session(session).lean<IIdempotencyKey>();
      if (existing) return replay(existing);
    }
    // Claim BEFORE running the business callback. Claim, writes and receipt
    // share one transaction, so a crash rolls them ALL back. An unknown commit
    // outcome is resolved by retrying this same key, never a new operation.
    if (key) await IdempotencyKeyModel.create([{ ownerAdminId, key, fingerprint, request, state: "IN_PROGRESS" }], { session });
    const result = await fn();
    if (key) await IdempotencyKeyModel.updateOne({ ownerAdminId, key, state: "IN_PROGRESS" }, { $set: {
      state: "COMPLETED", responseStatus: result.status,
      responseBody: JSON.parse(JSON.stringify(result.data)),
    } }, { session });
    return result;
  });
}
