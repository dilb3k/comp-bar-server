import { Router } from "express";

import { asyncHandler } from "../../utils/async-handler";
import { metaController } from "./meta.controller";

const router = Router();

// Public/unauthenticated — the mobile app needs to check this before (or
// without) a logged-in session, same as it needs /health reachable pre-auth.
router.get(
  "/app-version",
  asyncHandler(async (_req, res) => {
    res.json({
      success: true,
      data: await metaController.getAppVersion()
    });
  })
);

export const metaRoutes = router;
