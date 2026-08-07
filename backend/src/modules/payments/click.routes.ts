import { Router } from "express";

import { asyncHandler } from "../../utils/async-handler";
import { clickController } from "./payment.controller";

// Click calls these directly from their servers — no auth header at all,
// only the MD5 signature verified inside each handler (see click.service.ts).
// Mounted at /api/payments/click in app.ts, deliberately OUTSIDE both
// authenticate() and botAuth.
const router = Router();

router.post("/prepare", asyncHandler(clickController.prepare));
router.post("/complete", asyncHandler(clickController.complete));

export const clickWebhookRoutes = router;
