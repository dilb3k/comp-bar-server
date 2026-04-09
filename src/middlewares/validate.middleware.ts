import { NextFunction, Request, Response } from "express";
import { z, ZodTypeAny } from "zod";
import { HttpError } from "../utils/http-error";

type ValidationShape = {
  body?: ZodTypeAny;
  params?: ZodTypeAny;
  query?: ZodTypeAny;
};

export function validate(schema: ValidationShape) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schema.body) {
        req.body = schema.body.parse(req.body);
      }
      if (schema.params) {
        req.params = schema.params.parse(req.params);
      }
      if (schema.query) {
        req.query = schema.query.parse(req.query) as Request["query"];
      }
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        next(new HttpError(400, "Validation error", error.flatten()));
        return;
      }
      next(error);
    }
  };
}
