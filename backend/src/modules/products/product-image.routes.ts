import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { productImageRepository } from "./product-image.repository";
import { AppError } from "../../utils/app-error";
import { sendSuccess } from "../../utils/response";

const router = Router();

router.get(
  "/image/:hash",
  asyncHandler(async (req, res) => {
    const hash = String(req.params.hash);
    const image = await productImageRepository.findByHash(hash);
    if (!image) {
      throw new AppError("Image not found", 404);
    }
    return sendSuccess(res, { hash: image.hash, data: image.data, mimeType: image.mimeType });
  })
);

export const productImageRoutes = router;
