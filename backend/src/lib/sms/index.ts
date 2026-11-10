import { logger } from "../logger.js";

/** Swappable SMS adapter. Production uses Ethio Telecom; swap the provider here without touching callers. */
export interface SmsProvider {
  send(to: string, text: string): Promise<void>;
}

class ConsoleSms implements SmsProvider {
  async send(to: string, text: string) {
    logger.info({ to, text }, "[sms:dev] message");
  }
}

// TODO(phase 8): EthioTelecomSms implementing SmsProvider once the bulk-SMS API credentials are issued.
let provider: SmsProvider = new ConsoleSms();

export function setSmsProvider(p: SmsProvider) {
  provider = p;
}

export const sms = {
  send: (to: string, text: string) => provider.send(to, text),
};
