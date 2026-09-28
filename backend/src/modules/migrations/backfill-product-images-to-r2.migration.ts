import mongoose from "mongoose";

import { isR2Enabled, uploadImage } from "../../lib/r2";
import { buildImageKey, processImageToWebp } from "../../utils/image-processing";
import { ProductImageModel } from "../products/product-image.model";
import { ProductModel } from "../products/product.model";

const HASH_REGEX = /^[a-f0-9]{64}$/;

/**
 * One-shot backfill: every product still carrying a legacy `image` hash
 * (data stored as base64 in the product_images collection — see
 * product-image.model.ts) gets that photo re-encoded through sharp and
 * uploaded to R2, with the result written to `imageUrl`. Gated by
 * MIGRATION_ENABLED like the other one-shot migrations in this directory —
 * it only needs to run once per environment, not on every boot.
 *
 * Idempotent: the query only selects products where `imageUrl` is still
 * unset, so re-running it (e.g. after fixing R2 credentials mid-run, or
 * after fixing a transient upload failure) only picks up what's left.
 *
 * Deliberately non-destructive: the legacy `image` hash and its
 * product_images document are never touched or deleted. If this migration
 * or a future R2 read ever fails, GET /api/products/image/:hash is still
 * there as a fallback — see product-image.routes.ts.
 */
export async function migrateProductImagesToR2() {
  if (mongoose.connection.readyState !== 1) return;

  if (!isR2Enabled()) {
    console.warn(
      "[migrateProductImagesToR2] R2 is not configured (R2_* env vars) — skipping. " +
        "Configure R2 and re-run with MIGRATION_ENABLED=true to backfill legacy images."
    );
    return;
  }

  const cursor = ProductModel.find({
    imageUrl: null,
    image: HASH_REGEX,
  }).cursor();

  let migrated = 0;
  let missingLegacyDoc = 0;
  let failed = 0;

  for await (const product of cursor) {
    const hash = (product as any).image as string;

    let legacyImage;
    try {
      legacyImage = await ProductImageModel.findOne({ hash });
    } catch (error) {
      failed++;
      console.error(
        `[migrateProductImagesToR2] Could not read legacy image for product ${product._id}:`,
        (error as Error).message,
      );
      continue;
    }

    if (!legacyImage) {
      // Hash-shaped `image` value with no matching product_images doc —
      // stale reference, nothing to migrate. Leave it; it already falls
      // through to a 404 on the legacy route today, unchanged by this
      // migration.
      missingLegacyDoc++;
      continue;
    }

    try {
      const buffer = Buffer.from(legacyImage.data, "base64");
      const processed = await processImageToWebp(buffer);
      const key = buildImageKey(processed.hash);
      const imageUrl = await uploadImage(processed.buffer, key, processed.contentType);

      await ProductModel.updateOne({ _id: product._id }, { $set: { imageUrl } });
      migrated++;
    } catch (error) {
      failed++;
      console.error(
        `[migrateProductImagesToR2] Failed to migrate product ${product._id}:`,
        (error as Error).message,
      );
    }
  }

  console.log(
    `[migrateProductImagesToR2] Done. migrated=${migrated} missingLegacyDoc=${missingLegacyDoc} failed=${failed}`,
  );
}
