import type { NextFunction, Request, RequestHandler, Response } from "express";

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

export const asyncHandler = (handler: AsyncHandler): RequestHandler => (req, res, next) => {
  void handler(req, res, next).catch(next);
};
