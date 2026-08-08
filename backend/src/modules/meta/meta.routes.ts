import { Router } from "express";

import { metaController } from "./meta.controller";

const router = Router();

// Public/unauthenticated — the mobile app needs to check this before (or
// without) a logged-in session, same as it needs /health reachable pre-auth.
router.get("/app-version", (_req, res) => {
  res.json({
    success: true,
    data: metaController.getAppVersion()
  });
});

export const metaRoutes = router;
