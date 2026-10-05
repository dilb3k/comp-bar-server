import { parentPort } from "node:worker_threads";
import { procurementExport } from "../modules/procurements/procurement.export";

// Pure formatting worker: no app/env imports and no MongoDB client/pool.
parentPort!.on("message", async ({ data, format }) => {
  try {
    const result = await procurementExport(data, format);
    const bytes = Uint8Array.from(typeof result.body === "string" ? Buffer.from(result.body) : result.body);
    parentPort!.postMessage({ mime: result.mime, body: bytes }, [bytes.buffer]);
  } catch { parentPort!.postMessage({ error: true }); }
});
