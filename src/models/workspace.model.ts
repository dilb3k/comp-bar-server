import { randomUUID } from "crypto";
import { model, Schema } from "mongoose";

type WorkspaceDocument = {
  id: string;
  name: string;
  createdAt: Date;
};

const workspaceSchema = new Schema<WorkspaceDocument>(
  {
    id: { type: String, default: randomUUID, unique: true, index: true },
    name: { type: String, required: true, trim: true }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const WorkspaceModel = model<WorkspaceDocument>("Workspace", workspaceSchema);
