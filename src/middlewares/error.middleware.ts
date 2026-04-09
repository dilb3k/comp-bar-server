import { NextFunction, Request, Response } from "express";
import { HttpError } from "../utils/http-error";

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction): void {
  next(new HttpError(404, "Route not found"));
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (error instanceof HttpError) {
    res.status(error.statusCode).json({
      success: false,
      message: error.message,
      details: error.details ?? null
    });
    return;
  }

  console.error(error);
  res.status(500).json({
    success: false,
    message: "Internal server error"
  });
}
