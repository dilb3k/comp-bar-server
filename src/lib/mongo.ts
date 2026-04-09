import mongoose from "mongoose";
import dns from "node:dns";
import { env } from "../config/env";

let isConnected = false;
type MongoDnsError = NodeJS.ErrnoException & { hostname?: string };
type GenericError = NodeJS.ErrnoException & { message?: string };

function maybeApplyCustomDns(uri: string): void {
  if (uri.startsWith("mongodb+srv://") && env.MONGODB_DNS_SERVERS) {
    const servers = env.MONGODB_DNS_SERVERS.split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    if (servers.length > 0) {
      dns.setServers(servers);
      console.log(`[mongo] Using custom DNS servers: ${servers.join(", ")}`);
    }
  }
}

function printTroubleshootingHints(error: unknown): void {
  const err = error as GenericError;
  const msg = String(err?.message ?? "");
  const code = String(err?.code ?? "");

  const hasTlsAlert =
    code.includes("ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR") ||
    msg.includes("ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR") ||
    msg.includes("tlsv1 alert internal error");

  const isServerSelection = msg.includes("MongooseServerSelectionError");

  if (hasTlsAlert || isServerSelection) {
    console.error("[mongo] Atlas connection failed during network/TLS negotiation.");
    console.error(
      "[mongo] Check Atlas IP Access List: add your current public IP or 0.0.0.0/0 (dev-only)."
    );
    console.error(
      "[mongo] If you're on office/campus network, VPN, or antivirus HTTPS inspection, try another network/hotspot."
    );
    console.error(
      `[mongo] Node runtime detected: ${process.version}. If issue persists, try Node 22 LTS.`
    );
  }
}

async function connectWithUri(uri: string): Promise<void> {
  maybeApplyCustomDns(uri);
  await mongoose.connect(uri);
}

export async function connectMongo(): Promise<void> {
  if (isConnected) return;

  try {
    await connectWithUri(env.MONGODB_URL);
    isConnected = true;
    console.log("[mongo] Connected.");
  } catch (error) {
    const err = error as MongoDnsError;
    const isSrvDnsRefused =
      err?.code === "ECONNREFUSED" &&
      err?.syscall === "querySrv" &&
      typeof err?.hostname === "string" &&
      err.hostname.startsWith("_mongodb._tcp.");

    if (isSrvDnsRefused) {
      console.error(
        "[mongo] DNS SRV lookup failed. Your network DNS blocked/refused SRV records."
      );
      console.error(
        "[mongo] Set MONGODB_DNS_SERVERS=1.1.1.1,8.8.8.8 in .env and retry."
      );
    }

    printTroubleshootingHints(error);

    if (env.MONGODB_FALLBACK_URL) {
      console.error("[mongo] Trying fallback MongoDB URL...");
      try {
        await connectWithUri(env.MONGODB_FALLBACK_URL);
        isConnected = true;
        console.log("[mongo] Connected using fallback URL.");
        return;
      } catch (fallbackError) {
        printTroubleshootingHints(fallbackError);
        throw fallbackError;
      }
    }

    throw error;
  }
}

export async function disconnectMongo(): Promise<void> {
  if (!isConnected) return;
  await mongoose.disconnect();
  isConnected = false;
}
