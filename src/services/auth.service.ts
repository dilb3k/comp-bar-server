import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { AuditLogModel } from "../models/audit-log.model";
import { UserModel } from "../models/user.model";
import { WorkspaceModel } from "../models/workspace.model";
import { UserRole } from "../types/domain";
import { HttpError } from "../utils/http-error";
import { AuthPayload, signAccessToken } from "../utils/jwt";

type RegisterInput = {
  workspaceId?: string;
  name: string;
  email: string;
  password: string;
  role?: "staff";
};

type LoginInput = {
  email: string;
  password: string;
};

export const authService = {
  async register(input: RegisterInput, actor?: AuthPayload) {
    if (!actor) {
      throw new HttpError(401, "Unauthorized");
    }

    if (actor.role !== "admin") {
      throw new HttpError(403, "Forbidden");
    }

    const workspaceId = input.workspaceId ?? actor.workspaceId;
    if (workspaceId !== actor.workspaceId) {
      throw new HttpError(403, "You can only create staff for your own workspace");
    }

    const role: UserRole = input.role ?? "staff";
    if (role !== "staff") {
      throw new HttpError(400, "Only staff accounts can be created from this endpoint");
    }

    const existingUser = await UserModel.findOne({ email: input.email.toLowerCase() }).lean();
    if (existingUser) {
      throw new HttpError(409, "Email is already registered");
    }

    const passwordHash = await bcrypt.hash(input.password, 10);
    const session = await mongoose.startSession();

    let output:
      | {
          workspace: { id: string; name: string; createdAt: Date };
          user: { id: string; workspaceId: string; name: string; email: string; role: UserRole };
        }
      | undefined;

    try {
      await session.withTransaction(async () => {
        const workspace = await WorkspaceModel.findOne({ id: workspaceId }).session(session);

        if (!workspace) {
          throw new HttpError(404, "Workspace not found");
        }

        const user = await UserModel.create(
          [
            {
              workspaceId: workspace.id,
              name: input.name,
              email: input.email.toLowerCase(),
              passwordHash,
              role
            }
          ],
          { session }
        ).then((rows) => rows[0]);

        await AuditLogModel.create(
          [
            {
              workspaceId: workspace.id,
              actorId: actor.userId,
              action: "USER_REGISTERED",
              entityType: "User",
              entityId: user.id,
              meta: {
                email: user.email,
                role: user.role,
                createdBy: actor.userId
              }
            }
          ],
          { session }
        );

        output = {
          workspace: {
            id: workspace.id,
            name: workspace.name,
            createdAt: workspace.createdAt
          },
          user: {
            id: user.id,
            workspaceId: user.workspaceId,
            name: user.name,
            email: user.email,
            role: user.role
          }
        };
      });
    } finally {
      await session.endSession();
    }

    if (!output) {
      throw new HttpError(500, "Failed to register user");
    }

    return {
      user: output.user,
      workspace: output.workspace
    };
  },

  async login(input: LoginInput) {
    const user = await UserModel.findOne({ email: input.email.toLowerCase() }).lean();
    if (!user) {
      throw new HttpError(401, "Invalid credentials");
    }

    const matches = await bcrypt.compare(input.password, user.passwordHash);
    if (!matches) {
      throw new HttpError(401, "Invalid credentials");
    }

    const token = signAccessToken({
      userId: user.id,
      workspaceId: user.workspaceId,
      role: user.role
    });

    return {
      token,
      user: {
        id: user.id,
        workspaceId: user.workspaceId,
        name: user.name,
        email: user.email,
        role: user.role
      }
    };
  }
};
