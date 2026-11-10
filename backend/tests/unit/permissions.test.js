import assert from 'node:assert/strict';
import { describe, it } from 'bun:test';
import { PERMISSION_DESCRIPTIONS, PERMISSIONS, ROLE_DEFINITIONS, ROLES } from '../../src/modules/rbac/permissions.js';

const role = (code) => ROLE_DEFINITIONS.find((r) => r.code === code);

describe('role definitions', () => {
  it('defines all six required roles', () => {
    assert.deepEqual(ROLE_DEFINITIONS.map((r) => r.code).sort(), Object.values(ROLES).sort());
  });

  it('describes every permission', () => {
    for (const code of Object.values(PERMISSIONS)) assert.ok(PERMISSION_DESCRIPTIONS[code], `${code} has no description`);
  });

  it('only references known permissions', () => {
    const known = new Set(Object.values(PERMISSIONS));
    for (const r of ROLE_DEFINITIONS) for (const p of r.permissions) assert.ok(known.has(p), `${r.code} → ${p}`);
  });

  it('gives guests nothing', () => assert.equal(role(ROLES.GUEST).permissions.length, 0));

  it('keeps bidding away from unverified buyers', () => {
    assert.ok(!role(ROLES.BUYER).permissions.includes(PERMISSIONS.BID_PLACE));
    assert.ok(role(ROLES.BIDDER).permissions.includes(PERMISSIONS.BID_PLACE));
  });

  it('keeps user management and settings with the super admin only', () => {
    for (const p of [PERMISSIONS.USER_MANAGE, PERMISSIONS.ROLE_ASSIGN, PERMISSIONS.SETTINGS_MANAGE, PERMISSIONS.AUDIT_VIEW]) {
      assert.ok(!role(ROLES.AUCTION_ADMIN).permissions.includes(p), `auction_admin should not have ${p}`);
      assert.ok(role(ROLES.SUPER_ADMIN).permissions.includes(p));
    }
  });

  it('gives the super admin every permission', () => {
    assert.equal(role(ROLES.SUPER_ADMIN).permissions.length, Object.values(PERMISSIONS).length);
  });
});
