import { z } from 'zod';

// Shape of products.attributes. Sellers fill this in when listing (Phase 3); demo data uses it too.
//   highlights → up to 3 short specs shown on auction cards
//   specs      → grouped spec sheet shown on the auction detail page

// Prices belong in the auction, never in the spec sheet: cards must not leak a price.
const NO_PRICE = /\b(etb|birr|br\.?)\b|ብር/i;
const noPrice = (field) => (v) => !NO_PRICE.test(v) || `${field} must not contain a price`;

const shortText = (max, field) =>
  z.string().trim().min(1).max(max).refine((v) => noPrice(field)(v) === true, { message: `${field} must not contain a price` });

export const specRowSchema = z.object({
  label: shortText(40, 'Spec label'),
  value: shortText(120, 'Spec value'),
});

export const specGroupSchema = z.object({
  group: shortText(40, 'Spec group'),
  rows: z.array(specRowSchema).min(1).max(20),
});

export const productAttributesSchema = z.object({
  highlights: z.array(shortText(28, 'Highlight')).min(1).max(3),
  specs: z.array(specGroupSchema).min(1).max(12),
});

export { NO_PRICE };
