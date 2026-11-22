/** Keys never written to audit logs or notification payloads (spec §7, §10). */
const SENSITIVE = /pass(word)?|secret|token|hash|otp|numberEncrypted|signature|authorization|cookie|clinical|diagnos|medical/i;

/** Deep copy with sensitive values replaced; safe for audit before/after payloads. */
export function redact(value: unknown, depth = 0): unknown {
  if (value == null || typeof value !== 'object') return value;
  if (depth > 6) return '[truncated]';
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (typeof (value as { toJSON?: unknown }).toJSON === 'function') return (value as { toJSON: () => unknown }).toJSON();
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, SENSITIVE.test(key) ? '[redacted]' : redact(item, depth + 1)]),
  );
}
