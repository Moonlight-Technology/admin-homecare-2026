import { HttpStatus } from '@nestjs/common';

/** Business error carried to the client in the standard envelope `{ code, message, details, requestId }` (spec §8). */
export class AppError extends Error {
  constructor(
    readonly status: HttpStatus,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }

  static unauthorized(message = 'Authentication is required.') {
    return new AppError(HttpStatus.UNAUTHORIZED, 'UNAUTHORIZED', message);
  }

  static forbidden(message = 'You do not have permission to perform this action.') {
    return new AppError(HttpStatus.FORBIDDEN, 'FORBIDDEN', message);
  }

  /** Also used for records outside the caller's scope, so their existence does not leak (spec §8). */
  static notFound(message = 'The requested resource was not found.') {
    return new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', message);
  }

  static conflict(code: string, message: string, details?: unknown) {
    return new AppError(HttpStatus.CONFLICT, code, message, details);
  }

  static unprocessable(code: string, message: string, details?: unknown) {
    return new AppError(HttpStatus.UNPROCESSABLE_ENTITY, code, message, details);
  }
}
