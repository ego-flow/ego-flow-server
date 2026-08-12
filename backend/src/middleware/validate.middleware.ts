import type { NextFunction, Request, Response } from "express";
import type { ZodTypeAny } from "zod";

export type ValidationTarget = "body" | "query" | "params";

export const validate =
  (schema: ZodTypeAny, target: ValidationTarget = "body") =>
  async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const parsed = await schema.parseAsync(req[target]);
      Object.defineProperty(req, target, {
        value: parsed,
        writable: true,
        enumerable: true,
        configurable: true,
      });
      return next();
    } catch (error) {
      return next(error);
    }
  };
