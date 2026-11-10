import { verifyAccessToken } from '../modules/auth/tokens.js';
import { permissionsForRoles } from '../modules/rbac/rbac.service.js';
import { forbidden, unauthorized } from '../utils/errors.js';

function bearer(req) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

async function attach(req, token) {
  const claims = verifyAccessToken(token); // throws AppError 401 on bad/expired token
  const roles = Array.isArray(claims.roles) ? claims.roles : [];
  req.auth = {
    userId: BigInt(claims.sub),
    roles,
    phoneVerified: claims.pv === true,
    permissions: await permissionsForRoles(roles),
  };
}

/** Requires a valid access token. Sets req.auth. */
export async function authenticate(req, _res, next) {
  const token = bearer(req);
  if (!token) throw unauthorized();
  await attach(req, token);
  next();
}

/** Attaches req.auth when a valid token is present; guests pass through. */
export async function optionalAuth(req, _res, next) {
  const token = bearer(req);
  if (token) {
    try { await attach(req, token); } catch { req.auth = undefined; }
  }
  next();
}

/** Requires every listed permission. Use after authenticate. */
export function requirePermission(...codes) {
  return (req, _res, next) => {
    if (!req.auth) throw unauthorized();
    const missing = codes.filter((c) => !req.auth.permissions.has(c));
    if (missing.length) throw forbidden('PERMISSION_DENIED', `Missing permission: ${missing.join(', ')}`);
    next();
  };
}

/** Requires a verified phone (bidding, paying). */
export function requireVerifiedPhone(req, _res, next) {
  if (!req.auth) throw unauthorized();
  if (!req.auth.phoneVerified) throw forbidden('PHONE_NOT_VERIFIED', 'Verify your phone number first');
  next();
}
