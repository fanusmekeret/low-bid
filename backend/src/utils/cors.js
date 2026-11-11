import { env } from '../config/env.js';

// `flutter run -d chrome` serves the app from a new random localhost port each time, so in
// development any localhost / 127.0.0.1 origin is allowed. In production only CORS_ORIGINS.
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/** True when a browser on `origin` may call the API. Requests with no Origin (mobile apps) are allowed. */
export function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (env.corsOrigins.includes(origin)) return true;
  return !env.isProduction && LOCAL_ORIGIN.test(origin);
}

/** For the `cors` package and Socket.IO: (origin, callback) => callback(null, allowed). */
export const corsOrigin = (origin, cb) => cb(null, isAllowedOrigin(origin));
