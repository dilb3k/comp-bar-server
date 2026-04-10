import { Router } from "express";
import { authController } from "../controllers/auth.controller";
import { requireAuth, requireRole } from "../middlewares/auth.middleware";
import { validate } from "../middlewares/validate.middleware";
import { loginSchema, registerSchema } from "../validators/auth.validator";

const authRouter = Router();

authRouter.post(
  "/register",
  requireAuth,
  requireRole(["admin"]),
  validate({ body: registerSchema }),
  authController.register
);
authRouter.post("/login", validate({ body: loginSchema }), authController.login);
authRouter.get("/me", requireAuth, authController.me);

export { authRouter };
