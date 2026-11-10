/** An error that is safe to show to the client. */
export class AppError extends Error {
  /**
   * @param {number} status HTTP status
   * @param {string} code stable machine-readable code, e.g. AUTH_INVALID_CREDENTIALS
   * @param {string} message human-readable message (English; the app localizes by code)
   * @param {unknown} [details]
   */
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code, message, details) => new AppError(400, code, message, details);
export const unauthorized = (code = 'AUTH_REQUIRED', message = 'Authentication required') => new AppError(401, code, message);
export const forbidden = (code = 'FORBIDDEN', message = 'You do not have permission to do this') => new AppError(403, code, message);
export const notFound = (code = 'NOT_FOUND', message = 'Not found') => new AppError(404, code, message);
export const conflict = (code, message, details) => new AppError(409, code, message, details);
export const tooMany = (code = 'RATE_LIMITED', message = 'Too many requests, please try again later', details) =>
  new AppError(429, code, message, details);
