import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { AuditLogModel } from "../models/audit-log.model";
import { UserModel } from "../models/user.model";
import { WorkspaceModel } from "../models/workspace.model";
import { UserRole } from "../types/domain";
import { HttpError } from "../utils/http-error";
import { signAccessToken } from "../utils/jwt";

type RegisterInput = {
  workspaceName?: string;
  workspaceId?: string;
  name: string;
  email: string;
  password: string;
  role?: UserRole;
};

type LoginInput = {
  email: string;
  password: string;
};

export const authService = {
  async register(input: RegisterInput) {
    const existingUser = await UserModel.findOne({ email: input.email.toLowerCase() }).lean();
    if (existingUser) {
      throw new HttpError(409, "Email is already registered");
    }

    const passwordHash = await bcrypt.hash(input.password, 10);
    const role: UserRole = input.workspaceName ? "admin" : input.role ?? "staff";
    const session = await mongoose.startSession();

    let output:
      | {
          workspace: { id: string; name: string; createdAt: Date };
          user: { id: string; workspaceId: string; name: string; email: string; role: UserRole };
        }
      | undefined;

    try {
      await session.withTransaction(async () => {
        const workspace = input.workspaceId
          ? await WorkspaceModel.findOne({ id: input.workspaceId }).session(session)
          : await WorkspaceModel.create(
              [
                {
                  name: input.workspaceName
                }
              ],
              { session }
            ).then((rows) => rows[0]);

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
              actorId: user.id,
              action: "USER_REGISTERED",
              entityType: "User",
              entityId: user.id,
              meta: { email: user.email, role: user.role }
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

    const token = signAccessToken({
      userId: output.user.id,
      workspaceId: output.workspace.id,
      role: output.user.role
    });

    return {
      token,
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
