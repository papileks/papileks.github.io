// ReloSafe prototype engine — pure logic, no DOM. Implements the v0.2 state
// machine (SRD §4.10) against simulated entities. Requirement IDs refer to
// relosafe/requirements.md.

export const CONFIG = {
  holdDays: 7,                 // FR-FRD-006
  holdDaysStepUp: 10,
  disputeWindowDays: 30,       // FR-FRD-004/007
  stepUpThreshold: 60,         // FR-FRD-001
  maxAttemptsPerChannel: 3,    // FR-EXE-003
  userActionTimeoutDays: 30,
  propagationCheckDays: 14,    // FR-STA-005
  retentionDefault: 30,        // FR-PRV-002
  retentionMax: 90,
};

export const S = {
  DRAFT: 'Draft',
  AUTHORIZED: 'Authorized',
  ON_HOLD: 'On Hold',
  SCHEDULED: 'Scheduled',
  IN_PROGRESS: 'In Progress',
  OUTCOME_UNKNOWN: 'Outcome Unknown',
  AWAITING_USER: 'Awaiting User Action',
  AWAITING_CONSENT: 'Awaiting Consent',
  LOCKED: 'Locked',
  CONFIRMED: 'Confirmed',
  FAILED: 'Failed',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
  REVERTED: 'Reverted',
};

const ALLOWED = {
  [S.DRAFT]: [S.AUTHORIZED, S.CANCELLED],
  [S.AUTHORIZED]: [S.ON_HOLD, S.SCHEDULED, S.AWAITING_USER, S.CANCELLED],
  [S.ON_HOLD]: [S.SCHEDULED, S.LOCKED, S.CANCELLED],
  [S.SCHEDULED]: [S.IN_PROGRESS, S.AWAITING_USER, S.AWAITING_CONSENT, S.LOCKED, S.CANCELLED, S.FAILED],
  [S.IN_PROGRESS]: [S.CONFIRMED, S.OUTCOME_UNKNOWN, S.SCHEDULED, S.AWAITING_USER, S.AWAITING_CONSENT, S.FAILED],
  [S.OUTCOME_UNKNOWN]: [S.CONFIRMED, S.SCHEDULED, S.FAILED],
  [S.AWAITING_USER]: [S.CONFIRMED, S.SCHEDULED, S.EXPIRED, S.CANCELLED, S.LOCKED],
  [S.AWAITING_CONSENT]: [S.SCHEDULED, S.AWAITING_USER, S.CANCELLED, S.LOCKED, S.EXPIRED],
  [S.LOCKED]: [S.ON_HOLD, S.SCHEDULED, S.AWAITING_USER, S.AWAITING_CONSENT, S.CANCELLED],
  [S.CONFIRMED]: [S.REVERTED],
  [S.FAILED]: [], [S.EXPIRED]: [], [S.CANCELLED]: [], [S.REVERTED]: [],
};

export const TERMINAL = new Set([S.CONFIRMED, S.FAILED, S.EXPIRED, S.CANCELLED, S.REVERTED]);
const CANCELLABLE = new Set([S.DRAFT, S.AUTHORIZED, S.ON_HOLD, S.SCHEDULED, S.AWAITING_USER, S.AWAITING_CONSENT]);
const LOCKABLE = new Set([S.ON_HOLD, S.SCHEDULED, S.AWAITING_USER, S.AWAITING_CONSENT]);

// Audience rank: who can see the user's data on this channel (SRD §3).
export const CHANNELS = {
  guided: { label: 'User-guided', audience: 'You only — you submit it yourself', rank: 0 },
  api: { label: 'Direct API', audience: "The entity's system", rank: 1 },
  partner: { label: 'Partner rail', audience: 'Integration partner + entity', rank: 2 },
  assisted: { label: 'Assisted (agent under LOA)', audience: 'ReloSafe agent + entity', rank: 3 },
};

export const FIELDS = {
  name: 'Full name',
  oldAddress: 'Old address',
  newAddress: 'New address',
  dob: 'Date of birth',
  accountLast4: 'Account no. (last 4)',
  ssnLast4: 'SSN (last 4)',
  license: "Driver's license no.",
  policy: 'Policy / member no.',
  email: 'Email',
  effectiveDate: 'Effective date',
};

export const CATEGORIES = ['Government', 'Financial', 'Insurance', 'Employer/Payroll', 'Utilities', 'Healthcare', 'Subscriptions', 'Other'];
const HIGH_RISK_CATEGORIES = new Set(['Government', 'Financial', 'Insurance', 'Employer/Payroll']);

