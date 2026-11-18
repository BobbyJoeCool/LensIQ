/** An error with an HTTP status and a message that is safe to show the user. */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    /** Extra fields merged into the JSON error body (e.g. a conflict's current value). */
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
