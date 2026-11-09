import { HttpError } from '../middleware/errors';

interface StringOptions {
  min?: number;
  max: number;
  field: string;
}

export function requireString(value: unknown, options: StringOptions): string {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'VALIDATION_ERROR', `${options.field} must be a string.`);
  }

  const trimmed = value.trim();
  const min = options.min ?? 1;

  if (trimmed.length < min) {
    throw new HttpError(400, 'VALIDATION_ERROR', `${options.field} cannot be empty.`);
  }

  if (trimmed.length > options.max) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      `${options.field} must be ${options.max} characters or fewer.`,
    );
  }

  return trimmed;
}

export function optionalString(value: unknown, options: StringOptions): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return requireString(value, options);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
