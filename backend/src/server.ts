import { env } from "./config/env";
import { connectDatabase } from "./lib/mongoose";
import { authService } from "./modules/auth/auth.service";
import { createApp } from "./app";
import { migrateLegacyProductRecords } from "./modules/products/product.migration";
import { migrateSplitCollections } from "./modules/migrations/split-collections.migration";
import { migrateFixDisplayIndex } from "./modules/migrations/fix-display-index.migration";

async function bootstrap() {
  await connectDatabase();
  const superAdmin = await authService.findSuperAdmin();

  if (superAdmin?._id) {
    await authService.migrateLegacyOwnership(superAdmin._id.toString());
  }

  // Always heal the stale unique displayIndex index — idempotent, and it
  // prevents E11000 errors on product create/sync/reorder.
  await migrateFixDisplayIndex();

  if (env.MIGRATION_ENABLED) {
    await migrateSplitCollections();
    await migrateLegacyProductRecords();
  }

  const app = createApp();

  app.listen(env.PORT, () => {
    console.log(`Backend listening on http://localhost:${env.PORT}`);
  });
}

void bootstrap().catch((error) => {
  console.error("Failed to start server", error);
  process.exit(1);
});
