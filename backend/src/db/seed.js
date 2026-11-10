// Seeds roles, permissions, categories, platform settings and the first super admin.
// Idempotent: safe to run on every deploy. Run with `bun run db:seed`.
import { pathToFileURL } from 'node:url';
import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { hashPassword } from '../modules/auth/password.js';
import { PERMISSION_DESCRIPTIONS, ROLE_DEFINITIONS, ROLES } from '../modules/rbac/permissions.js';
import { SETTING_DEFINITIONS } from '../modules/settings/settings.definitions.js';
import { etbToMinor } from '../utils/money.js';
import { normalizeEthiopianPhone } from '../utils/phone.js';

// Amharic names: have a native speaker review before launch.
const log = (...args) => { if (process.env.NODE_ENV !== 'test') console.log(...args); };

const CATEGORIES = [
  { slug: 'electronics', nameEn: 'Electronics', nameAm: 'ኤሌክትሮኒክስ', iconKey: 'devices', bidFeeEtb: '0' },
  { slug: 'mobile-phones-tablets', nameEn: 'Mobile phones and tablets', nameAm: 'ሞባይል ስልኮች እና ታብሌቶች', iconKey: 'smartphone', bidFeeEtb: '0' },
  { slug: 'vehicles', nameEn: 'Vehicles', nameAm: 'ተሽከርካሪዎች', iconKey: 'car', bidFeeEtb: '50' },
  { slug: 'furniture', nameEn: 'Furniture', nameAm: 'የቤት ዕቃዎች', iconKey: 'sofa', bidFeeEtb: '0' },
  { slug: 'real-estate', nameEn: 'Real estate', nameAm: 'ሪል እስቴት', iconKey: 'home', bidFeeEtb: '50' },
  { slug: 'home-appliances', nameEn: 'Home appliances', nameAm: 'የቤት መገልገያዎች', iconKey: 'kitchen', bidFeeEtb: '0' },
  { slug: 'fashion', nameEn: 'Fashion', nameAm: 'ፋሽን', iconKey: 'checkroom', bidFeeEtb: '0' },
  { slug: 'industrial-equipment', nameEn: 'Industrial equipment', nameAm: 'የኢንዱስትሪ መሣሪያዎች', iconKey: 'factory', bidFeeEtb: '0' },
  { slug: 'agricultural-products', nameEn: 'Agricultural products', nameAm: 'የግብርና ምርቶች', iconKey: 'agriculture', bidFeeEtb: '0' },
  { slug: 'other', nameEn: 'Other', nameAm: 'ሌሎች', iconKey: 'category', bidFeeEtb: '0' },
];

export async function seedRbac() {
  for (const [code, description] of Object.entries(PERMISSION_DESCRIPTIONS)) {
    await prisma.permission.upsert({ where: { code }, update: { description }, create: { code, description } });
  }
  const permissions = await prisma.permission.findMany();
  const permId = new Map(permissions.map((p) => [p.code, p.id]));

  for (const def of ROLE_DEFINITIONS) {
    const role = await prisma.role.upsert({
      where: { code: def.code },
      update: { name: def.name, description: def.description },
      create: { code: def.code, name: def.name, description: def.description },
    });
    // Make the role's permissions match the definition exactly.
    const wanted = def.permissions.map((code) => {
      const id = permId.get(code);
      if (!id) throw new Error(`Permission ${code} missing from PERMISSION_DESCRIPTIONS`);
      return id;
    });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id, permissionId: { notIn: wanted.length ? wanted : [-1] } } });
    await prisma.rolePermission.createMany({ data: wanted.map((permissionId) => ({ roleId: role.id, permissionId })), skipDuplicates: true });
  }
  log(`✓ ${ROLE_DEFINITIONS.length} roles, ${permissions.length} permissions`);
}

export async function seedCategories() {
  for (const [i, c] of CATEGORIES.entries()) {
    const data = { nameEn: c.nameEn, nameAm: c.nameAm, iconKey: c.iconKey, sortOrder: i * 10, defaultBidFee: etbToMinor(c.bidFeeEtb) };
    // Existing categories keep admin edits to names/order; only missing ones are created.
    await prisma.category.upsert({ where: { slug: c.slug }, update: {}, create: { slug: c.slug, ...data } });
  }
  log(`✓ ${CATEGORIES.length} categories`);
}

export async function seedSettings() {
  for (const [key, def] of Object.entries(SETTING_DEFINITIONS)) {
    // Never overwrite a value an admin has changed.
    await prisma.systemSetting.upsert({
      where: { key },
      update: { description: def.description },
      create: { key, value: def.default, description: def.description },
    });
  }
  log(`✓ ${Object.keys(SETTING_DEFINITIONS).length} settings`);
}

export async function seedSuperAdmin() {
  if (!env.SUPER_ADMIN_PHONE || !env.SUPER_ADMIN_PASSWORD) {
    log('• SUPER_ADMIN_PHONE / SUPER_ADMIN_PASSWORD not set — skipping super admin');
    return;
  }
  const phone = normalizeEthiopianPhone(env.SUPER_ADMIN_PHONE);
  if (!phone) throw new Error('SUPER_ADMIN_PHONE is not a valid Ethiopian mobile number');
  if (env.SUPER_ADMIN_PASSWORD.length < 12) throw new Error('SUPER_ADMIN_PASSWORD must be at least 12 characters');

  const existing = await prisma.user.findUnique({ where: { phone } });
  const user = existing ?? await prisma.user.create({
    data: {
      phone,
      passwordHash: await hashPassword(env.SUPER_ADMIN_PASSWORD),
      firstName: env.SUPER_ADMIN_FIRST_NAME,
      lastName: env.SUPER_ADMIN_LAST_NAME,
      phoneVerifiedAt: new Date(),
    },
  });
  const roles = await prisma.role.findMany({ where: { code: { in: [ROLES.BUYER, ROLES.BIDDER, ROLES.SUPER_ADMIN] } } });
  await prisma.userRole.createMany({ data: roles.map((r) => ({ userId: user.id, roleId: r.id })), skipDuplicates: true });
  log(`✓ super admin ${phone}${existing ? ' (already existed)' : ' created'}`);
}

async function main() {
  await seedRbac();
  await seedCategories();
  await seedSettings();
  await seedSuperAdmin();
}

// Run only when executed directly (`bun src/db/seed.js`), not when imported by tests.
if (import.meta.main ?? (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)) {
  main()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
