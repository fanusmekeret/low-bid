import { AppError } from '../../../utils/errors.js';

/**
 * Ethio Telecom bulk SMS over HTTP.
 *
 * IMPORTANT: Ethio Telecom gives each enterprise account its own interface document
 * (HTTP API or SMPP). The request below follows the common HTTP pattern
 * (authenticated POST with sender, recipient and message). Before going live, match
 * `buildRequest` and `parseResponse` to the field names in the document Ethio Telecom
 * issued with your account. Everything else (OTP flow, retries, logging) stays the same.
 * If your account is SMPP-only, replace this file with an SMPP client provider that
 * exposes the same { name, send } interface.
 */
export function ethioTelecomProvider({ url, username, password, senderId, timeoutMs = 10_000 }) {
  function toLocalFormat(e164) {
    // Many local gateways expect 2519XXXXXXXX without "+".
    return e164.replace(/^\+/, '');
  }

  function buildRequest(to, text) {
    return {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
      },
      body: JSON.stringify({
        from: senderId,
        to: toLocalFormat(to),
        text,
        // Unicode so Amharic (Ge'ez script) arrives intact
        encoding: 'UCS2',
      }),
      signal: AbortSignal.timeout(timeoutMs),
    };
  }

  async function parseResponse(res) {
    const raw = await res.text();
    let body;
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = { raw }; }
    if (!res.ok) {
      throw new AppError(502, 'SMS_PROVIDER_ERROR', `Ethio Telecom SMS failed with HTTP ${res.status}`, { body });
    }
    return { providerMessageId: body.messageId ?? body.message_id ?? body.id ?? undefined };
  }

  return {
    name: 'ethiotelecom',
    async send(to, text) {
      const res = await fetch(url, buildRequest(to, text));
      return parseResponse(res);
    },
  };
}
