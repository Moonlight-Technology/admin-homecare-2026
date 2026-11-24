import { Logger, NotFoundException, type ArgumentsHost } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import { redact } from '../../modules/audit/redact';
import { AppError } from './app-error';
import { ErrorEnvelopeFilter, toEnvelope } from './error-envelope.filter';
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

  it('maps persistent database connectivity errors to 503 without leaking diagnostics', () => {
    const error = new Prisma.PrismaClientKnownRequestError('postgres://secret user/password host/query', { code: 'P1017', clientVersion: 'test' });
    expect(toEnvelope(error)).toEqual({ status: 503, body: { code: 'DATABASE_UNAVAILABLE', message: 'Database temporarily unavailable. Check the current state before retrying.' } });
    expect(JSON.stringify(toEnvelope(error))).not.toContain('secret');
    expect(toEnvelope(new Prisma.PrismaClientKnownRequestError('missing table', { code: 'P2021', clientVersion: 'test' })).status).toBe(500);
  });

  it('returns retry guidance and the correlation ID on a database outage', () => {
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    try {
      const response = { setHeader: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };
      const host = { switchToHttp: () => ({ getRequest: () => ({ requestId: 'test-request', path: '/api/v1/documents/test/upload' }), getResponse: () => response }) } as unknown as ArgumentsHost;
      new ErrorEnvelopeFilter().catch(new Prisma.PrismaClientKnownRequestError('Connection closed', { code: 'P1017', clientVersion: 'test' }), host);
      expect(response.status).toHaveBeenCalledWith(503);
      expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '2');
      expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'DATABASE_UNAVAILABLE', requestId: 'test-request' }));
    } finally { log.mockRestore(); }
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
