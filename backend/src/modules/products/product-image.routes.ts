import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { productImageRepository } from "./product-image.repository";
import { AppError } from "../../utils/app-error";

const router = Router();

router.get(
  "/image/:hash",
  asyncHandler(async (req, res) => {
    const hash = String(req.params.hash);
    const image = await productImageRepository.findByHash(hash);
    if (!image) {
      throw new AppError("Image not found", 404);
    }
    const mimeType = image.mimeType || "image/webp";
    const buffer = Buffer.from(image.data, "base64");
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Length", buffer.length);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.end(buffer);
  })
);

export const productImageRoutes = router;
