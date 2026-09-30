import { IdempotencyKeyModel, type IIdempotencyKey } from "./idempotency.model";

type Result<T> = { status: number; data: T };

/**
 * Runs `fn` at most once per (ownerAdminId, key). A second call with the same
 * key returns the first call's actual result instead of re-running `fn` —
 * the guard a client-side offline queue or a network-retry needs so
 * replaying a mutating request (sale, stock adjustment, start-day) after the
 * original already succeeded doesn't apply it twice.
 *
 * No key (undefined/empty — an older client, or a read-only/idempotent-by-
 * nature caller) just runs `fn` directly with no dedup bookkeeping at all;
 * this is opt-in, not a requirement every caller must satisfy.
 */
export async function withIdempotency<T>(
  ownerAdminId: string,
  key: string | undefined,
  fn: () => Promise<Result<T>>,
): Promise<Result<T>> {
  if (!key) {
    return fn();
  }

  const existing = (await IdempotencyKeyModel.findOne({ ownerAdminId, key }).lean()) as IIdempotencyKey | null;
  if (existing) {
    return { status: existing.responseStatus, data: existing.responseBody as T };
  }

  const result = await fn();

  try {
    await IdempotencyKeyModel.create({
      ownerAdminId,
      key,
      responseStatus: result.status,
      responseBody: result.data,
    });
  } catch (error: any) {
    if (error?.code === 11000) {
      // Lost a race to a concurrent request with the same key — `fn` already
      // ran twice (unavoidable without locking before the operation itself,
      // which would need every caller's business logic to support that),
      // but from here on both callers converge on whichever one's result
      // landed first, so a THIRD retry of this same key is still safe.
      const winner = (await IdempotencyKeyModel.findOne({ ownerAdminId, key }).lean()) as IIdempotencyKey | null;
      if (winner) {
        return { status: winner.responseStatus, data: winner.responseBody as T };
      }
    } else {
      // Bookkeeping failure shouldn't fail an operation that already
      // succeeded — the request just won't be deduped if retried again.
      console.error("[idempotency] failed to persist key, dedup won't apply to a retry", error);
    }
  }

  return result;
}
