import pino from 'pino';

const level = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info');

export const logger = pino({
  level,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.newPassword',
      '*.currentPassword',
      '*.refreshToken',
      '*.code',
    ],
    censor: '[redacted]',
  },
  transport:
    process.env.NODE_ENV === 'development' ? { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss' } } : undefined,
});
