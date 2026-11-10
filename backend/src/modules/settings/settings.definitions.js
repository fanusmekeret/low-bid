import { z } from 'zod';

// Every platform setting: its default, what it means, and how an admin edit is validated.
// Money is santim (minor units) as a digit string so it survives JSON exactly.

const bp = z.number().int().min(0).max(10_000); // basis points: 1000 = 10%
const minorString = z.string().regex(/^\d{1,15}$/, 'Amount in santim, digits only');

export const SETTING_DEFINITIONS = {
  'fees.commission': {
    description: 'Platform fees in basis points (1000 = 10%). Decided 2026-11-07: 10% seller commission (on the seller\'s agreed price), no buyer premium. Bid fees are set under auction.lowestUniqueBid.',
    schema: z.object({ sellerCommissionBp: bp, buyerPremiumBp: bp, sellerListingFeeMinor: minorString, featuredListingFeeMinor: minorString }).strict(),
    default: { sellerCommissionBp: 1000, buyerPremiumBp: 0, sellerListingFeeMinor: '0', featuredListingFeeMinor: '0' },
  },
  'auction.lowestUniqueBid': {
    description: 'Lowest unique bid auctions: default bid fee (categories can set their own), allowed bid amounts, per-person bid limit, and how long after the end the close waits for bid-fee payments still being confirmed.',
    schema: z.object({
      defaultBidFeeMinor: minorString,
      minBidMinor: minorString,
      bidStepMinor: minorString,
      maxBidsPerUser: z.number().int().min(1).max(1000),
      settleWindowMinutes: z.number().int().min(0).max(60),
      refundFeesOnCancel: z.boolean(),
    }).strict(),
    default: { defaultBidFeeMinor: '1000', minBidMinor: '1', bidStepMinor: '1', maxBidsPerUser: 50, settleWindowMinutes: 5, refundFeesOnCancel: true },
  },
  'auction.rules': {
    description: 'Auction timing and non-payment handling.',
    schema: z.object({
      minDurationHours: z.number().int().min(1).max(168),
      maxDurationDays: z.number().int().min(1).max(90),
      paymentDeadlineHours: z.number().int().min(1).max(336),
      secondChanceOffer: z.boolean(),
      maxPaymentStrikes: z.number().int().min(1).max(10),
    }).strict(),
    default: { minDurationHours: 1, maxDurationDays: 30, paymentDeadlineHours: 48, secondChanceOffer: true, maxPaymentStrikes: 3 },
  },
  'listing.rules': {
    description: 'Product listing limits.',
    schema: z.object({
      maxImagesPerProduct: z.number().int().min(1).max(30),
      minImagesToSubmit: z.number().int().min(1).max(10),
    }).strict(),
    default: { maxImagesPerProduct: 12, minImagesToSubmit: 1 },
  },
  'payment.chapa': {
    description: 'Chapa checkout expiry, reconciliation cadence, and whether refunds go through the Chapa refund API or are paid manually.',
    schema: z.object({
      checkoutTimeoutMinutes: z.number().int().min(5).max(1440),
      reconcileEveryMinutes: z.number().int().min(1).max(120),
      reconcileAfterMinutes: z.number().int().min(1).max(120),
      refundMode: z.enum(['CHAPA_API', 'MANUAL']),
      reminderHoursBeforeDeadline: z.number().int().min(0).max(72),
    }).strict(),
    default: { checkoutTimeoutMinutes: 30, reconcileEveryMinutes: 10, reconcileAfterMinutes: 5, refundMode: 'CHAPA_API', reminderHoursBeforeDeadline: 12 },
  },
  'payout.policy': {
    description: 'Seller payouts are released after the dispute window.',
    schema: z.object({ disputeWindowDays: z.number().int().min(0).max(30), method: z.enum(['MANUAL_BANK_TRANSFER', 'CHAPA_TRANSFER']) }).strict(),
    default: { disputeWindowDays: 3, method: 'MANUAL_BANK_TRANSFER' },
  },
};

export const SETTING_KEYS = Object.keys(SETTING_DEFINITIONS);