// Fictional institutions; government entries describe processes, not
// integrations — they default to the guided channel (FR-CAT-007).
const base = { sim: { challenge: 0.08, timeout: 0.08, error: 0.15 } };
export const CATALOG = [
  { id: 'usps', name: 'USPS Change of Address (mail forwarding)', category: 'Government', channels: ['guided'], fields: ['name', 'oldAddress', 'newAddress', 'effectiveDate', 'email'], addressType: 'mailing', slaDays: 3, recommended: true,
    guide: 'Open the official USPS Change of Address flow (it charges a small identity-verification fee to your card), enter the details below, then paste your USPS confirmation number here.' },
  { id: 'dmv', name: 'State DMV — license & vehicle registration', category: 'Government', channels: ['guided'], fields: ['name', 'license', 'dob', 'newAddress'], addressType: 'residential', slaDays: 5, deadlineDays: 30, deadlineNote: 'Often 10–30 days; varies by state', recommended: true,
    guide: "Use your state DMV's online address-change service with the pre-filled details, then record the confirmation number." },
  { id: 'voter', name: 'Voter registration (state)', category: 'Government', channels: ['guided'], fields: ['name', 'dob', 'newAddress'], addressType: 'residential', slaDays: 7, deadlineNote: 'Before the registration deadline for the next election', recommended: true,
    guide: "Re-register at your new address through your state's official voter registration site." },
  { id: 'irs', name: 'IRS (Form 8822)', category: 'Government', channels: ['guided'], fields: ['name', 'ssnLast4', 'oldAddress', 'newAddress'], addressType: 'mailing', slaDays: 7,
    guide: 'Print the pre-filled Form 8822 summary, sign it, and mail it to the address in the form instructions.' },
  { id: 'uscis', name: 'USCIS AR-11 change of address', category: 'Government', channels: ['guided'], fields: ['name', 'oldAddress', 'newAddress'], addressType: 'residential', slaDays: 3, deadlineDays: 10, deadlineNote: 'Within 10 days of moving', immigrationOnly: true,
    guide: 'Submit AR-11 yourself through the official USCIS online service and record the confirmation.' },
  { ...base, id: 'northwind', name: 'Northwind Bank — checking', category: 'Financial', channels: ['api', 'assisted', 'guided'], fields: ['name', 'accountLast4', 'newAddress'], addressType: 'both', slaDays: 2, recommended: true,
    sim: { challenge: 0.35, timeout: 0.1, error: 0.1 } },
  { ...base, id: 'lakeside', name: 'Lakeside Credit Union', category: 'Financial', channels: ['partner', 'guided'], fields: ['name', 'accountLast4', 'newAddress'], addressType: 'both', slaDays: 3 },
  { ...base, id: 'summit', name: 'Summit Card Services — credit card', category: 'Financial', channels: ['api', 'partner', 'assisted', 'guided'], fields: ['name', 'accountLast4', 'newAddress'], addressType: 'mailing', slaDays: 1, recommended: true,
    sim: { challenge: 0.05, timeout: 0.15, error: 0.3 } },
  { ...base, id: 'harbor', name: 'Harbor Brokerage', category: 'Financial', channels: ['assisted', 'guided'], fields: ['name', 'accountLast4', 'ssnLast4', 'newAddress'], addressType: 'residential', slaDays: 4 },
  { ...base, id: 'evergreen', name: 'Evergreen Student Loans', category: 'Financial', channels: ['partner', 'guided'], fields: ['name', 'accountLast4', 'newAddress'], addressType: 'mailing', slaDays: 2 },
  { ...base, id: 'granite', name: 'Granite Auto Insurance', category: 'Insurance', channels: ['api', 'assisted', 'guided'], fields: ['name', 'policy', 'newAddress', 'effectiveDate'], addressType: 'residential', slaDays: 2, recommended: true },
  { ...base, id: 'cobalt', name: "Cobalt Renter's Insurance", category: 'Insurance', channels: ['api', 'guided'], fields: ['name', 'policy', 'newAddress', 'effectiveDate'], addressType: 'residential', slaDays: 1 },
  { ...base, id: 'payroll', name: 'Employer payroll (via HR platform)', category: 'Employer/Payroll', channels: ['partner', 'guided'], fields: ['name', 'newAddress', 'effectiveDate'], addressType: 'residential', slaDays: 3, recommended: true },
  { ...base, id: 'metro', name: 'Metro Electric', category: 'Utilities', channels: ['api', 'assisted', 'guided'], fields: ['name', 'accountLast4', 'oldAddress', 'newAddress', 'effectiveDate'], addressType: 'mailing', slaDays: 2, recommended: true },
  { ...base, id: 'water', name: 'City Water & Sewer', category: 'Utilities', channels: ['guided'], fields: ['name', 'oldAddress', 'newAddress', 'effectiveDate'], addressType: 'mailing', slaDays: 5,
    guide: 'Call or use the city utility portal to stop service at the old address and start it at the new one.' },
  { ...base, id: 'fiberline', name: 'Fiberline Internet', category: 'Utilities', channels: ['api', 'guided'], fields: ['name', 'accountLast4', 'newAddress', 'effectiveDate'], addressType: 'mailing', slaDays: 2 },
  { ...base, id: 'orbit', name: 'Orbit Mobile', category: 'Utilities', channels: ['api', 'guided'], fields: ['name', 'accountLast4', 'newAddress'], addressType: 'mailing', slaDays: 1, recommended: true },
  { ...base, id: 'bluebird', name: 'Bluebird Health Plan', category: 'Healthcare', channels: ['partner', 'guided'], fields: ['name', 'dob', 'policy', 'newAddress'], addressType: 'residential', slaDays: 3, recommended: true },
  { ...base, id: 'riverside', name: 'Riverside Pharmacy', category: 'Healthcare', channels: ['api', 'guided'], fields: ['name', 'dob', 'newAddress'], addressType: 'mailing', slaDays: 1 },
  { ...base, id: 'maple', name: 'Maple Family Practice', category: 'Healthcare', channels: ['guided'], fields: ['name', 'dob', 'newAddress'], addressType: 'mailing', slaDays: 3,
    guide: 'Use the printable letter or the patient portal to update your address.' },
  { ...base, id: 'ledger', name: 'Daily Ledger (newspaper)', category: 'Subscriptions', channels: ['api', 'guided'], fields: ['name', 'newAddress', 'effectiveDate'], addressType: 'mailing', slaDays: 1 },
  { ...base, id: 'pantry', name: 'Pantry Box meal kits', category: 'Subscriptions', channels: ['api', 'assisted', 'guided'], fields: ['name', 'email', 'newAddress', 'effectiveDate'], addressType: 'mailing', slaDays: 1, recommended: true },
  { ...base, id: 'paws', name: 'Paws & Co pet supplies', category: 'Subscriptions', channels: ['api', 'guided'], fields: ['name', 'email', 'newAddress'], addressType: 'mailing', slaDays: 1 },
  { ...base, id: 'alumni', name: 'University alumni association', category: 'Other', channels: ['guided'], fields: ['name', 'email', 'newAddress'], addressType: 'mailing', slaDays: 5,
    guide: 'Update your address in the alumni portal, or send the generated letter.' },
];

