import { logger } from '../../../utils/logger.js';

/** Development/test provider: never sends; keeps the last messages in memory and logs them. */
export function consoleProvider() {
  const outbox = [];
  return {
    name: 'console',
    outbox,
    async send(to, text) {
      outbox.push({ to, text, at: new Date() });
      if (outbox.length > 100) outbox.shift();
      // eslint-disable-next-line no-console
      if (process.env.NODE_ENV === 'development') console.log(`\n📱 SMS to ${to}: ${text}\n`);
      else logger.debug({ to }, 'console sms captured');
      return { providerMessageId: `console-${outbox.length}` };
    },
  };
}
