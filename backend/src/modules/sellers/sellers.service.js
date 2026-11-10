import { prisma } from '../../config/prisma.js';
import { processDocument } from '../../services/media/images.js';
import { getStorage } from '../../services/storage/index.js';
import { sellerDocumentKey } from '../../services/storage/keys.js';
import { badRequest, conflict, forbidden, notFound } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { recordAudit } from '../audit/audit.service.js';
import { notify } from '../notifications/notifications.service.js';
import { ROLES } from '../rbac/permissions.js';
import { grantRole, revokeRole } from '../rbac/rbac.service.js';
import { IDENTITY_FIELDS, MAX_ACTIVE_DOCUMENTS, applyDecision, maskAccount, verificationGaps } from './sellers.rules.js';

// ───────────────────────────── Presenters ─────────────────────────────

function presentDocument(d, url) {
  return {
    id: d.id.toString(),
    documentType: d.documentType,
    status: d.status,
    rejectionReason: d.rejectionReason,
    reviewedAt: d.reviewedAt,
    createdAt: d.createdAt,
    ...(url !== undefined && { url }),
  };
}

/** @param {{ fullPayout?: boolean }} opts fullPayout for the seller themself and payout admins */
export function presentSeller(p, { fullPayout = false, documents } = {}) {
  return {
    id: p.id.toString(),
    userId: p.userId.toString(),
    status: p.status,
    businessName: p.businessName,
    businessType: p.businessType,
    tinNumber: p.tinNumber,
    city: p.city,
    address: p.address,
    bio: p.bio,
    payout: {
      method: p.payoutMethod,
      bankCode: p.payoutBankCode,
      accountName: p.payoutAccountName,
      accountNo: fullPayout ? p.payoutAccountNo : maskAccount(p.payoutAccountNo),
    },
    rating: { average: p.ratingAvg / 100, count: p.ratingCount },
    approvedAt: p.approvedAt,
    createdAt: p.createdAt,
    ...(documents && { documents }),
    ...(p.user && { owner: { id: p.user.id.toString(), name: `${p.user.firstName} ${p.user.lastName}`, phone: p.user.phone, status: p.user.status } }),
  };
}

// ───────────────────────────── Seller side ─────────────────────────────

/** telebirr payouts go to a phone number, so any old bank code is cleared. */
const normalizePayout = (input) => (input.payoutMethod === 'TELEBIRR' ? { ...input, payoutBankCode: null } : input);

async function profileForUser(userId, db = prisma) {
  return db.sellerProfile.findUnique({ where: { userId: BigInt(userId) }, include: { verifications: { orderBy: { createdAt: 'desc' } } } });
}

/** For listing and auction routes: the caller's seller profile, which must be approved. */
export async function requireApprovedSeller(userId) {
  const profile = await prisma.sellerProfile.findUnique({ where: { userId: BigInt(userId) } });
  if (!profile) throw forbidden('NOT_A_SELLER', 'Apply to become a seller first');
  if (profile.status !== 'APPROVED') throw forbidden('SELLER_NOT_APPROVED', 'Your seller account is not approved');
  return profile;
}

export async function applyAsSeller(userId, input, { req }) {
  const existing = await profileForUser(userId);
  const decision = applyDecision(existing?.status);
  if (typeof decision === 'object') throw conflict(decision.error, decision.message);

  const data = { ...normalizePayout(input), status: 'PENDING', approvedAt: null };
  const profile = await prisma.$transaction(async (tx) => {
    const p = decision === 'create'
      ? await tx.sellerProfile.create({ data: { ...data, userId: BigInt(userId) } })
      : await tx.sellerProfile.update({ where: { id: existing.id }, data });
    await recordAudit({ actorId: userId, action: decision === 'create' ? 'seller.apply' : 'seller.reapply', entity: 'seller', entityId: p.id, after: input, req }, tx);
    return p;
  });
  return getOwnSellerProfile(userId, profile);
}

export async function getOwnSellerProfile(userId, preloaded) {
  const p = preloaded?.verifications ? preloaded : await profileForUser(userId);
  if (!p) throw notFound('NOT_A_SELLER', 'You have not applied to become a seller');
  const documents = p.verifications.map((d) => presentDocument(d));
  return { ...presentSeller(p, { fullPayout: true, documents }), missing: verificationGaps({ ...p, documents: p.verifications }) };
}

