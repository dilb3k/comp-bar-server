import { Router } from "express";

import { healthController } from "./health.controller";

const router = Router();

router.get("/", (_req, res) => {
  res.json({
    success: true,
    data: healthController.get()
  });
});

export const healthRoutes = router;
