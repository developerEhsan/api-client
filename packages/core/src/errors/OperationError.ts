import { ApiError } from './ApiError';

/**
 * Error raised by / surfaced through the generic operation runner (`ctx.run`)
 * for non-HTTP module work. Extends {@link ApiError} so a single `catch (e) { if
 * (e instanceof ApiError) }` covers both transport and custom-operation
 * failures. `ctx.run` only wraps a thrown *non-Error* value in this type;
 * genuine `Error`/`ApiError` throws propagate unchanged so callers keep their
 * own domain errors.
 */
export class OperationError extends ApiError {
  override readonly name = 'OperationError';
}
