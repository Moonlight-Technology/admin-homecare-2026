import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * One structured line per request for operations (spec §10 logging): method, path, status, duration, request id and
 * user. The query string is left out on purpose — signed document links carry their token there — and bodies are
 * never logged, so no patient or credential data reaches the logs.
 */
@Injectable()
export class AccessLogMiddleware implements NestMiddleware {
  private readonly logger = new Logger('Access');

  use(request: Request & { requestId?: string; auth?: { userId: string } }, response: Response, next: NextFunction) {
    const started = process.hrtime.bigint();
    response.on('finish', () => {
      if (request.path.endsWith('/health')) return;
      const durationMs = Number((process.hrtime.bigint() - started) / 1_000_000n);
      const entry = { method: request.method, path: request.path, status: response.statusCode, durationMs, requestId: request.requestId, userId: request.auth?.userId ?? null };
      if (response.statusCode >= 500) this.logger.error(entry);
      else if (response.statusCode >= 400 || durationMs > 2000) this.logger.warn(entry);
      else this.logger.log(entry);
    });
    next();
  }
}
