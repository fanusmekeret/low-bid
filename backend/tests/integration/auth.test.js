import assert from 'node:assert/strict';
import { afterAll, beforeAll, describe, it } from 'bun:test';
import { hasTestDb, setup } from './helpers.js';

describe.skipIf(!hasTestDb)('auth, users and roles (MySQL)', () => {
  /** @type {Awaited<ReturnType<typeof setup>>} */
  let ctx;
  let request;
  const phone = '+251911000001';
  const password = 'abebe2026pass';
  let session;

  beforeAll(async () => {
    ({ default: request } = await import('supertest'));
    ctx = await setup();
    await ctx.reset();
  });
  afterAll(() => ctx?.close());

  const api = () => request(ctx.app);
  const bearer = (token) => ({ Authorization: `Bearer ${token}` });

  it('registers a buyer and sends a verification code', async () => {
    const res = await api().post('/api/v1/auth/register').send({
      phone: '0911000001', password, firstName: 'Abebe', lastName: 'Kebede', locale: 'am',
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    session = res.body.data;
    assert.equal(session.user.phone, phone);
    assert.deepEqual(session.user.roles, ['buyer']);
    assert.equal(session.user.phoneVerified, false);
    assert.ok(session.tokens.accessToken && session.tokens.refreshToken);
    assert.equal(session.otp.sent, true);
    assert.match(ctx.outbox.at(-1).text, /LOW BID/); // Amharic template, brand name kept
    const row = await ctx.prisma.user.findUnique({ where: { phone } });
    assert.ok(row.passwordHash.startsWith('$argon2id$'));
  });

  it('rejects a duplicate phone number', async () => {
    const res = await api().post('/api/v1/auth/register').send({ phone: '+251 911 000 001', password, firstName: 'X', lastName: 'Y' });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'PHONE_TAKEN');
  });

  it('rejects weak passwords and bad phone numbers with field details', async () => {
    const res = await api().post('/api/v1/auth/register').send({ phone: '0812', password: 'short', firstName: '', lastName: 'Y' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_FAILED');
    const paths = res.body.error.details.map((d) => d.path);
    for (const p of ['phone', 'password', 'firstName']) assert.ok(paths.includes(p), `missing ${p}`);
  });

  it('returns the profile without the password hash', async () => {
    const res = await api().get('/api/v1/me').set(bearer(session.tokens.accessToken));
    assert.equal(res.status, 200);
    assert.equal(res.body.data.firstName, 'Abebe');
    assert.equal(res.body.data.passwordHash, undefined);
    assert.ok(res.body.data.permissions.includes('watchlist:manage'));
    assert.ok(!res.body.data.permissions.includes('bid:place'));
  });

  it('requires a token and rejects garbage tokens', async () => {
    assert.equal((await api().get('/api/v1/me')).status, 401);
    const bad = await api().get('/api/v1/me').set(bearer('not.a.jwt'));
    assert.equal(bad.status, 401);
    assert.equal(bad.body.error.code, 'AUTH_TOKEN_INVALID');
  });

  it('blocks buyers from the admin API', async () => {
    const res = await api().get('/api/v1/admin/users').set(bearer(session.tokens.accessToken));
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'PERMISSION_DENIED');
  });

  it('counts wrong OTP attempts, then verifies the phone and grants bidding', async () => {
    const wrong = await api().post('/api/v1/auth/otp/verify').set(bearer(session.tokens.accessToken)).send({ code: '000000' === ctx.lastCode(phone) ? '111111' : '000000' });
    assert.equal(wrong.status, 400);
    assert.equal(wrong.body.error.code, 'OTP_INVALID');

    const code = ctx.lastCode(phone);
    const ok = await api().post('/api/v1/auth/otp/verify').set(bearer(session.tokens.accessToken)).send({ code });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.data.user.phoneVerified, true);
    assert.ok(ok.body.data.user.roles.includes('bidder'));
    assert.ok(ok.body.data.user.permissions.includes('bid:place'));
    session.tokens.accessToken = ok.body.data.tokens.accessToken;

    const reuse = await api().post('/api/v1/auth/otp/verify').set(bearer(session.tokens.accessToken)).send({ code });
    assert.equal(reuse.status, 409);
    assert.equal(reuse.body.error.code, 'PHONE_ALREADY_VERIFIED');
  });

  it('rejects wrong passwords with one generic message', async () => {
    const wrongPw = await api().post('/api/v1/auth/login').send({ phone, password: 'wrongpass1' });
    const noUser = await api().post('/api/v1/auth/login').send({ phone: '0911999999', password: 'wrongpass1' });
    assert.equal(wrongPw.status, 401);
    assert.equal(noUser.status, 401);
    assert.equal(wrongPw.body.error.message, noUser.body.error.message);
  });

  it('logs in and rotates refresh tokens, killing the family on reuse', async () => {
    const login = await api().post('/api/v1/auth/login').send({ phone: '0911000001', password });
    assert.equal(login.status, 200);
    const first = login.body.data.tokens.refreshToken;

    const r1 = await api().post('/api/v1/auth/refresh').send({ refreshToken: first });
    assert.equal(r1.status, 200);
    const second = r1.body.data.tokens.refreshToken;
    assert.notEqual(second, first);

    const replay = await api().post('/api/v1/auth/refresh').send({ refreshToken: first });
    assert.equal(replay.status, 401);
    assert.equal(replay.body.error.code, 'AUTH_REFRESH_REUSED');

    const afterTheft = await api().post('/api/v1/auth/refresh').send({ refreshToken: second });
    assert.equal(afterTheft.status, 401, 'whole family must be revoked after reuse');
  });

  it('logs out a device', async () => {
    const login = await api().post('/api/v1/auth/login').send({ phone, password });
    const rt = login.body.data.tokens.refreshToken;
    assert.equal((await api().post('/api/v1/auth/logout').send({ refreshToken: rt })).status, 204);
    assert.equal((await api().post('/api/v1/auth/refresh').send({ refreshToken: rt })).status, 401);
  });

  it('resets a forgotten password and revokes old sessions', async () => {
    const login = await api().post('/api/v1/auth/login').send({ phone, password });
    const oldRefresh = login.body.data.tokens.refreshToken;

    const unknown = await api().post('/api/v1/auth/password/forgot').send({ phone: '0911888888' });
    const known = await api().post('/api/v1/auth/password/forgot').send({ phone });
    assert.equal(unknown.status, 200);
    assert.equal(known.status, 200);
    assert.deepEqual(unknown.body, known.body, 'response must not reveal whether the number exists');

    const code = ctx.lastCode(phone);
    const reset = await api().post('/api/v1/auth/password/reset').send({ phone, code, newPassword: 'newpass2026' });
    assert.equal(reset.status, 200, JSON.stringify(reset.body));

    assert.equal((await api().post('/api/v1/auth/refresh').send({ refreshToken: oldRefresh })).status, 401);
    assert.equal((await api().post('/api/v1/auth/login').send({ phone, password })).status, 401);
    assert.equal((await api().post('/api/v1/auth/login').send({ phone, password: 'newpass2026' })).status, 200);
  });

  it('lets a super admin find, suspend and re-grant roles, with audit logs', async () => {
    const reg = await api().post('/api/v1/auth/register').send({ phone: '0911000099', password: 'adminpass2026', firstName: 'Sara', lastName: 'Admin' });
    const adminId = BigInt(reg.body.data.user.id);
    const superRole = await ctx.prisma.role.findUnique({ where: { code: 'super_admin' } });
    await ctx.prisma.userRole.create({ data: { userId: adminId, roleId: superRole.id } });
    const adminLogin = await api().post('/api/v1/auth/login').send({ phone: '0911000099', password: 'adminpass2026' });
    const adminToken = adminLogin.body.data.tokens.accessToken;

    const list = await api().get('/api/v1/admin/users?q=Abebe').set(bearer(adminToken));
    assert.equal(list.status, 200);
    assert.equal(list.body.meta.total, 1);
    const target = list.body.data[0].id;

    const suspend = await api().patch(`/api/v1/admin/users/${target}/status`).set(bearer(adminToken)).send({ status: 'SUSPENDED', reason: 'Unpaid wins' });
    assert.equal(suspend.status, 200);
    const blocked = await api().post('/api/v1/auth/login').send({ phone, password: 'newpass2026' });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.error.code, 'ACCOUNT_SUSPENDED');

    const self = await api().delete(`/api/v1/admin/users/${adminId}/roles/super_admin`).set(bearer(adminToken));
    assert.equal(self.status, 400);

    const grant = await api().post(`/api/v1/admin/users/${target}/roles`).set(bearer(adminToken)).send({ role: 'auction_admin' });
    assert.equal(grant.status, 200);
    assert.ok(grant.body.data.roles.includes('auction_admin'));

    const logs = await ctx.prisma.auditLog.findMany({ where: { entityId: target } });
    const actions = logs.map((l) => l.action);
    assert.ok(actions.includes('user.status_change'));
    assert.ok(actions.includes('user.role_grant'));
  });
});