export async function updateOwnSellerProfile(userId, input, { req }) {
  const p = await profileForUser(userId);
  if (!p) throw notFound('NOT_A_SELLER', 'You have not applied to become a seller');
  if (p.status === 'SUSPENDED') throw forbidden('SELLER_SUSPENDED', 'Your seller account is suspended. Contact support');
  if (p.status === 'APPROVED') {
    const locked = IDENTITY_FIELDS.filter((f) => input[f] !== undefined && input[f] !== p[f]);
    if (locked.length) throw forbidden('SELLER_IDENTITY_LOCKED', 'Contact support to change your business name, type or TIN', { fields: locked });
  }
  const payoutChanged = input.payoutAccountNo !== undefined && (input.payoutAccountNo !== p.payoutAccountNo || input.payoutMethod !== p.payoutMethod);

  await prisma.$transaction(async (tx) => {
    await tx.sellerProfile.update({ where: { id: p.id }, data: normalizePayout(input) });
    // Payout changes are a common fraud step after account takeover, so they are always logged.
    await recordAudit({
      actorId: userId,
      action: payoutChanged ? 'seller.payout_change' : 'seller.profile_update',
      entity: 'seller',
      entityId: p.id,
      before: payoutChanged ? { method: p.payoutMethod, accountNo: maskAccount(p.payoutAccountNo) } : undefined,
      after: payoutChanged ? { method: input.payoutMethod, accountNo: maskAccount(input.payoutAccountNo) } : Object.keys(input),
      req,
    }, tx);
  });
  return getOwnSellerProfile(userId);
}

export async function addVerificationDocument(userId, { documentType, file }, { req }) {
  if (!file) throw badRequest('FILE_REQUIRED', 'Attach the document in the "file" field');
  const p = await profileForUser(userId);
  if (!p) throw notFound('NOT_A_SELLER', 'Apply to become a seller first');
  if (p.status === 'SUSPENDED') throw forbidden('SELLER_SUSPENDED', 'Your seller account is suspended. Contact support');
  const active = p.verifications.filter((d) => d.status !== 'REJECTED').length;
  if (active >= MAX_ACTIVE_DOCUMENTS) throw conflict('TOO_MANY_DOCUMENTS', `You can keep up to ${MAX_ACTIVE_DOCUMENTS} documents. Remove one first`);

  const doc = await processDocument(file.buffer);
  const key = sellerDocumentKey(p.id, doc.ext);
  const storage = getStorage();
  await storage.putPrivate(key, doc.buffer, doc.contentType);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.sellerVerification.create({ data: { sellerId: p.id, documentType, documentKey: key } });
      await recordAudit({ actorId: userId, action: 'seller.document_upload', entity: 'seller', entityId: p.id, after: { documentType }, req }, tx);
    });
  } catch (err) {
    await storage.deletePrivate(key).catch(() => {});
    throw err;
  }
  return getOwnSellerProfile(userId);
}

export async function removeVerificationDocument(userId, documentId) {
  const p = await profileForUser(userId);
  const doc = p?.verifications.find((d) => d.id === BigInt(documentId));
  if (!doc) throw notFound('DOCUMENT_NOT_FOUND', 'Document not found');
  if (doc.status !== 'PENDING') throw conflict('DOCUMENT_REVIEWED', 'Reviewed documents cannot be removed');
  await prisma.sellerVerification.delete({ where: { id: doc.id } });
  await getStorage().deletePrivate(doc.documentKey).catch((err) => logger.warn({ err }, 'document file delete failed'));
  return getOwnSellerProfile(userId);
}

// ───────────────────────────── Admin side ─────────────────────────────

