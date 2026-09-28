import multer from "multer";

import { AppError } from "../utils/app-error";

const ALLOWED_IMAGE_MIME_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"];

// Memory storage: files are small (capped below) and get piped straight into
// sharp, so there's no reason to touch disk. Raw upload cap is 10MB — well
// above what a phone photo needs — because the actual size that matters is
// the post-compression WebP (capped separately at 200KB, see
// utils/image-processing.ts); this limit only exists to stop someone posting
// an absurdly large file and burning CPU on it before it's even decoded.
export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.mimetype.toLowerCase())) {
      cb(new AppError("Unsupported image type", 422));
      return;
    }
    cb(null, true);
  },
});
