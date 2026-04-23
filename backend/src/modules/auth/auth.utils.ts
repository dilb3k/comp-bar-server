import jwt, { type SignOptions } from "jsonwebtoken";

import { env } from "../../config/env";
import type { AuthUser } from "./auth.types";

export function signAccessToken(payload: AuthUser) {
  const options: SignOptions = {
    expiresIn: env.JWT_EXPIRES_IN as SignOptions["expiresIn"]
  };

  return jwt.sign(payload, env.JWT_SECRET, options);
}

export function verifyAccessToken(token: string) {
  return jwt.verify(token, env.JWT_SECRET) as AuthUser & {
    iat: number;
    exp: number;
  };
}
