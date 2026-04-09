import { app } from "./app";
import { env } from "./config/env";
import { connectMongo, disconnectMongo } from "./lib/mongo";

async function start(): Promise<void> {
  await connectMongo();
  const server = app.listen(env.PORT, () => {
    console.log(`Server started on port ${env.PORT}`);
  });

  async function gracefulShutdown(signal: string): Promise<void> {
    console.log(`Received ${signal}, shutting down...`);
    server.close(async () => {
      await disconnectMongo();
      process.exit(0);
    });
  }

  process.on("SIGINT", () => {
    void gracefulShutdown("SIGINT");
  });

  process.on("SIGTERM", () => {
    void gracefulShutdown("SIGTERM");
  });
}

void start();
