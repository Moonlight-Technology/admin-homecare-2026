import type { OpenAPIObject, OperationObject, ResponseObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;
type DocumentedOperation = OperationObject & { 'x-access'?: { kind: string; permissions?: string[] } };

export function operationsOf(document: OpenAPIObject) {
  return Object.entries(document.paths).flatMap(([path, item]) => METHODS.flatMap((method) => {
    const operation = item[method] as DocumentedOperation | undefined;
    return operation ? [{ path, method, operation }] : [];
  }));
}

/** Enrich documentation only; routing, guards, serialization and business rules stay in their existing modules. */
export function completeOpenApiDocument(document: OpenAPIObject): OpenAPIObject {
  document.components ??= {};
  document.components.schemas ??= {};
  document.components.schemas.ErrorEnvelope = {
    type: 'object', required: ['code', 'message'],
    properties: {
      code: { type: 'string', example: 'VALIDATION_FAILED' },
      message: { type: 'string', example: 'Some fields are invalid.' },
      details: { nullable: true, description: 'Optional error-specific details; validation uses details.fields.' },
      requestId: { type: 'string', description: 'Request correlation ID, also available as X-Request-Id.' },
    },
  };
  const errors: Record<string, string> = {
    '400': 'Malformed request or invalid path parameter.',
    '401': 'Missing, invalid, or expired credentials.',
    '403': 'Insufficient permission, invalid facility scope, Origin, or signed document token.',
    '404': 'Resource not found or not visible in the current scope.',
    '409': 'Duplicate record, conflicting state, capacity, or idempotency key.',
    '422': 'DTO validation or domain validation failed. See details.fields when present.',
    '429': 'Too many requests. Retry after the rate-limit window.',
    '500': 'Unexpected server error; report the requestId to the operator.',
    '503': 'DATABASE_UNAVAILABLE: temporary database connection/pool failure. Retry-After: 2 seconds; check state before retrying writes.',
  };
  for (const { path, method, operation } of operationsOf(document)) {
    const access = operation['x-access'];
    const action = operation.operationId?.split('_').slice(1).join(' ') || method;
    operation.summary ||= `${action.replace(/([a-z])([A-Z])/g, '$1 $2')} — ${operation.tags?.[0] ?? path}`;
    const permissions = access?.permissions ?? [];
    if (permissions.length) operation.description = [operation.description, `Akses ${access!.kind}: semua permission berikut wajib dimiliki: ${permissions.map((value) => `\`${value}\``).join(', ')}.`].filter(Boolean).join('\n\n');
    operation.responses ??= {};
    for (const [status, description] of Object.entries(errors)) {
      operation.responses[status] ??= { description, content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } } };
    }
    for (const [status, response] of Object.entries(operation.responses)) {
      if (!status.startsWith('2') || !response || '$ref' in response) continue;
      const result = response as ResponseObject;
      result.description ||= status === '204' ? 'Success. No response body.' : 'Success. Returns the endpoint result directly; no data/success wrapper.';
    }
    if (path.endsWith('/bookings')) operation.responses['503'] = { description: `${errors['503']} BOOKINGS_DISABLED: BOOKINGS_API_KEY is not configured.`, content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } } };
  }
  return document;
}

/** Generated from the same document served in Swagger UI, including factory-generated taxonomy controllers. */
export function endpointReference(document: OpenAPIObject): string {
  const operations = operationsOf(document);
  const lines = ['# Nakes API — daftar endpoint', '', 'Dihasilkan oleh `pnpm contracts:generate`. Panduan penggunaan: [SWAGGER.md](SWAGGER.md).', '', `Total: **${operations.length} operasi**. Path sudah menyertakan prefix API.`, ''];
  const groups = new Map<string, typeof operations>();
  for (const entry of operations) {
    const tag = entry.operation.tags?.[0] ?? 'Other';
    groups.set(tag, [...(groups.get(tag) ?? []), entry]);
  }
  for (const [tag, entries] of groups) {
    lines.push(`## ${tag}`, '', '| Method | Endpoint | Akses / permission | Request body |', '|---|---|---|---|');
    for (const { path, method, operation } of entries) {
      const access = operation['x-access'];
      const security = operation.security?.flatMap((item) => Object.keys(item)) ?? [];
      const label = security.includes('bookingKey') ? 'Booking API key' : security.includes('refreshCookie') ? 'Refresh cookie + Origin' : path.startsWith('/api/v1/documents/') ? 'Signed token' : access?.permissions?.join(', ') || access?.kind || 'Lihat Swagger';
      const body = operation.requestBody;
      const content = body && !('$ref' in body) ? body.content : undefined;
      const schema = content?.['application/json']?.schema;
      const bodyName = schema && '$ref' in schema ? schema.$ref.split('/').pop() : content ? Object.keys(content).join(', ') : '—';
      lines.push(`| ${method.toUpperCase()} | \`${path}\` | ${label} | ${bodyName} |`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}
