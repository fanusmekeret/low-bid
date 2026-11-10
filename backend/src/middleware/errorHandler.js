import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'ROUTE_NOT_FOUND', message: `No route for ${req.method} ${req.path}` } });
}

// Express recognizes error handlers by their 4-argument signature.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Some fields are invalid',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
  }

  if (err instanceof AppError) {
    if (err.status >= 500) logger.error({ err, reqId: req.id }, err.message);
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: { code: 'ALREADY_EXISTS', message: 'A record with these details already exists', details: { fields: err.meta?.target } } });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    }
  }

  // Upload limits from multer
  if (err?.name === 'MulterError') {
    const map = {
      LIMIT_FILE_SIZE: [413, 'FILE_TOO_LARGE', 'A file is too large'],
      LIMIT_FILE_COUNT: [400, 'TOO_MANY_FILES', 'Too many files in one upload'],
      LIMIT_UNEXPECTED_FILE: [400, 'UNEXPECTED_FILE_FIELD', `Unexpected file field "${err.field}"`],
    };
    const [status, code, message] = map[err.code] ?? [400, 'UPLOAD_INVALID', 'The upload could not be processed'];
    return res.status(status).json({ error: { code, message } });
  }

  // Malformed JSON body from express.json()
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' } });
  }

  // Client errors raised by Express itself or express.static (e.g. a missing photo).
  const status = err?.status ?? err?.statusCode;
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    return res.status(status).json({ error: { code: status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST', message: status === 404 ? 'Not found' : 'Bad request' } });
  }

  logger.error({ err, reqId: req.id }, 'unhandled error');
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong', details: { requestId: req.id } } });
}