export const entityById = (id) => CATALOG.find((e) => e.id === id);
export const isHighRisk = (entity) => HIGH_RISK_CATEGORIES.has(entity.category);
export const isDelegated = (channel) => channel !== 'guided';

// ---------- deterministic randomness (reproducible demos and tests) ----------

export function hashStr(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function rand(seedStr) {
  let t = (hashStr(seedStr) + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const ref = (seed) => (hashStr(seed).toString(36).toUpperCase() + 'XXXXXX').slice(0, 8);

// ---------- address validation (mock CASS/DPV) — FR-IDV-003, FR-MOV-008 ----------

const ABBREV = [[/\bstreet\b/gi, 'ST'], [/\bavenue\b/gi, 'AVE'], [/\broad\b/gi, 'RD'], [/\bdrive\b/gi, 'DR'],
  [/\bboulevard\b/gi, 'BLVD'], [/\blane\b/gi, 'LN'], [/\bcourt\b/gi, 'CT'], [/\bapartment\b/gi, 'APT'],
  [/\bsuite\b/gi, 'STE'], [/\bnorth\b/gi, 'N'], [/\bsouth\b/gi, 'S'], [/\beast\b/gi, 'E'], [/\bwest\b/gi, 'W']];

const clean = (s) => (s || '').trim().replace(/\s+/g, ' ').replace(/[.,]/g, '');
const std = (s) => ABBREV.reduce((acc, [re, to]) => acc.replace(re, to), clean(s)).toUpperCase();

export function validateAddress(a) {
  const errors = [];
  if (!/^\d+\s+\S+/.test(clean(a.line1)) && !/^P\s*O\s*BOX\s+\d+/i.test(clean(a.line1))) errors.push('Street line needs a house number and street name (or a PO Box number).');
  if (!clean(a.city)) errors.push('City is required.');
  if (!/^[A-Za-z]{2}$/.test(clean(a.state))) errors.push('State must be a 2-letter code.');
  if (!/^\d{5}(-\d{4})?$/.test(clean(a.zip))) errors.push('ZIP must be 5 digits (or ZIP+4).');
  const standardized = {
    line1: std(a.line1),
    line2: std(a.line2),
    city: clean(a.city).toUpperCase(),
    state: clean(a.state).toUpperCase(),
    zip: clean(a.zip),
  };
  const joined = `${standardized.line1} ${standardized.line2}`;
  const flags = {
    pobox: /\bP\s*O\s*BOX\b/.test(joined),
    cmra: /\bPMB\b/.test(joined),
  };
  return { ok: errors.length === 0, errors, standardized, flags };
}

export const formatAddress = (a) => (a ? [a.line1, a.line2, `${a.city}, ${a.state} ${a.zip}`].filter(Boolean).join(', ') : '');

// ---------- risk — FR-FRD-001 (no demographic / ZIP features) ----------

export function riskScore({ newDevice = false, oldAddressSignal = 'match', recentMoves = 0, destination = 'residential' } = {}) {
  const factors = [];
  if (newDevice) factors.push(['Unrecognized device', 20]);
  if (oldAddressSignal === 'partial') factors.push(['Old-address signal only partially matches', 20]);
  if (oldAddressSignal === 'none') factors.push(['No independent old-address signal', 40]);
  if (recentMoves > 1) factors.push([`${recentMoves} moves in 12 months`, Math.min(30, 15 * (recentMoves - 1))]);
  if (destination === 'cmra') factors.push(['Destination is a mail-receiving agency (PMB)', 25]);
  if (destination === 'pobox') factors.push(['Destination is a PO Box', 10]);
  const score = Math.min(100, factors.reduce((s, [, w]) => s + w, 0));
  return {
    score,
    factors,
    stepUp: score >= CONFIG.stepUpThreshold,
    manualReview: destination === 'cmra' || destination === 'pobox', // FR-FRD-003: review, not block
  };
}

// FR-MOV-006: residential-only entities can't take a PO Box / PMB destination.
export function eligibility(entity, flags = {}) {
  if (entity.addressType === 'residential' && (flags.pobox || flags.cmra)) {
    return { ok: false, reason: 'Needs a residential address — a PO Box or mail-receiving address can’t be sent here.' };
  }
  return { ok: true };
}

// FR-CAT-004: group by category; order by deadline, then risk, then SLA.
export function groupedCatalog({ immigrationFilings = false } = {}) {
  const list = CATALOG.filter((e) => !e.immigrationOnly || immigrationFilings);
  return CATEGORIES.map((category) => ({
    category,
    entities: list.filter((e) => e.category === category).sort((a, b) =>
      (a.deadlineDays ?? 999) - (b.deadlineDays ?? 999)
      || Number(isHighRisk(b)) - Number(isHighRisk(a))
      || a.slaDays - b.slaDays),
  })).filter((g) => g.entities.length);
}

// ---------- audit log with hash chain — FR-PRV-006, NFR-REL-003 ----------

function audit(pkg, day, actor, action, detail = '') {
  const prev = pkg.audit.length ? pkg.audit[pkg.audit.length - 1].hash : '0';
  const body = { day, actor, action, detail };
  pkg.audit.push({ ...body, hash: hashStr(prev + JSON.stringify(body)).toString(16).padStart(8, '0') });
}

export function verifyAudit(pkg) {
  let prev = '0';
  for (const e of pkg.audit) {
    const { day, actor, action, detail } = e;
    const h = hashStr(prev + JSON.stringify({ day, actor, action, detail })).toString(16).padStart(8, '0');
    if (h !== e.hash) return false;
    prev = e.hash;
  }
  return true;
}

// ---------- package lifecycle ----------

export function createPackage({ id, day = 0, pii, effectiveDay = 0, addressType = 'both', entityIds, signals = {}, destination = 'residential',
  protectedMover = false, proofOfControl = 'lease', retentionDays = CONFIG.retentionDefault }) {
  const risk = riskScore({ ...signals, destination });
  const pkg = {
    id: id || `PKG-${ref(JSON.stringify(pii) + day + entityIds.join())}`,
    createdDay: day,
    status: 'draft', // draft → active → closed → deleted
    pii,
    effectiveDay,
    addressType,
    destination,
    protectedMover,
    proofOfControl,
    retentionDays: Math.max(0, Math.min(CONFIG.retentionMax, retentionDays)),
    risk,
    orders: [],
    notices: [],
    audit: [],
    dispute: null,
  };
  entityIds.forEach((eid, i) => pkg.orders.push(newOrder(pkg, eid, 'change', i)));
  audit(pkg, day, 'user', 'Move Package created', `${entityIds.length} entities selected`);
  return pkg;
}

function newOrder(pkg, entityId, kind, n, revertsOrderId = null) {
  const entity = entityById(entityId);
  return {
    id: `${kind === 'revert' ? 'RV' : 'CO'}-${n + 1}-${entityId}`,
    kind,
    entityId,
    revertsOrderId,
    state: S.DRAFT,
    channel: entity.channels[0],
    consentedRank: null,
    attempts: 0,
    submissions: 0,
    entityApplications: 0, // ground truth at the simulated entity (test invariant: ≤ 1)
    nextDay: null,
    holdUntil: null,
    history: [],
    task: null,
    artifact: null,
    propagation: null,
  };
}

function transition(pkg, order, to, day, reason) {
  if (!ALLOWED[order.state].includes(to)) {
    throw new Error(`Illegal transition ${order.state} → ${to} for ${order.id}`);
  }
  order.history.push({ day, from: order.state, to, reason, channel: order.channel });
  order.state = to;
}

const killed = (kill, entityId, channel) => isDelegated(channel) && Boolean(kill && kill[`${entityId}:${channel}`]);

function firstLiveChannel(entity, kill) {
  return entity.channels.find((c) => !killed(kill, entity.id, c)) || 'guided';
}

export function holdUntil(pkg, day) {
  return day + (pkg.risk.stepUp ? CONFIG.holdDaysStepUp : CONFIG.holdDays);
}

export function authorizationCheck(pkg) {
  const problems = [];
  const anyHighRiskDelegated = pkg.orders.some((o) => isHighRisk(entityById(o.entityId)) && isDelegated(o.channel));
  if (anyHighRiskDelegated && pkg.proofOfControl === 'none') problems.push('Proof that you control the new address is required for financial, government, insurance or payroll changes (FR-IDV-004).');
  if (!pkg.orders.length) problems.push('Select at least one entity.');
  return problems;
}

// FR-MOV-003 — one explicit authorization.
export function authorize(pkg, day, { mfa, consent, kill = {}, stepUpDone = false }) {
  if (pkg.status !== 'draft') throw new Error('Package already authorized');
  if (!mfa) throw new Error('Step-up MFA required (FR-IDV-005)');
  if (!consent) throw new Error('Affirmative consent required (FR-MOV-003)');
  if (pkg.risk.stepUp && !stepUpDone) throw new Error('Risk score above threshold: complete the step-up check (FR-FRD-001)');
  const problems = authorizationCheck(pkg);
  if (problems.length) throw new Error(problems.join(' '));

  pkg.status = 'active';
  pkg.authorizedDay = day;
  pkg.holdUntil = holdUntil(pkg, day);
  pkg.disputeUntil = day + CONFIG.disputeWindowDays;
  audit(pkg, day, 'user', 'Authorized with step-up MFA', `consent screen v0.2; ${pkg.orders.length} orders; risk ${pkg.risk.score}`);

  for (const order of pkg.orders) {
    const entity = entityById(order.entityId);
    order.channel = firstLiveChannel(entity, kill);
    order.consentedRank = CHANNELS[order.channel].rank;
    transition(pkg, order, S.AUTHORIZED, day, 'User authorization');
    release(pkg, order, day, { hold: true });
  }

  // FR-FRD-002 / FR-FRD-008 — notices never contain the new address.
  const body = 'A request to change your address was authorized with ReloSafe. If you did not request this, '
    + `report it within ${CONFIG.disputeWindowDays} days at relosafe.example/dispute with code ${pkg.id}. `
    + 'This notice deliberately does not include the new address or the list of companies.';
  if (pkg.protectedMover) {
    pkg.notices.push({ day, channel: 'Letter to old address', status: 'Suppressed — protected mover (FR-FRD-008)', body: '' });
  } else {
    pkg.notices.push({ day, channel: 'Letter to old address', status: `Mailed — proof of mailing #${ref(pkg.id + 'mail')}`, body });
  }
  pkg.notices.push({ day, channel: 'Email + SMS to verified contacts', status: 'Sent', body });
  audit(pkg, day, 'system', 'Old-address notice', pkg.protectedMover ? 'suppressed (protected mover)' : 'mailed');
  return pkg;
}

function release(pkg, order, day, { hold }) {
  const entity = entityById(order.entityId);
  if (order.channel === 'guided') {
    order.task = { kind: 'guided', text: entity.guide || `Contact ${entity.name} yourself using the pre-filled letter, then record the confirmation.` };
    transition(pkg, order, S.AWAITING_USER, day, 'Guided channel: user submits directly');
    order.waitingSince = day;
    return;
  }
  const effective = Math.max(day, pkg.effectiveDay);
  if (hold && isHighRisk(entity) && order.kind === 'change') {
    order.holdUntil = pkg.holdUntil;
    transition(pkg, order, S.ON_HOLD, day, `High-risk: held until day ${pkg.holdUntil} (FR-FRD-006)`);
    return;
  }
  order.nextDay = effective;
  transition(pkg, order, S.SCHEDULED, day, effective > day ? `Future-dated: releases day ${effective}` : 'Scheduled');
}

// Fallback to the next live channel — FR-CAT-006 with the FR-MOV-007 consent rule.
function fallback(pkg, order, day, kill, why) {
  const entity = entityById(order.entityId);
  const idx = entity.channels.indexOf(order.channel);
  const next = entity.channels.slice(idx + 1).find((c) => !killed(kill, entity.id, c));
  if (!next) {
    transition(pkg, order, S.FAILED, day, `${why}; no channel left`);
    return;
  }
  if (CHANNELS[next].rank > order.consentedRank) {
    order.pendingChannel = next;
    order.waitingSince = day;
    transition(pkg, order, S.AWAITING_CONSENT, day, `${why}; ${CHANNELS[next].label} widens the data audience (FR-MOV-007)`);
    return;
  }
  order.history.push({ day, from: order.state, to: order.state, reason: `${why}; fell back to ${CHANNELS[next].label}`, channel: next });
  order.channel = next;
  order.attempts = 0;
  if (next === 'guided') {
    order.task = { kind: 'guided', text: entity.guide || `Contact ${entity.name} yourself using the pre-filled letter, then record the confirmation.` };
    order.waitingSince = day;
    transition(pkg, order, S.AWAITING_USER, day, 'Guided fallback: user submits directly');
  } else {
    order.nextDay = day;
  }
}

function confirm(pkg, order, day, artifact, reason) {
  order.artifact = { day, ...artifact };
  order.task = null;
  transition(pkg, order, S.CONFIRMED, day, reason);
  const entity = entityById(order.entityId);
  if (order.kind === 'change') {
    order.propagation = entity.category === 'Financial'
      ? { status: 'pending', due: day + CONFIG.propagationCheckDays }
      : { status: 'n/a' };
  } else {
    const original = pkg.orders.find((o) => o.id === order.revertsOrderId);
    if (original && original.state === S.CONFIRMED) transition(pkg, original, S.REVERTED, day, `Old address restored by ${order.id}`);
  }
  audit(pkg, day, order.channel === 'guided' ? 'user' : 'system', `${order.kind === 'revert' ? 'Revert' : 'Change'} confirmed`, `${order.id} via ${order.channel}`);
  if (order.kind === 'change' && pkg.dispute?.status === 'upheld') addRevert(pkg, order, day);
}

function startAttempt(pkg, order, day) {
  order.attempts += 1;
  order.submissions += 1;
  order.startedDay = day;
  order.idempotencyKey = `${order.id}:${order.channel}:${order.submissions}`;
  transition(pkg, order, S.IN_PROGRESS, day, `Submitted via ${CHANNELS[order.channel].label} (attempt ${order.attempts}, key ${order.idempotencyKey})`);
}

function resolveAttempt(pkg, order, day) {
  const entity = entityById(order.entityId);
  const sim = entity.sim || base.sim;
  const r = rand(`${pkg.id}|${order.id}|${order.idempotencyKey}`);
  if (r < sim.challenge && order.kind === 'change') {
    order.entityApplications += 1; // entity has it pending its own check
    order.task = { kind: 'challenge', text: `${entity.name} needs to verify you directly (for example, a call to your phone on file). Complete it, then mark it done.` };
    order.waitingSince = day;
    transition(pkg, order, S.AWAITING_USER, day, 'Entity-side verification challenge (FR-EXE-007)');
  } else if (r < sim.challenge + sim.timeout) {
    // Did the entity actually apply it? Unknown to us until reconciliation.
    const applied = rand(`${pkg.id}|${order.idempotencyKey}|applied`) < 0.5;
    order.hiddenApplied = applied;
    if (applied) order.entityApplications += 1;
    order.unknownSince = day;
    transition(pkg, order, S.OUTCOME_UNKNOWN, day, 'Timeout — result unknown; reconcile before any retry (FR-EXE-009)');
  } else if (r < sim.challenge + sim.timeout + sim.error) {
    const backoff = 2 ** (order.attempts - 1);
    order.nextDay = order.attempts < CONFIG.maxAttemptsPerChannel ? day + backoff : day;
    transition(pkg, order, S.SCHEDULED, day, order.attempts < CONFIG.maxAttemptsPerChannel
      ? `Rejected by entity; retry in ${backoff} day(s)` : 'Rejected by entity; retry limit reached');
  } else {
    order.entityApplications += 1;
    confirm(pkg, order, day, { ref: `${order.channel.toUpperCase()}-${ref(order.idempotencyKey)}`, source: CHANNELS[order.channel].label }, 'Entity confirmed the change');
  }
}

export function tick(pkg, day, kill = {}) {
  if (pkg.status !== 'active') {
    maybeDelete(pkg, day);
    return pkg;
  }
  const live = () => pkg.orders.filter((o) => !TERMINAL.has(o.state));
  const disputeOpen = pkg.dispute?.status === 'open';

  // 1. Hold release.
  for (const o of live()) {
    if (!disputeOpen && o.state === S.ON_HOLD && day >= o.holdUntil) {
      o.nextDay = Math.max(day, pkg.effectiveDay);
      transition(pkg, o, S.SCHEDULED, day, 'Hold period ended');
    }
  }
  // 2. Reconcile unknown outcomes (read the entity's record; never blind-retry).
  for (const o of live()) {
    if (o.state === S.OUTCOME_UNKNOWN && day > o.unknownSince) {
      if (o.hiddenApplied) {
        confirm(pkg, o, day, { ref: `RECON-${ref(o.idempotencyKey)}`, source: 'Reconciliation: change found on entity record' }, 'Reconciled: entity had applied it');
      } else {
        o.nextDay = day;
        transition(pkg, o, S.SCHEDULED, day, 'Reconciled: not applied — safe to resubmit');
      }
    }
  }
  // 3. Resolve in-flight submissions after the entity's SLA.
  for (const o of live()) {
    if (o.state === S.IN_PROGRESS && day >= o.startedDay + Math.max(1, Math.min(3, entityById(o.entityId).slaDays))) {
      resolveAttempt(pkg, o, day);
    }
  }
  // In-flight orders that land back in a waiting state during a dispute are
  // locked (open) or cancelled (upheld) — never resubmitted.
  enforceDispute(pkg, day);

  // 4. Release scheduled orders (kill switches and retry limits force fallback).
  for (const o of live()) {
    if (o.state !== S.SCHEDULED || day < o.nextDay) continue;
    if (killed(kill, o.entityId, o.channel)) fallback(pkg, o, day, kill, `${CHANNELS[o.channel].label} disabled by kill switch`);
    else if (o.attempts >= CONFIG.maxAttemptsPerChannel) fallback(pkg, o, day, kill, `${CONFIG.maxAttemptsPerChannel} attempts failed on ${CHANNELS[o.channel].label}`);
    if (o.state === S.SCHEDULED && day >= o.nextDay) startAttempt(pkg, o, day);
  }
  // 5. Expiry of unanswered user actions / consents.
  for (const o of live()) {
    if ((o.state === S.AWAITING_USER || o.state === S.AWAITING_CONSENT) && day - o.waitingSince >= CONFIG.userActionTimeoutDays) {
      transition(pkg, o, S.EXPIRED, day, `No response in ${CONFIG.userActionTimeoutDays} days`);
    }
  }
  // 6. Propagation checks (aggregator re-query) — FR-STA-005.
  for (const o of pkg.orders) {
    if (o.state === S.CONFIRMED && o.propagation?.status === 'pending' && day >= o.propagation.due) {
      const bad = rand(`${pkg.id}|${o.id}|propagation`) < 0.1;
      o.propagation = { status: bad ? 'discrepancy' : 'verified', day };
      audit(pkg, day, 'system', 'Propagation check', `${o.id}: ${o.propagation.status}`);
    }
  }
  maybeClose(pkg, day);
  return pkg;
}

function enforceDispute(pkg, day) {
  const status = pkg.dispute?.status;
  if (status !== 'open' && status !== 'upheld') return;
  for (const o of pkg.orders) {
    if (!LOCKABLE.has(o.state)) continue;
    if (status === 'open') {
      o.prevState = o.state;
      transition(pkg, o, S.LOCKED, day, 'Dispute open');
    } else if (o.kind === 'change') {
      o.task = null;
      transition(pkg, o, S.CANCELLED, day, 'Dispute upheld');
    }
  }
}

function maybeClose(pkg, day) {
  if (pkg.status !== 'active' || day < pkg.disputeUntil || pkg.dispute?.status === 'open') return;
  if (!pkg.orders.every((o) => TERMINAL.has(o.state))) return;
  if (pkg.orders.some((o) => o.propagation && ['pending', 'discrepancy'].includes(o.propagation.status))) return;
  pkg.status = 'closed';
  pkg.closedDay = day;
  pkg.deleteOnDay = day + pkg.retentionDays;
  pkg.receipt = { packageId: pkg.id, accessCode: ref(pkg.id + 'receipt') };
  audit(pkg, day, 'system', 'Package Closure', `retention ${pkg.retentionDays} days; closure receipt issued`);
  maybeDelete(pkg, day);
}

function maybeDelete(pkg, day) {
  if (pkg.status === 'closed' && day >= pkg.deleteOnDay) shred(pkg, day, 'Retention window ended');
}

// NFR-SEC-006 / FR-PRV-007: destroy the package key, confirm subprocessor deletion.
function shred(pkg, day, why) {
  pkg.pii = null;
  for (const o of pkg.orders) {
    if (o.artifact) o.artifact = { day: o.artifact.day, ref: '[shredded]', source: o.artifact.source };
    o.task = null;
  }
  pkg.notices = pkg.notices.map((n) => ({ ...n, body: '' }));
  pkg.status = 'deleted';
  pkg.deletedDay = day;
  pkg.receipt = pkg.receipt || { packageId: pkg.id, accessCode: ref(pkg.id + 'receipt') };
  pkg.subprocessorDeletion = ['IDV vendor', 'Print/mail vendor', 'Notification service', 'Bank aggregator'].map((v) => ({ vendor: v, confirmed: day }));
  audit(pkg, day, 'system', 'Package key destroyed (crypto-shred)', `${why}; 4 subprocessors confirmed deletion`);
}

// ---------- user and agent actions ----------

const find = (pkg, id) => {
  const o = pkg.orders.find((x) => x.id === id);
  if (!o) throw new Error(`No order ${id}`);
  return o;
};

const assertMutable = (pkg) => {
  if (pkg.status !== 'active' && pkg.status !== 'draft') throw new Error(`Package is ${pkg.status}`);
  if (pkg.dispute?.status === 'open') throw new Error('Package is locked while a dispute is investigated (FR-FRD-004)');
};

export function completeUserAction(pkg, orderId, day, confirmationRef) {
  assertMutable(pkg);
  const o = find(pkg, orderId);
  if (o.state !== S.AWAITING_USER) throw new Error('Nothing to complete');
  if (o.task?.kind === 'guided' && !String(confirmationRef || '').trim()) throw new Error('Enter the confirmation number you received');
  if (o.task?.kind === 'guided') o.entityApplications += 1;
  confirm(pkg, o, day, { ref: String(confirmationRef || `CHAL-${ref(o.id + day)}`).trim(), source: o.task?.kind === 'guided' ? 'Entered by you' : 'Entity challenge completed' },
    o.task?.kind === 'guided' ? 'You recorded the confirmation' : 'You completed the entity challenge');
}

export function grantConsent(pkg, orderId, day) {
  assertMutable(pkg);
  const o = find(pkg, orderId);
  if (o.state !== S.AWAITING_CONSENT) throw new Error('No consent pending');
  o.channel = o.pendingChannel;
  o.consentedRank = CHANNELS[o.channel].rank;
  o.pendingChannel = null;
  o.attempts = 0;
  o.nextDay = day;
  audit(pkg, day, 'user', 'Re-consent granted', `${o.id}: ${CHANNELS[o.channel].label} (${CHANNELS[o.channel].audience})`);
  transition(pkg, o, S.SCHEDULED, day, 'You approved the wider audience');
}

export function chooseGuided(pkg, orderId, day) {
  assertMutable(pkg);
  const o = find(pkg, orderId);
  if (o.state !== S.AWAITING_CONSENT) throw new Error('No consent pending');
  const entity = entityById(o.entityId);
  o.channel = 'guided';
  o.pendingChannel = null;
  o.task = { kind: 'guided', text: entity.guide || `Contact ${entity.name} yourself using the pre-filled letter, then record the confirmation.` };
  o.waitingSince = day;
  audit(pkg, day, 'user', 'Re-consent declined', `${o.id}: switched to user-guided`);
  transition(pkg, o, S.AWAITING_USER, day, 'You chose to do it yourself');
}

export function cancelOrder(pkg, orderId, day) {
  assertMutable(pkg);
  const o = find(pkg, orderId);
  if (!CANCELLABLE.has(o.state)) throw new Error(`Can't cancel an order that is ${o.state}`);
  o.task = null;
  transition(pkg, o, S.CANCELLED, day, 'Cancelled by you');
  audit(pkg, day, 'user', 'Order cancelled', o.id);
}

export function resolveDiscrepancy(pkg, orderId, day) {
  const o = find(pkg, orderId);
  if (o.propagation?.status !== 'discrepancy') throw new Error('No discrepancy');
  o.propagation = { status: 'verified', day, note: 'Resolved by you' };
  audit(pkg, day, 'user', 'Propagation discrepancy resolved', o.id);
}

// FR-FRD-004 — dispute locks the package.
export function openDispute(pkg, day, actor = 'old-address recipient') {
  if (pkg.status !== 'active') throw new Error('Only active packages can be disputed');
  if (day > pkg.disputeUntil) throw new Error('Dispute window has closed');
  if (pkg.dispute?.status === 'open' || pkg.dispute?.status === 'upheld') throw new Error('Dispute already raised');
  pkg.dispute = { status: 'open', openedDay: day, actor };
  for (const o of pkg.orders) {
    if (LOCKABLE.has(o.state)) {
      o.prevState = o.state;
      transition(pkg, o, S.LOCKED, day, 'Dispute opened');
    }
  }
  audit(pkg, day, actor, 'Dispute opened', 'package locked');
}

// FR-FRD-007 — upheld: cancel locked orders and revert confirmed ones; rejected: unlock.
export function resolveDispute(pkg, day, upheld) {
  if (pkg.dispute?.status !== 'open') throw new Error('No open dispute');
  pkg.dispute = { ...pkg.dispute, status: upheld ? 'upheld' : 'rejected', resolvedDay: day };
  audit(pkg, day, 'support agent', `Dispute ${upheld ? 'upheld' : 'rejected'}`);
  for (const o of pkg.orders.filter((x) => x.state === S.LOCKED)) {
    if (upheld) {
      o.task = null;
      transition(pkg, o, S.CANCELLED, day, 'Dispute upheld');
    } else {
      const back = o.prevState;
      transition(pkg, o, back, day, 'Dispute rejected — unlocked');
      if (back === S.SCHEDULED) o.nextDay = Math.max(o.nextDay ?? day, day);
      if (back === S.AWAITING_USER || back === S.AWAITING_CONSENT) o.waitingSince = day;
    }
    o.prevState = null;
  }
  if (upheld) {
    for (const o of pkg.orders.filter((x) => x.kind === 'change' && x.state === S.CONFIRMED)) addRevert(pkg, o, day);
  }
}

function addRevert(pkg, original, day) {
  if (pkg.orders.some((o) => o.revertsOrderId === original.id)) return;
  const n = pkg.orders.filter((o) => o.kind === 'revert').length;
  const r = newOrder(pkg, original.entityId, 'revert', n, original.id);
  const entity = entityById(original.entityId);
  r.channel = entity.channels.includes(original.channel) ? original.channel : entity.channels[0];
  r.consentedRank = CHANNELS[r.channel].rank;
  pkg.orders.push(r);
  transition(pkg, r, S.AUTHORIZED, day, `Dispute upheld — restore old address at ${entity.name}`);
  release(pkg, r, day, { hold: false }); // Revert Orders skip the hold
  audit(pkg, day, 'system', 'Revert Order created', `${r.id} for ${original.id}`);
}

// FR-PRV-003 — immediate erasure.
export function eraseNow(pkg, day) {
  if (pkg.status === 'deleted') throw new Error('Already deleted');
  for (const o of pkg.orders) {
    if (TERMINAL.has(o.state)) continue;
    if (o.state === S.IN_PROGRESS || o.state === S.OUTCOME_UNKNOWN) transition(pkg, o, S.FAILED, day, 'Erased by you while in flight');
    else transition(pkg, o, S.CANCELLED, day, 'Erased by you');
  }
  audit(pkg, day, 'user', 'Right to erasure exercised', pkg.dispute?.status === 'open' ? 'during open dispute' : '');
  shred(pkg, day, 'User erasure request');
}

export const disputeWindowOpen = (pkg, day) => pkg.status === 'active' && day <= pkg.disputeUntil;

// ---------- reporting ----------

export function summary(pkg) {
  const changes = pkg.orders.filter((o) => o.kind === 'change');
  const counted = changes.filter((o) => o.state !== S.CANCELLED);
  const confirmed = counted.filter((o) => o.state === S.CONFIRMED || o.state === S.REVERTED).length;
  const byState = {};
  for (const o of pkg.orders) byState[o.state] = (byState[o.state] || 0) + 1;
  const needsYou = pkg.orders.filter((o) => o.state === S.AWAITING_USER || o.state === S.AWAITING_CONSENT || o.propagation?.status === 'discrepancy').length;
  return {
    total: counted.length,
    confirmed,
    completion: counted.length ? Math.round((100 * confirmed) / counted.length) : 0,
    byState,
    needsYou,
  };
}

// Estimated completion day per order (FR-STA-003).
export function estimateDay(pkg, order, day) {
  if (TERMINAL.has(order.state)) return null;
  const entity = entityById(order.entityId);
  const start = Math.max(day, order.state === S.ON_HOLD ? order.holdUntil : (order.nextDay ?? day), pkg.effectiveDay);
  return start + entity.slaDays;
}

export function exportPackage(pkg) {
  const { audit: log, ...rest } = pkg;
  return JSON.stringify({ exportedFormat: 'relosafe-prototype-v0.2', ...rest, audit: log, auditChainValid: verifyAudit(pkg) }, (k, v) => (k === 'hiddenApplied' || k === 'entityApplications' ? undefined : v), 2);
}
