import { z } from 'zod';
import { normalizeEthiopianPhone } from '../../utils/phone.js';
import { DOCUMENT_TYPES } from './sellers.rules.js';

const text = (min, max) => z.string().trim().min(min).max(max);

const payoutFields = {
  payoutMethod: z.enum(['BANK_TRANSFER', 'TELEBIRR']),
  payoutBankCode: text(1, 20).optional(), // bank code from Chapa's bank list (Phase 5)
  payoutAccountName: text(2, 150),
  payoutAccountNo: text(6, 40),
};

/** Bank accounts are 8–20 digits; telebirr payouts go to an Ethiopian mobile number. */
function checkPayout(v, ctx) {
  if (v.payoutMethod === undefined) return;
  if (v.payoutMethod === 'BANK_TRANSFER') {
    if (!v.payoutBankCode) ctx.addIssue({ code: 'custom', path: ['payoutBankCode'], message: 'Choose your bank' });
    if (v.payoutAccountNo && !/^\d{8,20}$/.test(v.payoutAccountNo)) {
      ctx.addIssue({ code: 'custom', path: ['payoutAccountNo'], message: 'Bank account numbers are 8–20 digits' });
    }
  }
  if (v.payoutMethod === 'TELEBIRR' && v.payoutAccountNo) {
    const phone = normalizeEthiopianPhone(v.payoutAccountNo);
    if (!phone) ctx.addIssue({ code: 'custom', path: ['payoutAccountNo'], message: 'Enter the telebirr phone number' });
    else v.payoutAccountNo = phone;
  }
}

const tin = z.string().trim().regex(/^\d{10}$/, 'TIN is 10 digits');

export const applySchema = z
  .object({
    businessName: text(2, 150),
    businessType: z.enum(['INDIVIDUAL', 'COMPANY']),
    tinNumber: tin.optional(),
    city: text(2, 80),
    address: text(2, 255).optional(),
    bio: text(0, 1000).optional(),
    ...payoutFields,
  })
  .superRefine((v, ctx) => {
    if (v.businessType === 'COMPANY' && !v.tinNumber) ctx.addIssue({ code: 'custom', path: ['tinNumber'], message: 'Companies must give their TIN' });
    checkPayout(v, ctx);
  });

export const updateProfileSchema = z
  .object({
    businessName: text(2, 150),
    businessType: z.enum(['INDIVIDUAL', 'COMPANY']),
    tinNumber: tin.nullable(),
    city: text(2, 80),
    address: text(2, 255).nullable(),
    bio: text(0, 1000).nullable(),
    ...payoutFields,
  })
  .partial()
  .superRefine((v, ctx) => {
    const payoutKeys = ['payoutMethod', 'payoutBankCode', 'payoutAccountName', 'payoutAccountNo'];
    const touched = payoutKeys.filter((k) => v[k] !== undefined);
    if (touched.length && !(v.payoutMethod && v.payoutAccountName && v.payoutAccountNo)) {
      ctx.addIssue({ code: 'custom', path: ['payoutMethod'], message: 'Send the method, account name and account number together' });
    }
    checkPayout(v, ctx);
    if (Object.keys(v).length === 0) ctx.addIssue({ code: 'custom', path: [], message: 'Nothing to update' });
  });

export const documentTypeSchema = z.object({ documentType: z.enum(DOCUMENT_TYPES) });

export const reasonSchema = z.object({ reason: text(3, 500) });

export const adminListQuery = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED']).optional(),
  q: text(1, 100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
