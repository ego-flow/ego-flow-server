import type { NextFunction, Request, Response } from "express";

import { BadRequest } from "../lib/errors";
import { httpStreamChunkHeadersSchema } from "../schemas/stream.schema";

export const parseHttpStreamChunk = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const parsedHeaders = httpStreamChunkHeadersSchema.parse(req.headers);
    if (!Buffer.isBuffer(req.body)) {
      throw BadRequest("Chunk body must use application/octet-stream.");
    }

    req.httpStreamChunk = {
      sequence: parsedHeaders["x-chunk-sequence"],
      offset: parsedHeaders["x-chunk-offset"],
      chunk: req.body,
    };

    return next();
  } catch (error) {
    return next(error);
  }
};
