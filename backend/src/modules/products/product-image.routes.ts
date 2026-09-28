import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { imageLimiter } from "../../middlewares/rate-limit.middleware";
import { productImageRepository } from "./product-image.repository";
import { AppError } from "../../utils/app-error";

const router = Router();

// LEGACY (deprecated) — serves images written before the R2 migration.
// New products carry their photo URL directly on `imageUrl`
// (Product.imageUrl, an R2 URL) and never need this route. Kept so old
// products' `image` hashes keep resolving.
router.get(
  "/image/:hash",
  imageLimiter,
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
