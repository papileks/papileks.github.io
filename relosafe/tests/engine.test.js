import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  S, CONFIG, CATALOG, TERMINAL, createPackage, authorize, tick, openDispute, resolveDispute,
  grantConsent, chooseGuided, completeUserAction, eraseNow, verifyAudit, riskScore, eligibility,
  validateAddress, entityById, isHighRisk, summary,
} from '../engine.js';

const PII = {
  name: 'Test Mover',
  oldAddress: { line1: '12 OAK ST', line2: '', city: 'SPRINGFIELD', state: 'IL', zip: '62701' },
  newAddress: { line1: '400 LAKE AVE', line2: 'APT 7B', city: 'MADISON', state: 'WI', zip: '53703' },
};
const DELEGATED_IDS = CATALOG.filter((e) => e.channels[0] !== 'guided').map((e) => e.id);
const ALL_IDS = CATALOG.filter((e) => !e.immigrationOnly).map((e) => e.id);

function make(id, opts = {}) {
  return createPackage({ id, pii: PII, entityIds: opts.entityIds || ALL_IDS, effectiveDay: opts.effectiveDay ?? 0,
    signals: opts.signals, protectedMover: opts.protectedMover, retentionDays: opts.retentionDays ?? 30 });
}

function run(pkg, fromDay, toDay, kill = {}, { autoUser = true, autoConsent = true } = {}) {
  for (let d = fromDay; d <= toDay; d++) {
    tick(pkg, d, kill);
    if (pkg.status !== 'active' || pkg.dispute?.status === 'open') continue;
    for (const o of pkg.orders) {
      if (autoUser && o.state === S.AWAITING_USER) completeUserAction(pkg, o.id, d, `REF-${o.id}`);
      else if (autoConsent && o.state === S.AWAITING_CONSENT) grantConsent(pkg, o.id, d);
    }
  }
}

test('high-risk delegated orders are never submitted before the hold ends; guided orders are exempt', () => {
  for (let i = 0; i < 60; i++) {
    const pkg = authorize(make(`H${i}`), 0, { mfa: true, consent: true });
    run(pkg, 1, 45);
    for (const o of pkg.orders) {
      const e = entityById(o.entityId);
      const firstSubmit = o.history.find((h) => h.to === S.IN_PROGRESS);
      if (isHighRisk(e) && firstSubmit) assert.ok(firstSubmit.day >= CONFIG.holdDays, `${o.id} submitted on day ${firstSubmit.day}`);
      if (e.channels[0] === 'guided') assert.equal(o.history[1].to, S.AWAITING_USER, 'guided starts immediately');
    }
  }
});

test('step-up risk lengthens the hold and requires the step-up check', () => {
  const signals = { newDevice: true, oldAddressSignal: 'none' };
  const pkg = make('STEP', { signals });
  assert.ok(pkg.risk.stepUp);
  assert.throws(() => authorize(pkg, 0, { mfa: true, consent: true }), /step-up/);
  authorize(pkg, 0, { mfa: true, consent: true, stepUpDone: true });
  assert.equal(pkg.holdUntil, CONFIG.holdDaysStepUp);
});

test('no entity ever receives a change twice, and unknown outcomes are always reconciled first', () => {
  let unknowns = 0;
  for (let i = 0; i < 200; i++) {
    const pkg = authorize(make(`D${i}`, { entityIds: DELEGATED_IDS }), 0, { mfa: true, consent: true });
    run(pkg, 1, 60);
    for (const o of pkg.orders) {
      assert.ok(o.entityApplications <= 1, `${o.id} applied ${o.entityApplications}x`);
      o.history.forEach((h, idx) => {
        if (h.to !== S.OUTCOME_UNKNOWN) return;
        unknowns++;
        const next = o.history[idx + 1];
        assert.ok(next && [S.CONFIRMED, S.SCHEDULED].includes(next.to), `${o.id}: ${next?.to} after unknown`);
      });
    }
  }
  assert.ok(unknowns > 20, 'simulation should exercise the unknown-outcome path');
});

test('kill switch fallback to a wider audience waits for re-consent; declining routes to guided', () => {
  const pkg = authorize(make('K', { entityIds: ['northwind', 'fiberline'] }), 0, { mfa: true, consent: true });
  const kill = { 'northwind:api': true, 'fiberline:api': true };
  run(pkg, 1, 8, kill, { autoUser: false, autoConsent: false });
  const nw = pkg.orders.find((o) => o.entityId === 'northwind');
  const fl = pkg.orders.find((o) => o.entityId === 'fiberline');
  assert.equal(nw.state, S.AWAITING_CONSENT, 'api → assisted widens audience');
  assert.equal(nw.pendingChannel, 'assisted');
  assert.equal(fl.state, S.AWAITING_USER, 'api → guided narrows audience, no consent needed');
  chooseGuided(pkg, nw.id, 8);
  assert.equal(nw.state, S.AWAITING_USER);
  assert.equal(nw.channel, 'guided');
});

