import { env } from "./config/env";
import { connectDatabase } from "./lib/mongoose";
import { createApp } from "./app";

async function bootstrap() {
  await connectDatabase();
  const app = createApp();

  app.listen(env.PORT, () => {
    console.log(`Backend listening on http://localhost:${env.PORT}`);
  });
}

void bootstrap().catch((error) => {
  console.error("Failed to start server", error);
  process.exit(1);
});
