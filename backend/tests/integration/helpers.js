// Integration tests need a real MySQL database: set TEST_DATABASE_URL and run
// `npm run db:deploy` against it once (DATABASE_URL=$TEST_DATABASE_URL npx prisma migrate deploy).
// The tests wipe every table in that database.

process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET ||= 'test-access-secret-that-is-long-enough-1234567890';
process.env.OTP_PEPPER ||= 'test-otp-pepper-that-is-long-enough-1234567890abcd';
process.env.OTP_RESEND_COOLDOWN_SECONDS = '0';
process.env.OTP_MAX_PER_10_MIN = '50';
process.env.DATABASE_URL ||= process.env.TEST_DATABASE_URL || '';

export const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);

export async function setup() {
  const { prisma } = await import('../../src/config/prisma.js');
  const { createApp } = await import('../../src/app.js');
  const { setSmsProvider } = await import('../../src/services/sms/index.js');
  const seed = await import('../../src/db/seed.js');

  const outbox = [];
  setSmsProvider({ name: 'test', async send(to, text) { outbox.push({ to, text }); return {}; } });

  // Files go to a throwaway folder.
  const os = await import('node:os');
  const path = await import('node:path');
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { createLocalStorage } = await import('../../src/services/storage/local.js');
  const { setStorage, mediaSigningSecret } = await import('../../src/services/storage/index.js');
  const storageDir = await mkdtemp(path.join(os.tmpdir(), 'lowbid-it-'));
  const storage = createLocalStorage({
    rootDir: storageDir,
    publicBaseUrl: 'http://localhost/media',
    privateBaseUrl: 'http://localhost/api/v1/files/private',
    signingSecret: mediaSigningSecret(),
  });
  setStorage(storage);

  const { hashPassword } = await import('../../src/modules/auth/password.js');
  const { default: request } = await import('supertest');
  const app = createApp();

  return {
    prisma,
    app,
    storage,
    outbox,
    /** Creates a user with the given roles directly and returns a fresh access token. */
    async makeUser({ phone, roles = ['buyer', 'bidder'], verified = true, password = 'testpass2026' }) {
      const roleRows = await prisma.role.findMany({ where: { code: { in: roles } } });
      await prisma.user.create({
        data: {
          phone, firstName: 'Test', lastName: phone.slice(-4), passwordHash: await hashPassword(password),
          phoneVerifiedAt: verified ? new Date() : null,
          roles: { create: roleRows.map((r) => ({ roleId: r.id })) },
        },
      });
      return this.login(phone, password);
    },
    async login(phone, password = 'testpass2026') {
      const res = await request(app).post('/api/v1/auth/login').send({ phone, password });
      if (res.status !== 200) throw new Error(`login failed: ${JSON.stringify(res.body)}`);
      return res.body.data.tokens.accessToken;
    },
    /** Latest 6-digit code sent to this phone. */
    lastCode(phone) {
      const msg = [...outbox].reverse().find((m) => m.to === phone);
      return msg?.text.match(/\b(\d{6})\b/)?.[1];
    },
    async reset() {
      const tables = await prisma.$queryRaw`SELECT table_name AS t FROM information_schema.tables
        WHERE table_schema = DATABASE() AND table_name <> '_prisma_migrations'`;
      await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
      for (const { t } of tables) await prisma.$executeRawUnsafe(`TRUNCATE TABLE \`${t}\``);
      await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
      await seed.seedRbac();
      await seed.seedCategories();
      await seed.seedSettings();
      const { invalidatePermissionCache } = await import('../../src/modules/rbac/rbac.service.js');
      invalidatePermissionCache();
      (await import('../../src/modules/settings/settings.service.js')).clearSettingsCache();
      (await import('../../src/modules/categories/categories.service.js')).invalidateCategoryCache();
      outbox.length = 0;
    },
    async close() {
      await prisma.$disconnect();
      await rm(storageDir, { recursive: true, force: true });
    },
  };
}
