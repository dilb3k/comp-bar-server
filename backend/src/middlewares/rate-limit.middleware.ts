import rateLimit from "express-rate-limit";

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    success: false,
    error: {
      message: "Too many login attempts. Please try again after 15 minutes.",
      details: null
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
});

export const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 200,
  message: {
    success: false,
    error: {
      message: "Too many requests. Please try again later.",
      details: null
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
});

export const imageLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60,
  message: {
    success: false,
    error: {
      message: "Too many image requests. Please try again later.",
      details: null
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
});
