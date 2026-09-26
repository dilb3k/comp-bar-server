import { Router } from "express";

import { asyncHandler } from "../../utils/async-handler";
import { inventoryController } from "./inventory.controller";

// Mounted separately from inventory.routes (its own authenticate({ allowStale:
// true }) at the app.ts mount point) so a device whose session was replaced
// elsewhere can still reach this one read-only endpoint with its old token —
// see auth.middleware's SESSION_REPLACED and the phone-verification screen's
// "view products" link.
const router = Router();

router.get("/", asyncHandler(inventoryController.preview));

export const inventoryPreviewRoutes = router;
