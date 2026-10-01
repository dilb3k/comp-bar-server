import type { Schema } from "mongoose";
import { currentRevision } from "./transaction";
import { AppError } from "../utils/app-error";

export function assertBaseVersion(current: { serverVersion?: number } | null, expected?: number) {
  if (expected === undefined || expected !== (current?.serverVersion ?? 0)) {
    throw new AppError("Ma’lumot boshqa qurilmada o‘zgargan. Qayta yuklang; yuborilmagan amal saqlanadi.", 409,
      { expected, actual: current?.serverVersion ?? 0 }, "STALE_VERSION");
  }
}

/** Client timestamps never determine conflict resolution or pull ordering. */
export function serverVersionPlugin(schema: Schema) {
  schema.add({ serverVersion: { type: Number, default: 0 } });
  schema.index({ ownerAdminId: 1, serverVersion: 1, _id: 1 }, { name: "idx_owner_server_version" });
  schema.index({ ownerAdminId: 1, _id: 1 }, { name: "idx_owner_initial_pull" });
  schema.pre("save", function(next) {
    const revision = currentRevision(String(this.get("ownerAdminId")));
    if (revision !== undefined) this.set("serverVersion", revision);
    next();
  });
  for (const operation of ["updateOne", "updateMany", "findOneAndUpdate"] as const) {
    schema.pre(operation, function(next) {
      const revision = currentRevision(String(this.getFilter().ownerAdminId));
      if (revision !== undefined) {
        const update: any = this.getUpdate() ?? {};
        if (Array.isArray(update)) update.push({ $set: { serverVersion: revision } });
        else { update.$set = { ...update.$set, serverVersion: revision }; if (update.$setOnInsert) delete update.$setOnInsert.serverVersion; }
        this.setUpdate(update);
      }
      next();
    });
  }
}
