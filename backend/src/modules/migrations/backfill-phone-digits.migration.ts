import { UserModel } from "../auth/user.model";
import { normalizePhone } from "../auth/auth.utils";

/**
 * Idempotent, safe-to-run-always healer — same shape as
 * fix-display-index.migration.ts.
 *
 * `phoneDigits` (see user.model.ts) is only computed going forward, by a
 * pre-save hook — it does nothing for documents that already existed before
 * that hook was added. Without this, findByPhone's new indexed query would
 * silently miss every admin created before this migration ran, since their
 * phoneDigits is still "". Backfills once per document, then is a no-op
 * (the query only ever matches documents still missing it).
 */
export async function migrateBackfillPhoneDigits(): Promise<void> {
  const cursor = UserModel.find({
    phone_number: { $exists: true, $nin: [null, ""] },
    $or: [{ phoneDigits: { $exists: false } }, { phoneDigits: "" }],
  }).cursor();

  let count = 0;
  for await (const user of cursor) {
    const digits = normalizePhone(user.phone_number);
    if (digits) {
      await UserModel.updateOne({ _id: user._id }, { $set: { phoneDigits: digits } });
      count++;
    }
  }

  if (count > 0) {
    console.log(`[migration] backfilled phoneDigits for ${count} user(s)`);
  }
}
