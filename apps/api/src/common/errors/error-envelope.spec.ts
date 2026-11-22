import { NotFoundException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import { redact } from '../../modules/audit/redact';
import { AppError } from './app-error';
import { toEnvelope } from './error-envelope.filter';
import { fieldErrors } from './validation';

describe('toEnvelope', () => {
  it('keeps business error codes and details', () => {
    expect(toEnvelope(AppError.conflict('ORDER_ALREADY_DECIDED', 'Already decided', { status: 'CONFIRMED' }))).toEqual({
      status: 409,
      body: { code: 'ORDER_ALREADY_DECIDED', message: 'Already decided', details: { status: 'CONFIRMED' } },
    });
  });

  it('maps throttling, framework, and Prisma errors to stable codes', () => {
    expect(toEnvelope(new ThrottlerException()).body.code).toBe('TOO_MANY_REQUESTS');
    expect(toEnvelope(new NotFoundException()).status).toBe(404);
    const duplicate = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test', meta: { target: ['code'] } });
    expect(toEnvelope(duplicate)).toMatchObject({ status: 409, body: { code: 'DUPLICATE' } });
  });

  it('never leaks internal error messages', () => {
    expect(toEnvelope(new Error('connection string postgres://secret'))).toEqual({
      status: 500,
      body: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
    });
  });
});

describe('fieldErrors', () => {
  it('flattens nested validation errors to dotted field names', () => {
    expect(fieldErrors([{ property: 'address', children: [{ property: 'line', constraints: { isNotEmpty: 'line should not be empty' }, children: [] }] }])).toEqual({
      'address.line': ['line should not be empty'],
    });
  });
});

describe('redact', () => {
  it('removes secrets and clinical fields at any depth', () => {
    expect(redact({ email: 'a@b.test', passwordHash: 'x', nested: { refreshToken: 'y', numberEncrypted: 'z', medicalHistory: 'h', name: 'ok' } })).toEqual({
      email: 'a@b.test',
      passwordHash: '[redacted]',
      nested: { refreshToken: '[redacted]', numberEncrypted: '[redacted]', medicalHistory: '[redacted]', name: 'ok' },
    });
  });
});
