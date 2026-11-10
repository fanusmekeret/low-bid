import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { consoleProvider } from './providers/console.js';
import { ethioTelecomProvider } from './providers/ethiotelecom.js';

/**
 * @typedef {{ name: string, send(to: string, text: string): Promise<{ providerMessageId?: string }> }} SmsProvider
 */

/** @type {SmsProvider} */
let provider;

function getProvider() {
  if (!provider) {
    provider = env.SMS_PROVIDER === 'ethiotelecom'
      ? ethioTelecomProvider({
          url: env.ETHIOTELECOM_SMS_URL,
          username: env.ETHIOTELECOM_SMS_USERNAME,
          password: env.ETHIOTELECOM_SMS_PASSWORD,
          senderId: env.ETHIOTELECOM_SMS_SENDER_ID,
        })
      : consoleProvider();
  }
  return provider;
}

/** Swap the provider (tests). */
export function setSmsProvider(p) {
  provider = p;
}

/**
 * Send one SMS. Throws on provider failure so callers can decide whether to retry.
 * @param {string} to E.164 number
 * @param {string} text message (Amharic is fine; providers send it as Unicode)
 */
export async function sendSms(to, text) {
  const p = getProvider();
  const started = Date.now();
  try {
    const result = await p.send(to, text);
    logger.info({ provider: p.name, to: `${to.slice(0, 6)}***`, ms: Date.now() - started }, 'sms sent');
    return result;
  } catch (err) {
    logger.error({ err, provider: p.name }, 'sms failed');
    throw err;
  }
}
