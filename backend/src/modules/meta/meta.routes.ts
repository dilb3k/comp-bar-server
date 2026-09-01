import cors from "cors";
import { Router } from "express";

import { asyncHandler } from "../../utils/async-handler";
import { metaController } from "./meta.controller";

const router = Router();

// Any origin, on this route only. The app-wide CORS allowlist exists to
// protect endpoints that carry a session; this one carries a version string
// and public download links, and is read by the marketing site, which is a
// different origin from the web app and would otherwise be blocked. Scoped
// here rather than widening the global policy, and without credentials, so
// nothing authenticated is reachable cross-origin as a side effect.
const publicCors = cors({ origin: "*", credentials: false, methods: ["GET"] });

// Public/unauthenticated — the mobile app needs to check this before (or
// without) a logged-in session, same as it needs /health reachable pre-auth.
router.get(
  "/app-version",
  publicCors,
  asyncHandler(async (_req, res) => {
    // Short shared-cache hint: the values change only when a release is
    // published, and the module-level cache behind this is 10 minutes anyway.
    res.set("Cache-Control", "public, max-age=300");
    res.json({
      success: true,
      data: await metaController.getAppVersion()
    });
  })
);

router.options("/app-version", publicCors);

export const metaRoutes = router;