export async function listSellers({ status, q, page, pageSize }) {
  const where = {
    ...(status && { status }),
    ...(q && {
      OR: [
        { businessName: { contains: q } },
        { tinNumber: { contains: q } },
        { user: { phone: { contains: q.replace(/\s/g, '') } } },
        { user: { firstName: { contains: q } } },
      ],
    }),
  };
  const [total, rows] = await Promise.all([
    prisma.sellerProfile.count({ where }),
    prisma.sellerProfile.findMany({
      where,
      // Oldest pending applications first, so the review queue is first come, first served.
      orderBy: status === 'PENDING' ? { updatedAt: 'asc' } : { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { user: true, verifications: { select: { documentType: true, status: true } }, _count: { select: { products: true } } },
    }),
  ]);
  return {
    data: rows.map((p) => ({
      ...presentSeller(p),
      productCount: p._count.products,
      missing: verificationGaps({ ...p, documents: p.verifications }),
    })),
    meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };
}

export async function getSellerForAdmin(sellerId, { canSeePayout }) {
  const p = await prisma.sellerProfile.findUnique({
    where: { id: BigInt(sellerId) },
    include: { user: true, verifications: { orderBy: { createdAt: 'desc' } }, _count: { select: { products: true } } },
  });
  if (!p) throw notFound('SELLER_NOT_FOUND', 'Seller not found');
  const storage = getStorage();
  const documents = await Promise.all(p.verifications.map(async (d) => {
    const ext = d.documentKey.split('.').pop();
    const url = await storage.privateUrl(d.documentKey, { ttlSeconds: 300, filename: `${d.documentType.toLowerCase()}-${d.id}.${ext}` });
    return presentDocument(d, url);
  }));
  return {
    ...presentSeller(p, { fullPayout: canSeePayout, documents }),
    productCount: p._count.products,
    missing: verificationGaps({ ...p, documents: p.verifications }),
  };
}

async function loadForReview(sellerId, tx) {
  // Lock the row so two admins cannot approve and reject the same application at once.
  const rows = await tx.$queryRaw`SELECT id FROM seller_profiles WHERE id = ${BigInt(sellerId)} FOR UPDATE`;
  if (!rows.length) throw notFound('SELLER_NOT_FOUND', 'Seller not found');
  return tx.sellerProfile.findUnique({ where: { id: BigInt(sellerId) }, include: { verifications: true } });
}

export async function approveSeller(sellerId, { actorId, req }) {
  await prisma.$transaction(async (tx) => {
    const p = await loadForReview(sellerId, tx);
    if (p.status !== 'PENDING') throw conflict('SELLER_NOT_PENDING', `This application is ${p.status.toLowerCase()}, not pending`);
    const gaps = verificationGaps({ ...p, documents: p.verifications });
    if (gaps.length) throw badRequest('VERIFICATION_INCOMPLETE', 'Documents are missing', { missing: gaps });

    const now = new Date();
    await tx.sellerProfile.update({ where: { id: p.id }, data: { status: 'APPROVED', approvedAt: now } });
    await tx.sellerVerification.updateMany({ where: { sellerId: p.id, status: 'PENDING' }, data: { status: 'APPROVED', reviewedById: BigInt(actorId), reviewedAt: now } });
    await grantRole(p.userId, ROLES.SELLER, actorId, tx);
    await notify(p.userId, 'SELLER_APPROVED', {}, { sellerId: p.id }, tx);
    await recordAudit({ actorId, action: 'seller.approve', entity: 'seller', entityId: p.id, before: { status: p.status }, after: { status: 'APPROVED' }, req }, tx);
  });
}

export async function rejectSeller(sellerId, reason, { actorId, req }) {
  await prisma.$transaction(async (tx) => {
    const p = await loadForReview(sellerId, tx);
    if (p.status !== 'PENDING') throw conflict('SELLER_NOT_PENDING', `This application is ${p.status.toLowerCase()}, not pending`);
    const now = new Date();
    await tx.sellerProfile.update({ where: { id: p.id }, data: { status: 'REJECTED' } });
    await tx.sellerVerification.updateMany({
      where: { sellerId: p.id, status: 'PENDING' },
      data: { status: 'REJECTED', rejectionReason: reason, reviewedById: BigInt(actorId), reviewedAt: now },
    });
    await notify(p.userId, 'SELLER_REJECTED', { reason }, { sellerId: p.id }, tx);
    await recordAudit({ actorId, action: 'seller.reject', entity: 'seller', entityId: p.id, after: { reason }, req }, tx);
  });
}

export async function suspendSeller(sellerId, reason, { actorId, req }) {
  await prisma.$transaction(async (tx) => {
    const p = await loadForReview(sellerId, tx);
    if (p.status !== 'APPROVED') throw conflict('SELLER_NOT_APPROVED', 'Only approved sellers can be suspended');
    await tx.sellerProfile.update({ where: { id: p.id }, data: { status: 'SUSPENDED' } });
    await revokeRole(p.userId, ROLES.SELLER, tx);
    await notify(p.userId, 'SELLER_SUSPENDED', { reason }, { sellerId: p.id }, tx);
    await recordAudit({ actorId, action: 'seller.suspend', entity: 'seller', entityId: p.id, after: { reason }, req }, tx);
  });
}

export async function reinstateSeller(sellerId, { actorId, req }) {
  await prisma.$transaction(async (tx) => {
    const p = await loadForReview(sellerId, tx);
    if (p.status !== 'SUSPENDED') throw conflict('SELLER_NOT_SUSPENDED', 'This seller is not suspended');
    await tx.sellerProfile.update({ where: { id: p.id }, data: { status: 'APPROVED' } });
    await grantRole(p.userId, ROLES.SELLER, actorId, tx);
    await notify(p.userId, 'SELLER_APPROVED', {}, { sellerId: p.id }, tx);
    await recordAudit({ actorId, action: 'seller.reinstate', entity: 'seller', entityId: p.id, req }, tx);
  });
}