test('upheld dispute locks the package, cancels pending orders and reverts confirmed ones', () => {
  for (let i = 0; i < 40; i++) {
    const pkg = authorize(make(`U${i}`), 0, { mfa: true, consent: true });
    run(pkg, 1, 9);
    openDispute(pkg, 9);
    assert.throws(() => completeUserAction(pkg, pkg.orders[0].id, 9, 'x'), /locked/);
    const confirmedBefore = pkg.orders.filter((o) => o.state === S.CONFIRMED).map((o) => o.id);
    run(pkg, 10, 11);
    for (const o of pkg.orders) {
      const after = o.history.filter((h) => h.day >= 10 && h.day <= 11 && h.to === S.IN_PROGRESS);
      assert.equal(after.length, 0, `${o.id} submitted during open dispute`);
    }
    resolveDispute(pkg, 12, true);
    for (const id of confirmedBefore) assert.ok(pkg.orders.some((o) => o.revertsOrderId === id), `revert for ${id}`);
    run(pkg, 13, 80);
    for (const o of pkg.orders.filter((x) => x.kind === 'change')) {
      assert.ok([S.CANCELLED, S.REVERTED, S.FAILED, S.EXPIRED].includes(o.state) || pkg.orders.some((r) => r.revertsOrderId === o.id),
        `${o.id} left ${o.state} without a revert`);
    }
  }
});

test('rejected dispute restores each order to its previous state', () => {
  const pkg = authorize(make('R'), 0, { mfa: true, consent: true });
  const before = new Map(pkg.orders.map((o) => [o.id, o.state]));
  openDispute(pkg, 0);
  resolveDispute(pkg, 1, false);
  for (const o of pkg.orders) assert.equal(o.state, before.get(o.id));
});

test('notices never include the new address; protected movers get no old-address letter', () => {
  const pkg = authorize(make('N'), 0, { mfa: true, consent: true });
  for (const n of pkg.notices) {
    assert.ok(!n.body.includes('LAKE'), 'new address leaked');
    assert.ok(!n.body.includes('Northwind'), 'entity list leaked');
  }
  assert.match(pkg.notices[0].status, /Mailed/);
  const p = authorize(make('P', { protectedMover: true }), 0, { mfa: true, consent: true });
  assert.match(p.notices[0].status, /Suppressed/);
});

test('closure waits for the dispute window; 0-day retention deletes at closure with a valid chain', () => {
  const pkg = authorize(make('C', { retentionDays: 0 }), 0, { mfa: true, consent: true });
  run(pkg, 1, CONFIG.disputeWindowDays - 1);
  assert.equal(pkg.status, 'active');
  run(pkg, CONFIG.disputeWindowDays, 90);
  assert.equal(pkg.status, 'deleted');
  assert.ok(pkg.closedDay >= CONFIG.disputeWindowDays);
  assert.equal(pkg.deletedDay, pkg.closedDay);
  assert.equal(pkg.pii, null);
  assert.ok(pkg.receipt.accessCode);
  assert.ok(verifyAudit(pkg));
  assert.ok(!JSON.stringify(pkg).includes('LAKE AVE'), 'PII survived deletion');
  pkg.audit[1].detail = 'tampered';
  assert.ok(!verifyAudit(pkg));
});

test('erasure cancels pending work and shreds PII', () => {
  const pkg = authorize(make('E'), 0, { mfa: true, consent: true });
  run(pkg, 1, 3);
  eraseNow(pkg, 3);
  assert.equal(pkg.status, 'deleted');
  assert.ok(pkg.orders.every((o) => TERMINAL.has(o.state)));
  assert.equal(pkg.subprocessorDeletion.length, 4);
});

test('risk, eligibility and address validation rules', () => {
  assert.equal(riskScore({}).score, 0);
  assert.ok(riskScore({ destination: 'cmra' }).manualReview);
  const v = validateAddress({ line1: '400 Lake Avenue', line2: 'PMB 12', city: 'Madison', state: 'wi', zip: '53703' });
  assert.ok(v.ok);
  assert.equal(v.standardized.line1, '400 LAKE AVE');
  assert.ok(v.flags.cmra);
  assert.equal(eligibility(entityById('dmv'), v.flags).ok, false);
  assert.equal(eligibility(entityById('summit'), v.flags).ok, true);
  assert.equal(validateAddress({ line1: 'Lake', city: '', state: 'X', zip: '1' }).errors.length, 4);
});

test('authorization requires MFA, consent and proof of control for high-risk delegation', () => {
  assert.throws(() => authorize(make('A1'), 0, { mfa: false, consent: true }), /MFA/);
  assert.throws(() => authorize(make('A2'), 0, { mfa: true, consent: false }), /consent/);
  const p = createPackage({ id: 'A3', pii: PII, entityIds: ['northwind'], proofOfControl: 'none' });
  assert.throws(() => authorize(p, 0, { mfa: true, consent: true }), /Proof/);
  const s = summary(authorize(make('A4'), 0, { mfa: true, consent: true }));
  assert.equal(s.total, ALL_IDS.length);
});
