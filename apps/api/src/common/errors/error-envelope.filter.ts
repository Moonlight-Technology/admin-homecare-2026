import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { AppError } from './app-error';

export type ErrorEnvelope = { code: string; message: string; details?: unknown; requestId?: string };

const STATUS_CODES: Partial<Record<number, string>> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'TOO_MANY_REQUESTS',
};

/** Maps any thrown error to the standard envelope; internal details are logged, never returned. */
export function toEnvelope(error: unknown): { status: number; body: Omit<ErrorEnvelope, 'requestId'> } {
  if (error instanceof AppError) {
    return { status: error.status, body: { code: error.code, message: error.message, details: error.details } };
  }
  if (error instanceof ThrottlerException) {
    return { status: HttpStatus.TOO_MANY_REQUESTS, body: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests. Please try again later.' } };
  }
  if (error instanceof HttpException) {
    const status = error.getStatus();
    const response = error.getResponse();
    const message = typeof response === 'string' ? response : String((response as { message?: unknown }).message ?? error.message);
    return { status, body: { code: STATUS_CODES[status] ?? 'HTTP_ERROR', message } };
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      return { status: HttpStatus.CONFLICT, body: { code: 'DUPLICATE', message: 'A record with the same unique value already exists.', details: { fields: error.meta?.target } } };
    }
    if (error.code === 'P2025') {
      return { status: HttpStatus.NOT_FOUND, body: { code: 'NOT_FOUND', message: 'The requested resource was not found.' } };
    }
  }
  return { status: HttpStatus.INTERNAL_SERVER_ERROR, body: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } };
}

@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  private readonly logger = new Logger('Error');

  catch(error: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const request = http.getRequest<Request & { requestId?: string }>();
    const response = http.getResponse<Response>();
    const { status, body } = toEnvelope(error);
    if (status >= 500) this.logger.error({ requestId: request.requestId, path: request.path }, error instanceof Error ? error.stack : String(error));
    response.status(status).json({ ...body, requestId: request.requestId } satisfies ErrorEnvelope);
  }
}
