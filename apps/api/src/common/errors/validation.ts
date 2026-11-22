import type { ValidationError } from 'class-validator';
import { AppError } from './app-error';

/** Flattens class-validator errors to `{ field: [messages] }`, nested fields joined with dots. */
export function fieldErrors(errors: ValidationError[], parent = ''): Record<string, string[]> {
  return errors.reduce<Record<string, string[]>>((result, error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    if (error.constraints) result[field] = Object.values(error.constraints);
    if (error.children?.length) Object.assign(result, fieldErrors(error.children, field));
    return result;
  }, {});
}

/** Field-specific 422 for invalid input (AC-FAC-02 style errors). */
export const validationException = (errors: ValidationError[]) =>
  AppError.unprocessable('VALIDATION_FAILED', 'Some fields are invalid.', { fields: fieldErrors(errors) });
