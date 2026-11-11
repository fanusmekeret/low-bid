import { env } from '../../config/env.js';
import { prisma } from '../../config/prisma.js';
import { newObjectId } from '../../services/storage/keys.js';
import { logger } from '../../utils/logger.js';
import { verifyWebhookSignature } from './payment.rules.js';
import { verifyAndSettle } from './payments.service.js';
import { checkRefund } from './refunds.service.js';

const KEEP_HEADERS = ['x-chapa-signature', 'chapa-signature', 'user-agent', 'content-type', 'x-forwarded-for'];

/**
 * Stores every webhook (deduplicated), then acts on it. A webhook never marks anything paid by
 * itself: it only prompts a server-side check with Chapa's verify API.
 * @returns {Promise<{ httpStatus: number, body: object }>}
 */
export async function handleChapaWebhook({ headers, rawBody, body }) {
  const signature = verifyWebhookSignature({ headers, rawBody, parsedBody: body, secret: env.CHAPA_WEBHOOK_SECRET });
  const event = String(body?.event ?? body?.type ?? 'unknown').slice(0, 50);
  const txRef = body?.tx_ref ?? body?.trx_ref ?? null;
  const reference = body?.reference ?? body?.ref_id ?? null;
  // Only signed events are deduplicated, so a forged or broken event can never block the real one.
  const baseKey = `${event}:${txRef ?? reference ?? 'none'}:${body?.status ?? ''}`.slice(0, 120);
  const eventKey = signature ? baseKey : `unsigned:${baseKey}:${newObjectId()}`.slice(0, 150);
  const payment = txRef ? await prisma.payment.findUnique({ where: { txRef: String(txRef) }, select: { id: true } }) : null;

  let row;
  try {
    row = await prisma.paymentWebhook.create({
      data: {
        provider: 'CHAPA',
        eventKey,
        txRef: txRef ? String(txRef).slice(0, 64) : null,
        paymentId: payment?.id ?? null,
        signatureValid: Boolean(signature),
        payload: body ?? {},
        headers: Object.fromEntries(KEEP_HEADERS.filter((h) => headers[h]).map((h) => [h, String(headers[h]).slice(0, 200)])),
      },
    });
  } catch (err) {
    if (err?.code !== 'P2002') throw err;
    // Chapa retries until it gets a 200. If we already finished this event, stop here;
    // if the earlier attempt failed part-way, process it again.
    row = await prisma.paymentWebhook.findUnique({ where: { provider_eventKey: { provider: 'CHAPA', eventKey } } });
    if (row?.processedAt) return { httpStatus: 200, body: { received: true, duplicate: true } };
  }

  if (!signature) {
    logger.warn({ eventKey }, 'chapa webhook with invalid signature');
    return { httpStatus: 401, body: { error: 'invalid signature' } };
  }

  try {
    if (event.startsWith('refund')) {
      const refund = await prisma.refund.findFirst({ where: { OR: [{ providerRef: String(reference ?? '') }, { reference: String(body?.merchant_reference ?? reference ?? '') }] }, select: { id: true } });
      if (refund) await checkRefund(refund.id);
    } else if (txRef) {
      await verifyAndSettle(String(txRef), { source: 'webhook' });
    }
    await prisma.paymentWebhook.update({ where: { id: row.id }, data: { processedAt: new Date() } });
  } catch (err) {
    // Still 200: the event is stored and the reconcile job will finish the work.
    logger.error({ err, eventKey }, 'chapa webhook processing failed');
    await prisma.paymentWebhook.update({ where: { id: row.id }, data: { processError: String(err.message ?? err).slice(0, 1000) } });
  }
  return { httpStatus: 200, body: { received: true } };
}
