// Pure seller rules (no database), shared by the service and the tests.

export const DOCUMENT_TYPES = Object.freeze(['FAYDA_ID', 'KEBELE_ID', 'PASSPORT', 'DRIVING_LICENSE', 'TRADE_LICENSE', 'TIN_CERTIFICATE']);
export const IDENTITY_DOCUMENTS = Object.freeze(['FAYDA_ID', 'KEBELE_ID', 'PASSPORT', 'DRIVING_LICENSE']);
export const MAX_ACTIVE_DOCUMENTS = 10;

/**
 * What is still missing before an admin may approve.
 * Counts documents that are pending or approved (rejected ones do not count).
 * @param {{ businessType: string, tinNumber?: string|null, documents: { documentType: string, status: string }[] }} seller
 * @returns {string[]} empty when complete
 */
export function verificationGaps({ businessType, tinNumber, documents }) {
  const usable = new Set(documents.filter((d) => d.status !== 'REJECTED').map((d) => d.documentType));
  const gaps = [];
  if (!IDENTITY_DOCUMENTS.some((t) => usable.has(t))) gaps.push('IDENTITY_DOCUMENT');
  if (businessType === 'COMPANY') {
    if (!usable.has('TRADE_LICENSE')) gaps.push('TRADE_LICENSE');
    if (!tinNumber) gaps.push('TIN_NUMBER');
  }
  return gaps;
}

/**
 * Whether an account may (re)apply, given its current seller status.
 * @returns {'create'|'reapply'|{ error: string, message: string }}
 */
export function applyDecision(currentStatus) {
  switch (currentStatus) {
    case undefined:
    case null:
      return 'create';
    case 'REJECTED':
      return 'reapply';
    case 'PENDING':
      return { error: 'SELLER_APPLICATION_PENDING', message: 'Your seller application is already under review' };
    case 'APPROVED':
      return { error: 'ALREADY_SELLER', message: 'You are already a seller' };
    case 'SUSPENDED':
      return { error: 'SELLER_SUSPENDED', message: 'Your seller account is suspended. Contact support' };
    default:
      return { error: 'SELLER_STATUS_UNKNOWN', message: 'Seller status unknown' };
  }
}

/** Approved sellers cannot change identity fields themselves; support does it after re-checking documents. */
export const IDENTITY_FIELDS = Object.freeze(['businessName', 'businessType', 'tinNumber']);

/** "1000123456789" → "•••• 6789" */
export const maskAccount = (no) => (no ? `•••• ${String(no).slice(-4)}` : null);
