import { env } from "./config/env";
import { connectDatabase } from "./lib/mongoose";
import { authService } from "./modules/auth/auth.service";
import { createApp } from "./app";
import { migrateLegacyProductRecords } from "./modules/products/product.migration";
import { migrateSplitCollections } from "./modules/migrations/split-collections.migration";

async function bootstrap() {
  await connectDatabase();
  const superAdmin = await authService.findSuperAdmin();

  if (superAdmin) {
    await authService.migrateLegacyOwnership(superAdmin._id.toString());
  }

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
