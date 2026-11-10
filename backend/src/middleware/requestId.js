import { ulid } from 'ulid';

const SAFE_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** Accepts an upstream X-Request-Id if well-formed, otherwise mints one. */
export function requestId(req, res, next) {
  const incoming = req.get('x-request-id');
  req.id = incoming && SAFE_ID.test(incoming) ? incoming : ulid();
  res.set('X-Request-Id', req.id);
  next();
}
