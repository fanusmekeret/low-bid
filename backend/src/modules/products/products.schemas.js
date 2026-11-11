import { z } from 'zod';
import { NO_PRICE, productAttributesSchema } from './specs.schema.js';

// Titles appear on auction cards, and cards never show prices.
const title = z.string().trim().min(5).max(200).refine((v) => !NO_PRICE.test(v), 'The title must not contain a price');

const fields = {
  categoryId: z.number().int().positive(),
  title,
  description: z.string().trim().min(20, 'Describe the item in at least 20 characters').max(5000),
  condition: z.enum(['NEW', 'LIKE_NEW', 'USED_GOOD', 'USED_FAIR', 'FOR_PARTS']),
  location: z.string().trim().min(2).max(120),
  attributes: productAttributesSchema,
};

export const createProductSchema = z.object(fields);

export const updateProductSchema = z
  .object(fields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const imageOrderSchema = z.object({ imageIds: z.array(z.coerce.bigint().positive()).min(1).max(30) });

const statuses = z.enum(['DRAFT', 'APPROVED', 'ARCHIVED']);

export const adminListQuery = z.object({
  status: statuses.optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  q: z.string().trim().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const reasonSchema = z.object({ reason: z.string().trim().min(3).max(500) });
