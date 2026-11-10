import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";

const prisma = new PrismaClient();

// Roles stack up: each includes the permissions of the ones listed before it (except the admin pair).
const PERMS: Record<string, string[]> = {
  guest: [],
  buyer: ["watchlist:manage", "profile:manage"],
  verified_bidder: ["bid:place", "payment:make"],
  seller: ["product:create", "auction:create", "payout:view"],
  auction_admin: ["seller:review", "auction:review", "auction:cancel", "category:manage", "refund:manage", "report:view", "bid:monitor"],
  super_admin: ["user:manage", "role:manage", "settings:manage", "audit:view", "payout:manage"],
};
const ROLE_NAMES: Record<string, string> = {
  guest: "Guest",
  buyer: "Registered buyer",
  verified_bidder: "Verified bidder",
  seller: "Seller",
  auction_admin: "Auction admin",
  super_admin: "Super admin",
};
const INHERITS: Record<string, string[]> = {
  buyer: ["buyer"],
  verified_bidder: ["buyer", "verified_bidder"],
  seller: ["buyer", "verified_bidder", "seller"],
  auction_admin: ["auction_admin"],
  super_admin: ["auction_admin", "super_admin"],
};

const CATEGORIES = [
  { slug: "electronics", en: "Electronics", am: "ኤሌክትሮኒክስ", children: [
    { slug: "phones", en: "Phones", am: "ስልኮች" },
    { slug: "laptops", en: "Laptops", am: "ላፕቶፖች" },
  ] },
  { slug: "vehicles", en: "Vehicles", am: "ተሽከርካሪዎች", deposit: 5000n, children: [] },
  { slug: "real-estate", en: "Real estate", am: "ሪል እስቴት", deposit: 5000n, children: [] },
  { slug: "home", en: "Home & furniture", am: "ቤት እና የቤት እቃዎች", children: [] },
  { slug: "fashion", en: "Fashion", am: "ፋሽን", children: [] },
];

async function main() {
  const allPerms = [...new Set(Object.values(PERMS).flat())];
  for (const code of allPerms) await prisma.permission.upsert({ where: { code }, create: { code }, update: {} });

  for (const [code, name] of Object.entries(ROLE_NAMES)) {
    const role = await prisma.role.upsert({ where: { code }, create: { code, name }, update: { name } });
    const codes = (INHERITS[code] ?? []).flatMap((r) => PERMS[r]);
    for (const pc of codes) {
      const p = await prisma.permission.findUniqueOrThrow({ where: { code: pc } });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: p.id } },
        create: { roleId: role.id, permissionId: p.id },
        update: {},
      });
    }
  }

  let order = 0;
  for (const c of CATEGORIES) {
    // Minimum bid deposit 50 ETB for Vehicles and Real estate (decision 7 Nov 2026).
    const parent = await prisma.category.upsert({
      where: { slug: c.slug },
      create: { slug: c.slug, nameEn: c.en, nameAm: c.am, sortOrder: order++, requiresDeposit: !!c.deposit, defaultDepositMinor: c.deposit ?? 0n },
      update: { nameEn: c.en, nameAm: c.am },
    });
    for (const ch of c.children) {
      await prisma.category.upsert({
        where: { slug: ch.slug },
        create: { slug: ch.slug, nameEn: ch.en, nameAm: ch.am, parentId: parent.id, sortOrder: order++ },
        update: { nameEn: ch.en, nameAm: ch.am, parentId: parent.id },
      });
    }
  }

  const phone = process.env.SEED_ADMIN_PHONE ?? "+251900000000";
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (password) {
    const superAdmin = await prisma.role.findUniqueOrThrow({ where: { code: "super_admin" } });
    const admin = await prisma.user.upsert({
      where: { phone },
      create: { phone, fullName: "Super Admin", passwordHash: await argon2.hash(password, { type: argon2.argon2id }), phoneVerifiedAt: new Date() },
      update: {},
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: admin.id, roleId: superAdmin.id } },
      create: { userId: admin.id, roleId: superAdmin.id },
      update: {},
    });
    console.log(`Super admin ready: ${phone}`);
  } else {
    console.log("SEED_ADMIN_PASSWORD not set; skipped creating the super admin.");
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
