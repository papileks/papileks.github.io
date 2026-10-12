// ReloSafe prototype UI. All logic that the SRD constrains lives in engine.js.
import {
  CONFIG, S, CHANNELS, FIELDS, TERMINAL, CATALOG, entityById, isHighRisk, isDelegated, validateAddress, formatAddress,
  eligibility, groupedCatalog, createPackage, authorize, tick, completeUserAction, grantConsent, chooseGuided,
  cancelOrder, resolveDiscrepancy, openDispute, resolveDispute, eraseNow, summary, estimateDay, exportPackage,
  verifyAudit, holdUntil, disputeWindowOpen,
} from './engine.js';

const KEY = 'relosafe-prototype-v2';
const STEPS = [['verify', 'Verify identity'], ['address', 'Addresses'], ['entities', 'Choose entities'], ['review', 'Review & authorize'], ['status', 'My Status']];

const todayISO = () => new Date().toISOString().slice(0, 10);

function freshState() {
  return {
    v: 2,
    baseDate: todayISO(),
    day: 0,
    step: 'verify',
    kill: {},
    pkg: null,
    draft: {
      name: 'Alex Rivera',
      idv: false,
      signals: { newDevice: false, oldAddressSignal: 'match', recentMoves: 1 },
      protectedMover: false,
      pmEvidence: 'acp',
      old: { line1: '12 Oak Street', line2: '', city: 'Springfield', state: 'IL', zip: '62701' },
      neu: { line1: '400 Lake Avenue', line2: 'Apartment 7B', city: 'Madison', state: 'WI', zip: '53703' },
      validated: null,
      readback: { street: false, unit: false, city: false },
      effectiveDate: todayISO(),
      addressType: 'both',
      proof: 'lease',
      immigration: false,
      selected: CATALOG.filter((e) => e.recommended).map((e) => e.id),
      retention: CONFIG.retentionDefault,
      stepUpDone: false,
      mfa: '',
      consent: false,
    },
  };
}

let state = load();

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.v === 2) return s;
  } catch { /* private mode or corrupt — start fresh */ }
  return freshState();
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
}

// ---------- helpers ----------

const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel) => document.querySelector(sel);
const DAY_MS = 86400000;
const dateOf = (day) => new Date(Date.parse(state.baseDate + 'T12:00:00Z') + day * DAY_MS);
const fmt = (day) => (day == null ? '—' : dateOf(day).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }));
const dayOfISO = (iso) => Math.round((Date.parse(iso + 'T12:00:00Z') - Date.parse(state.baseDate + 'T12:00:00Z')) / DAY_MS);
const announce = (msg) => { $('#live').textContent = msg; };
let flash = null; // { kind, text } shown once at top of the view
// In-page confirmation (embedded viewers block window.confirm): { action, text, yes }
let pending = null;
let showExport = false;

const STATE_BADGE = {
  [S.CONFIRMED]: 'b-ok', [S.REVERTED]: 'b-info', [S.AWAITING_USER]: 'b-warn', [S.AWAITING_CONSENT]: 'b-warn',
  [S.OUTCOME_UNKNOWN]: 'b-warn', [S.FAILED]: 'b-bad', [S.EXPIRED]: 'b-bad', [S.LOCKED]: 'b-bad', [S.ON_HOLD]: 'b-info',
  [S.IN_PROGRESS]: 'b-info', [S.SCHEDULED]: '', [S.CANCELLED]: '',
};
const badge = (text, cls = '') => `<span class="badge ${cls}">${h(text)}</span>`;

function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((o, k) => o[k], obj)[last] = value;
}

function destinationOf(v) {
  if (!v) return 'residential';
  return v.flags.cmra ? 'cmra' : v.flags.pobox ? 'pobox' : 'residential';
}

// ---------- rendering ----------

function render({ focus = false } = {}) {
  const idx = STEPS.findIndex(([k]) => k === state.step);
  $('#steps').innerHTML = STEPS.map(([k, label], i) =>
    `<li class="${i < idx ? 'done' : ''}" ${i === idx ? 'aria-current="step"' : ''}>${h(label)}</li>`).join('');
  const views = { verify: viewVerify, address: viewAddress, entities: viewEntities, review: viewReview, status: viewStatus };
  const f = flash ? `<div class="callout ${flash.kind}" role="status"><p>${h(flash.text)}</p></div>` : '';
  flash = null;
  const c = pending ? `<div class="callout bad" role="alertdialog" aria-labelledby="confirm-text">
    <p id="confirm-text">${h(pending.text)}</p>
    <div class="row"><button type="button" class="danger" data-action="confirm-yes">${h(pending.yes)}</button>
    <button type="button" data-action="confirm-no">Keep going</button></div></div>` : '';
  $('#view').innerHTML = c + f + views[state.step]();
  save();
  if (focus) {
    const h1 = $('#view h1');
    if (h1) { h1.setAttribute('tabindex', '-1'); h1.focus(); }
  }
}

function go(step) {
  state.step = step;
  render({ focus: true });
  window.scrollTo(0, 0);
}

function viewVerify() {
  const d = state.draft;
  return `
  <h1>Verify your identity</h1>
  <p class="muted">You verify once (FR-IDV-001). This prototype simulates the document + liveness check and the fraud signals a real system would collect.</p>
  <div class="grid2">
    <section class="card">
      <h2>Identity check</h2>
      <div class="field"><label for="name">Full legal name</label>
        <input id="name" type="text" autocomplete="off" data-bind="draft.name" value="${h(d.name)}"></div>
      ${d.idv
        ? `<div class="callout ok"><p><strong>Identity verified</strong> — simulated government ID + selfie liveness match (IAL2-equivalent).</p></div>`
        : `<button type="button" class="primary" data-action="idv">Run identity check (simulated)</button>`}
      <div class="field" style="margin-top:14px"><label for="oas">Old-address evidence found (FR-IDV-002)</label>
        <select id="oas" data-bind="draft.signals.oldAddressSignal" data-rerender>
          ${opt('match', 'Independent record matches (credit header, utility, bank)', d.signals.oldAddressSignal)}
          ${opt('partial', 'Partial match only', d.signals.oldAddressSignal)}
          ${opt('none', 'No independent signal', d.signals.oldAddressSignal)}
        </select>
        <small>NCOA data is never used for this check (NFR-CMP-003).</small></div>
    </section>
    <section class="card">
      <h2>Simulated fraud signals</h2>
      <p class="muted">Use these to see how the risk score (FR-FRD-001) changes the flow. The score uses no demographic or ZIP-code features.</p>
      <label class="check"><input type="checkbox" data-bind="draft.signals.newDevice" data-rerender ${d.signals.newDevice ? 'checked' : ''}> Signing in from an unrecognized device</label>
      <div class="field" style="margin-top:10px"><label for="moves">Moves in the last 12 months</label>
        <input id="moves" type="number" min="0" max="6" data-bind="draft.signals.recentMoves" data-num data-rerender value="${h(d.signals.recentMoves)}"></div>
      <h2 style="margin-top:16px">Safety</h2>
      <label class="check"><input type="checkbox" data-bind="draft.protectedMover" data-rerender ${d.protectedMover ? 'checked' : ''}>
        I need my new address kept from someone at my old address</label>
      ${d.protectedMover ? `
        <div class="field" style="margin-top:10px"><label for="pme">Supporting evidence (FR-FRD-008)</label>
          <select id="pme" data-bind="draft.pmEvidence">
            ${opt('acp', 'Address Confidentiality Program card', d.pmEvidence)}
            ${opt('advocate', 'Letter from an advocate', d.pmEvidence)}
            ${opt('order', 'Protective order', d.pmEvidence)}
          </select></div>
        <div class="callout"><p>No letter will go to your old address; notices go only to your verified email and phone. A trained agent reviews this request (auto-approved in the prototype). The hold period still protects you.</p></div>` : ''}
    </section>
  </div>
  <div class="actions"><span></span><button type="button" class="primary" data-go="address" ${d.idv ? '' : 'disabled'}>Continue</button></div>`;
}

const opt = (v, label, cur) => `<option value="${h(v)}" ${v === cur ? 'selected' : ''}>${h(label)}</option>`;

function addrFields(prefix, a, title) {
  const b = (k) => `data-bind="draft.${prefix}.${k}" data-invalidate`;
  return `<fieldset><legend>${h(title)}</legend>
    <div class="addr">
      <div class="full"><label for="${prefix}-l1">Street</label><input id="${prefix}-l1" type="text" ${b('line1')} value="${h(a.line1)}"></div>
      <div class="full"><label for="${prefix}-l2">Apt / unit <small>(optional)</small></label><input id="${prefix}-l2" type="text" ${b('line2')} value="${h(a.line2)}"></div>
      <div><label for="${prefix}-c">City</label><input id="${prefix}-c" type="text" ${b('city')} value="${h(a.city)}"></div>
      <div><label for="${prefix}-s">State</label><input id="${prefix}-s" type="text" maxlength="2" ${b('state')} value="${h(a.state)}"></div>
      <div class="zip"><label for="${prefix}-z">ZIP</label><input id="${prefix}-z" type="text" inputmode="numeric" ${b('zip')} value="${h(a.zip)}"></div>
    </div></fieldset>`;
}

function viewAddress() {
  const d = state.draft;
  const v = d.validated;
  const rb = d.readback;
  let result = '';
  if (v) {
    const errs = [...v.old.errors.map((e) => `Old address: ${e}`), ...v.neu.errors.map((e) => `New address: ${e}`)];
    if (errs.length) {
      result = `<div class="callout bad" role="alert"><ul>${errs.map((e) => `<li>${h(e)}</li>`).join('')}</ul></div>`;
    } else {
      const n = v.neu.standardized;
      const dest = destinationOf(v.neu);
      result = `
      <section class="card">
        <h2>Confirm your new address, line by line (FR-MOV-008)</h2>
        <p class="muted">Validation can confirm that mail can be delivered here, but not that this is the right address. Check each line.</p>
        <label class="check"><input type="checkbox" data-bind="readback.street" ${rb.street ? 'checked' : ''} data-rerender> <span class="mono">${h(n.line1)}</span></label>
        <label class="check"><input type="checkbox" data-bind="readback.unit" ${rb.unit ? 'checked' : ''} data-rerender> <span class="mono">${h(n.line2 || '(no apartment or unit)')}</span></label>
        <label class="check"><input type="checkbox" data-bind="readback.city" ${rb.city ? 'checked' : ''} data-rerender> <span class="mono">${h(`${n.city}, ${n.state} ${n.zip}`)}</span></label>
        ${dest !== 'residential' ? `<div class="callout warn"><p>${dest === 'cmra' ? 'This looks like a mail-receiving agency (PMB).' : 'This is a PO Box.'} The move goes to a quick manual review (FR-FRD-003). Entities that need a residential address, such as the DMV and voter registration, can't receive it (FR-MOV-006).</p></div>` : ''}
      </section>`;
    }
  }
  const allRead = v && v.old.ok && v.neu.ok && rb.street && rb.unit && rb.city;
  return `
  <h1>Your addresses</h1>
  <div class="grid2">
    <div>${addrFields('old', d.old, 'Old address')}</div>
    <div>${addrFields('neu', d.neu, 'New address')}</div>
  </div>
  <div class="grid2">
    <div class="field"><label for="eff">Effective date (past, today or future)</label>
      <input id="eff" type="date" data-bind="draft.effectiveDate" value="${h(d.effectiveDate)}"></div>
    <div class="field"><label for="atype">Which address is changing?</label>
      <select id="atype" data-bind="draft.addressType">
        ${opt('both', 'Both mailing and residential', d.addressType)}
        ${opt('mailing', 'Mailing address only', d.addressType)}
        ${opt('residential', 'Residential address only', d.addressType)}
      </select></div>
    <div class="field"><label for="proof">Proof you control the new address (FR-IDV-004)</label>
      <select id="proof" data-bind="draft.proof">
        ${opt('lease', 'Signed lease (upload simulated)', d.proof)}
        ${opt('closing', 'Closing disclosure or deed', d.proof)}
        ${opt('employer', 'Employer relocation letter', d.proof)}
        ${opt('utility', 'Utility activation record', d.proof)}
        ${opt('none', 'None yet', d.proof)}
      </select>
      <small>Needed before financial, government, insurance or payroll changes.</small></div>
  </div>
  <button type="button" data-action="validate">Validate addresses</button>
  <div style="margin-top:14px">${result}</div>
  <div class="actions"><button type="button" data-go="verify">Back</button>
    <button type="button" class="primary" data-go="entities" ${allRead ? '' : 'disabled'}>Continue</button></div>`;
}

function viewEntities() {
  const d = state.draft;
  const flags = d.validated?.neu.flags || {};
  const groups = groupedCatalog({ immigrationFilings: d.immigration });
  const eff = dayOfISO(d.effectiveDate);
  return `
  <h1>Who should we notify?</h1>
  <p class="muted">Grouped by category and sorted by deadline, then risk, then speed (FR-CAT-004). Government agencies use the guided channel: we pre-fill everything and you submit it yourself (FR-CAT-007).</p>
  <div class="card row spread">
    <label class="check" style="margin:0"><input type="checkbox" data-bind="draft.immigration" data-rerender ${d.immigration ? 'checked' : ''}> I have federal immigration filings <small>(adds USCIS AR-11; we don't ask or store your status)</small></label>
    <div class="row"><button type="button" class="small" data-action="sel-rec">Select recommended</button><button type="button" class="small" data-action="sel-none">Clear</button></div>
  </div>
  ${groups.map((g) => `
    <fieldset class="card"><legend>${h(g.category)}</legend>
      ${g.entities.map((e) => {
        const el = eligibility(e, flags);
        const checked = d.selected.includes(e.id) && el.ok;
        const deadline = e.deadlineDays ? badge(`Deadline ~${fmt(eff + e.deadlineDays)}`, 'b-bad') : e.deadlineNote ? badge(e.deadlineNote, 'b-warn') : '';
        return `<div class="ent ${el.ok ? '' : 'disabled'}">
          <input type="checkbox" id="e-${e.id}" data-entity="${e.id}" ${checked ? 'checked' : ''} ${el.ok ? '' : 'disabled'}>
          <label for="e-${e.id}">${h(e.name)}</label>
          <div class="meta">
            ${isHighRisk(e) ? badge('High-risk', 'b-info') : ''}
            ${badge(CHANNELS[e.channels[0]].label)}
            ${badge(`~${e.slaDays} day${e.slaDays > 1 ? 's' : ''}`)}
            ${deadline}
            ${el.ok ? '' : `<small class="err">${h(el.reason)}</small>`}
          </div></div>`;
      }).join('')}
    </fieldset>`).join('')}
  <div class="actions"><button type="button" data-go="address">Back</button>
    <span class="row"><span class="muted">${d.selected.length} selected</span>
    <button type="button" class="primary" data-go="review" ${d.selected.length ? '' : 'disabled'}>Review</button></span></div>`;
}

function draftPackage() {
  const d = state.draft;
  const v = d.validated;
  const flags = v.neu.flags;
  const ids = d.selected.filter((id) => eligibility(entityById(id), flags).ok && (!entityById(id).immigrationOnly || d.immigration));
  const pkg = createPackage({
    day: state.day,
    pii: { name: d.name, oldAddress: v.old.standardized, newAddress: v.neu.standardized },
    effectiveDay: Math.max(dayOfISO(d.effectiveDate), state.day),
    addressType: d.addressType,
    entityIds: ids,
    signals: { ...d.signals, recentMoves: Number(d.signals.recentMoves) || 0 },
    destination: destinationOf(v.neu),
    protectedMover: d.protectedMover,
    proofOfControl: d.proof,
    retentionDays: Number(d.retention),
  });
  for (const o of pkg.orders) {
    const e = entityById(o.entityId);
    o.channel = e.channels.find((c) => !(isDelegated(c) && state.kill[`${e.id}:${c}`])) || 'guided';
  }
  return pkg;
}

function viewReview() {
  const d = state.draft;
  const pkg = draftPackage();
  const r = pkg.risk;
  const day = state.day;
  const hold = holdUntil(pkg, day);
  const mfaOk = /^\d{6}$/.test(d.mfa);
  const blockers = [];
  const anyHRDelegated = pkg.orders.some((o) => isHighRisk(entityById(o.entityId)) && isDelegated(o.channel));
  if (anyHRDelegated && d.proof === 'none') blockers.push('Add proof that you control the new address (Addresses step), or remove the high-risk entities.');
  if (r.stepUp && !d.stepUpDone) blockers.push('Complete the extra identity check below.');
  if (!mfaOk) blockers.push('Enter the 6-digit code from your authenticator (any 6 digits in the prototype).');
  if (!d.consent) blockers.push('Tick the authorization box.');

  const rows = pkg.orders.map((o) => {
    const e = entityById(o.entityId);
    const ch = CHANNELS[o.channel];
    const held = isHighRisk(e) && isDelegated(o.channel);
    const start = o.channel === 'guided' ? day : Math.max(pkg.effectiveDay, held ? hold : day);
    return `<tr>
      <td><strong>${h(e.name)}</strong>${held ? `<br>${badge('Held until ' + fmt(hold), 'b-info')}` : ''}</td>
      <td>${e.fields.map((f) => h(FIELDS[f])).join(', ')}</td>
      <td>${h(ch.label)}<br><small>Sees your data: ${h(ch.audience)}</small></td>
      <td>${o.channel === 'guided' ? 'You, any time' : fmt(start)}<br><small>est. done ${fmt(start + e.slaDays)}</small></td>
    </tr>`;
  }).join('');

  return `
  <h1>Review and authorize</h1>
  <p class="muted">This is the one authorization step (FR-MOV-003). Nothing runs until you authorize, and each item below is exactly what will happen.</p>
  <div class="tiles">
    <div class="tile"><div class="k">Entities</div><div class="v">${pkg.orders.length}</div></div>
    <div class="tile"><div class="k">Effective date</div><div class="v">${fmt(pkg.effectiveDay)}</div></div>
    <div class="tile"><div class="k">High-risk hold ends</div><div class="v">${fmt(hold)}</div><div class="s">${r.stepUp ? CONFIG.holdDaysStepUp : CONFIG.holdDays} days — the old-address notice arrives first</div></div>
    <div class="tile"><div class="k">Dispute window ends</div><div class="v">${fmt(day + CONFIG.disputeWindowDays)}</div></div>
  </div>

  <section class="card">
    <div class="row spread"><h2 style="margin:0">Risk check</h2>${badge(`${r.score} / 100`, r.stepUp ? 'b-bad' : r.score ? 'b-warn' : 'b-ok')}</div>
    ${r.factors.length ? `<ul>${r.factors.map(([f, w]) => `<li>${h(f)} <small>(+${w})</small></li>`).join('')}</ul>` : '<p class="muted" style="margin-top:8px">No risk factors.</p>'}
    ${r.manualReview ? '<div class="callout warn"><p>The destination needs manual review (FR-FRD-003). This is approved automatically in the prototype.</p></div>' : ''}
    ${r.stepUp ? `<div class="callout bad"><p>Your score is above the step-up threshold (${CONFIG.stepUpThreshold}). Complete an extra identity check; the hold will be ${CONFIG.holdDaysStepUp} days.</p>
      <label class="check"><input type="checkbox" data-bind="draft.stepUpDone" data-rerender ${d.stepUpDone ? 'checked' : ''}> I re-scanned my ID and completed the liveness check (simulated)</label></div>` : ''}
  </section>

  <section class="card">
    <h2>What goes where (FR-PRV-001)</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>Entity</th><th>Data shared</th><th>Channel</th><th>Starts</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <p class="muted" style="margin-top:8px">If a channel fails and the next one would show your data to more people (for example, an agent), we stop and ask you first (FR-MOV-007).</p>
  </section>

  <div class="grid2">
    <section class="card">
      <h2>Notice to your old address</h2>
      ${d.protectedMover
        ? '<div class="callout ok"><p>No letter goes to your old address (protected mover). Notices go only to your verified email and phone.</p></div>'
        : `<p class="muted">Mailed today to the old address and sent to your verified contacts (FR-FRD-002). It never includes your new address.</p>
           <div class="notice">A request to change your address was authorized with ReloSafe. If you did not request this, report it within ${CONFIG.disputeWindowDays} days at relosafe.example/dispute with code ${h(pkg.id)}.</div>`}
    </section>
    <section class="card">
      <h2>How long we keep your data</h2>
      <label for="ret">Delete my personal data <strong>${h(d.retention)} days</strong> after the move closes</label>
      <input id="ret" type="range" min="0" max="${CONFIG.retentionMax}" step="1" data-bind="draft.retention" data-num data-rerender value="${h(d.retention)}">
      <p class="muted">The move closes once every change is final, the dispute window has ended and the checks are done (FR-PRV-002). After that, only an audit record with no personal data is kept, which you can view with your closure receipt.</p>
    </section>
  </div>

  <section class="card">
    <h2>Authorize</h2>
    <p class="muted">Service fee: shown here before you authorize (FR-PAY-001). Not simulated in this prototype.</p>
    <div class="field" style="max-width:240px"><label for="mfa">Authenticator code (step-up MFA)</label>
      <input id="mfa" type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code" data-bind="draft.mfa" data-rerender value="${h(d.mfa)}"></div>
    <label class="check"><input type="checkbox" data-bind="draft.consent" data-rerender ${d.consent ? 'checked' : ''}>
      I authorize ReloSafe to update my address with the ${pkg.orders.length} entities above, share only the listed data, and generate Letters of Authorization where required.</label>
    ${blockers.length ? `<ul class="muted">${blockers.map((b) => `<li>${h(b)}</li>`).join('')}</ul>` : ''}
  </section>
  <div class="actions"><button type="button" data-go="entities">Back</button>
    <button type="button" class="primary" data-action="authorize" ${blockers.length ? 'disabled' : ''}>Authorize move</button></div>`;
}

function orderCard(pkg, o) {
  const e = entityById(o.entityId);
  const ch = CHANNELS[o.channel];
  const day = state.day;
  const attn = o.state === S.AWAITING_USER || o.state === S.AWAITING_CONSENT || o.propagation?.status === 'discrepancy';
  const facts = [`${ch.label}`, `audience: ${ch.audience}`];
  if (o.attempts) facts.push(`attempt ${o.attempts}/${CONFIG.maxAttemptsPerChannel}`);
  if (o.state === S.ON_HOLD) facts.push(`hold ends ${fmt(o.holdUntil)}`);
  if (o.state === S.SCHEDULED && o.nextDay > day) facts.push(`next try ${fmt(o.nextDay)}`);
  const est = estimateDay(pkg, o, day);
  if (est != null && o.state !== S.LOCKED) facts.push(`est. done ${fmt(est)}`);
  if (o.artifact) facts.push(`confirmation <span class="mono">${h(o.artifact.ref)}</span>`);
  if (o.propagation && o.propagation.status !== 'n/a') facts.push(`propagation: ${o.propagation.status}`);
  const mutable = pkg.status === 'active' && pkg.dispute?.status !== 'open';

  let task = '';
  if (mutable && o.state === S.AWAITING_USER && o.task?.kind === 'guided') {
    task = `<div class="task callout warn"><p>${h(o.task.text)}</p>
      <p><small>Pre-filled: ${e.fields.map((f) => h(FIELDS[f])).join(', ')}</small></p>
      <div class="row"><label class="sr-only" for="ref-${o.id}">Confirmation number for ${h(e.name)}</label>
      <input id="ref-${o.id}" type="text" placeholder="Confirmation number">
      <button type="button" class="small primary" data-action="complete" data-id="${o.id}">Record</button></div></div>`;
  } else if (mutable && o.state === S.AWAITING_USER) {
    task = `<div class="task callout warn"><p>${h(o.task?.text || 'Action needed.')}</p>
      <button type="button" class="small primary" data-action="complete" data-id="${o.id}">I've completed it</button></div>`;
  } else if (mutable && o.state === S.AWAITING_CONSENT) {
    const nc = CHANNELS[o.pendingChannel];
    task = `<div class="task callout warn"><p>The ${h(CHANNELS[o.channel].label)} channel isn't available. The next option is <strong>${h(nc.label)}</strong>, which shows your data to: <strong>${h(nc.audience)}</strong>. Approve that, or do it yourself.</p>
      <div class="row"><button type="button" class="small primary" data-action="consent" data-id="${o.id}">Approve ${h(nc.label)}</button>
      <button type="button" class="small" data-action="guided" data-id="${o.id}">I'll do it myself</button></div></div>`;
  }
  if (o.propagation?.status === 'discrepancy' && pkg.status === 'active') {
    task += `<div class="task callout warn"><p>${h(e.name)}'s records still show your old address ${CONFIG.propagationCheckDays} days after confirmation. Check with them, then mark this resolved.</p>
      <button type="button" class="small" data-action="discrepancy" data-id="${o.id}">Mark resolved</button></div>`;
  }
  const canCancel = mutable && [S.ON_HOLD, S.SCHEDULED, S.AWAITING_USER, S.AWAITING_CONSENT].includes(o.state) && o.kind === 'change';
  return `<article class="order ${attn ? 'attn' : ''}">
    <div class="order-head"><h3>${o.kind === 'revert' ? badge('Revert', 'b-bad') + ' ' : ''}${h(e.name)}</h3>${badge(o.state, STATE_BADGE[o.state])}</div>
    <div class="facts">${facts.map((f) => `<span>${f}</span>`).join('')}</div>
    ${task}
    <div class="row spread" style="margin-top:6px">
      <details><summary>History (${o.history.length})</summary><ul class="history">
        ${o.history.map((x) => `<li><span class="mono">${h(fmt(x.day))}</span> ${h(x.from)} → <strong>${h(x.to)}</strong> — ${h(x.reason)}</li>`).join('')}
      </ul></details>
      ${canCancel ? `<button type="button" class="small" data-action="cancel" data-id="${o.id}">Cancel</button>` : ''}
    </div>
  </article>`;
}

function viewStatus() {
  const pkg = state.pkg;
  const day = state.day;
  const s = summary(pkg);
  const statusText = { active: 'Active', closed: 'Closed', deleted: 'Deleted' }[pkg.status];
  const statusSub = pkg.status === 'closed' ? `personal data deleted ${fmt(pkg.deleteOnDay)}` : pkg.status === 'deleted' ? `crypto-shredded ${fmt(pkg.deletedDay)}` : `closes after ${fmt(pkg.disputeUntil)}`;
  const needs = pkg.orders.filter((o) => o.state === S.AWAITING_USER || o.state === S.AWAITING_CONSENT || o.propagation?.status === 'discrepancy');
  const rest = pkg.orders.filter((o) => !needs.includes(o));
  const order = (a, b) => Number(TERMINAL.has(a.state)) - Number(TERMINAL.has(b.state));
  const dispute = pkg.dispute;
  const entIds = [...new Set(pkg.orders.map((o) => o.entityId))];

  return `
  <h1>My Status</h1>
  <div class="tiles">
    <div class="tile"><div class="k">Simulated today</div><div class="v">${fmt(day)}</div><div class="s">day ${day} of the move</div></div>
    <div class="tile"><div class="k">Completion</div><div class="v">${s.completion}%</div><div class="s">${s.confirmed} of ${s.total} confirmed</div><div class="meter" aria-hidden="true"><span style="width:${s.completion}%"></span></div></div>
    <div class="tile"><div class="k">Needs you</div><div class="v">${s.needsYou}</div><div class="s">action items</div></div>
    <div class="tile"><div class="k">High-risk hold</div><div class="v">${day >= pkg.holdUntil ? 'Ended' : fmt(pkg.holdUntil)}</div></div>
    <div class="tile"><div class="k">Move package</div><div class="v">${h(statusText)}</div><div class="s">${h(statusSub)}</div></div>
  </div>

  <section class="card">
    <h2>Simulation clock</h2>
    <p class="muted">Advance time to watch the engine work: holds release, entities respond, timeouts are reconciled before any retry (FR-EXE-009), and failures fall back to the next channel.</p>
    <div class="sim">
      <button type="button" class="primary" data-action="adv" data-n="1">+1 day</button>
      <button type="button" data-action="adv" data-n="7">+7 days</button>
      <button type="button" data-action="adv-until">Run until something needs me</button>
    </div>
  </section>

  ${dispute?.status === 'open' ? `<div class="callout bad" role="alert"><p><strong>Dispute open since ${fmt(dispute.openedDay)}.</strong> The package is locked (FR-FRD-004); nothing new will be submitted.</p></div>` : ''}
  ${dispute?.status === 'upheld' ? '<div class="callout bad"><p><strong>Dispute upheld.</strong> Pending changes were cancelled and Revert Orders are restoring the old address (FR-FRD-007).</p></div>' : ''}
  ${dispute?.status === 'rejected' ? '<div class="callout ok"><p>The dispute was reviewed and rejected; your move resumed.</p></div>' : ''}

  ${needs.length ? `<h2>Needs you</h2>${needs.map((o) => orderCard(pkg, o)).join('')}` : ''}
  <h2>All changes</h2>
  ${rest.sort(order).map((o) => orderCard(pkg, o)).join('') || '<p class="muted">Nothing else.</p>'}

  <div class="grid2">
    <section class="card">
      <h2>Fraud protection</h2>
      ${disputeWindowOpen(pkg, day) && !dispute ? `<p class="muted">Simulate someone receiving the old-address letter and reporting that they didn't ask for this move.</p>
        <button type="button" class="danger" data-action="dispute">Simulate: "I didn't request this"</button>` : ''}
      ${dispute?.status === 'open' ? `<p class="muted">Support agent's decision (FR-SUP-004):</p><div class="row">
        <button type="button" class="danger" data-action="uphold">Uphold — it's fraud</button>
        <button type="button" data-action="reject">Reject — it was legitimate</button></div>` : ''}
      ${!disputeWindowOpen(pkg, day) && !dispute ? '<p class="muted">The dispute window has ended.</p>' : ''}
      <h3 style="margin-top:14px">Notices sent</h3>
      <ul>${pkg.notices.map((n) => `<li><strong>${h(n.channel)}</strong>: ${h(n.status)}</li>`).join('')}</ul>
    </section>
    <section class="card">
      <h2>Operations: kill switches</h2>
      <p class="muted">Disable an integration to see channel fallback (NFR-OPS-003). Switching to a channel with a wider audience waits for your consent.</p>
      ${entIds.map((id) => {
        const e = entityById(id);
        const del = e.channels.filter(isDelegated);
        if (!del.length) return '';
        return `<div style="margin-bottom:8px"><strong>${h(e.name)}</strong><div class="row">${del.map((c) =>
          `<label class="check" style="margin:0"><input type="checkbox" data-kill="${id}:${c}" ${state.kill[`${id}:${c}`] ? 'checked' : ''}> ${h(CHANNELS[c].label)} off</label>`).join('')}</div></div>`;
      }).join('')}
    </section>
  </div>

  <div class="grid2">
    <section class="card">
      <h2>Your data</h2>
      ${pkg.pii ? `<p>New address on file: <span class="mono">${h(formatAddress(pkg.pii.newAddress))}</span></p>` : '<p class="callout ok">Personal data deleted. The package key was destroyed, and every subprocessor confirmed deletion (FR-PRV-007).</p>'}
      <p class="muted">Retention: ${pkg.retentionDays} days after Package Closure.</p>
      ${pkg.receipt ? `<p>Closure receipt: <span class="mono">${h(pkg.receipt.packageId)}</span> · access code <span class="mono">${h(pkg.receipt.accessCode)}</span></p>` : ''}
      <div class="row">
        <button type="button" data-action="export" aria-expanded="${showExport}">${showExport ? 'Hide export' : 'Export (JSON)'}</button>
        ${pkg.status !== 'deleted' ? '<button type="button" class="danger" data-action="erase">Delete my data now</button>' : ''}
      </div>
      ${showExport ? `<div class="field" style="margin-top:12px"><label for="export-json">Your move package as JSON (FR-PRV-003 portability)</label>
        <textarea id="export-json" class="export" readonly rows="10">${h(exportPackage(pkg))}</textarea>
        <button type="button" class="small" data-action="copy-export">Copy</button> <span id="copy-status" class="muted" aria-live="polite"></span></div>` : ''}
    </section>
    <section class="card">
      <h2>Audit log</h2>
      <p>${verifyAudit(pkg) ? badge('Hash chain verified', 'b-ok') : badge('Chain broken', 'b-bad')} <small>${pkg.audit.length} entries, no personal data</small></p>
      <details><summary>Show entries</summary><ul class="history">
        ${pkg.audit.slice().reverse().map((a) => `<li><span class="mono">${h(fmt(a.day))}</span> <strong>${h(a.action)}</strong> — ${h(a.actor)}${a.detail ? ` · ${h(a.detail)}` : ''} <span class="mono muted">${h(a.hash)}</span></li>`).join('')}
      </ul></details>
    </section>
  </div>`;
}

// ---------- actions ----------

function advance(n) {
  for (let i = 0; i < n; i++) {
    state.day += 1;
    tick(state.pkg, state.day, state.kill);
  }
}

function act(fn, okMsg) {
  try {
    fn();
    if (okMsg) { flash = { kind: 'ok', text: okMsg }; announce(okMsg); }
  } catch (err) {
    flash = { kind: 'bad', text: err.message };
    announce(err.message);
  }
  render();
}

const ACTIONS = {
  reset() {
    pending = { action: 'do-reset', text: 'Reset the prototype and start over? Your simulated move will be cleared.', yes: 'Reset' };
    render();
    window.scrollTo(0, 0);
    $('[data-action="confirm-yes"]')?.focus();
  },
  'do-reset'() {
    state = freshState();
    showExport = false;
    go('verify');
  },
  'confirm-yes'() {
    const next = pending?.action;
    pending = null;
    if (next) ACTIONS[next]();
  },
  'confirm-no'() { pending = null; render(); },
  idv() { state.draft.idv = true; announce('Identity verified'); render(); },
  validate() {
    const d = state.draft;
    d.validated = { old: validateAddress(d.old), neu: validateAddress(d.neu) };
    d.readback = { street: false, unit: false, city: false };
    render();
    announce(d.validated.old.ok && d.validated.neu.ok ? 'Addresses valid. Confirm each line of the new address.' : 'Address problems found.');
  },
  'sel-rec'() { state.draft.selected = CATALOG.filter((e) => e.recommended).map((e) => e.id); render(); },
  'sel-none'() { state.draft.selected = []; render(); },
  authorize() {
    act(() => {
      const pkg = draftPackage();
      authorize(pkg, state.day, { mfa: /^\d{6}$/.test(state.draft.mfa), consent: state.draft.consent, kill: state.kill, stepUpDone: state.draft.stepUpDone });
      state.pkg = pkg;
      state.step = 'status';
    }, 'Move authorized. Guided tasks are ready now; high-risk changes start when the hold ends.');
    window.scrollTo(0, 0);
  },
  adv(btn) { act(() => advance(Number(btn.dataset.n))); },
  'adv-until'() {
    act(() => {
      const start = summary(state.pkg).needsYou;
      for (let i = 0; i < 120 && state.pkg.status !== 'deleted'; i++) {
        const before = state.pkg.status;
        advance(1);
        if (summary(state.pkg).needsYou > start || state.pkg.status !== before) break;
      }
    });
  },
  complete(btn) {
    const input = document.getElementById(`ref-${btn.dataset.id}`);
    act(() => completeUserAction(state.pkg, btn.dataset.id, state.day, input ? input.value : undefined), 'Recorded.');
  },
  consent(btn) { act(() => grantConsent(state.pkg, btn.dataset.id, state.day), 'Approved; it will retry on the new channel.'); },
  guided(btn) { act(() => chooseGuided(state.pkg, btn.dataset.id, state.day), 'Switched to doing it yourself.'); },
  cancel(btn) { act(() => cancelOrder(state.pkg, btn.dataset.id, state.day), 'Cancelled.'); },
  discrepancy(btn) { act(() => resolveDiscrepancy(state.pkg, btn.dataset.id, state.day), 'Marked resolved.'); },
  dispute() { act(() => openDispute(state.pkg, state.day), 'Dispute opened; package locked.'); },
  uphold() { act(() => resolveDispute(state.pkg, state.day, true), 'Dispute upheld; revert orders created.'); },
  reject() { act(() => resolveDispute(state.pkg, state.day, false), 'Dispute rejected; move resumed.'); },
  export() {
    showExport = !showExport;
    render();
    $('#export-json')?.focus();
  },
  'copy-export'() {
    const ta = $('#export-json');
    const done = (msg) => { const s = $('#copy-status'); if (s) s.textContent = msg; };
    const fallback = () => { ta.select(); done('Selected — press Ctrl+C / ⌘C to copy.'); };
    try {
      navigator.clipboard.writeText(ta.value).then(() => done('Copied.'), fallback);
    } catch { fallback(); }
  },
  erase() {
    const open = disputeWindowOpen(state.pkg, state.day);
    pending = {
      action: 'do-erase',
      yes: 'Delete my data',
      text: open
        ? 'The dispute window is still open. Deleting now also ends fraud protection for this move and cancels unfinished changes. This cannot be undone.'
        : 'Delete all personal data for this move now? This cannot be undone.',
    };
    render();
    window.scrollTo(0, 0);
    $('[data-action="confirm-yes"]')?.focus();
  },
  'do-erase'() {
    showExport = false;
    act(() => eraseNow(state.pkg, state.day), 'Your data was deleted. Keep your closure receipt to view the audit record.');
  },
};

document.addEventListener('click', (ev) => {
  const go_ = ev.target.closest('[data-go]');
  if (go_ && !go_.disabled) { go(go_.dataset.go); return; }
  const btn = ev.target.closest('[data-action]');
  if (btn && !btn.disabled && ACTIONS[btn.dataset.action]) ACTIONS[btn.dataset.action](btn);
});

function bindValue(el) {
  const path = el.dataset.bind;
  let value = el.type === 'checkbox' ? el.checked : el.value;
  if ('num' in el.dataset) value = Number(value);
  if (path.startsWith('readback.')) setPath(state.draft, path, value);
  else setPath(state, path, value);
  if ('invalidate' in el.dataset) state.draft.validated = null;
}

function rerenderKeepingFocus(el) {
  const { id } = el;
  const bind = el.dataset.bind;
  let caret = null;
  try { caret = el.selectionStart; } catch { /* number inputs have no caret API */ }
  render();
  const next = id ? document.getElementById(id) : document.querySelector(`[data-bind="${bind}"]`);
  if (!next) return;
  next.focus();
  try { if (caret != null) next.setSelectionRange(caret, caret); } catch { /* ignore */ }
}

const isTexty = (el) => el.tagName === 'INPUT' && ['text', 'number', 'date'].includes(el.type);

// Text-like inputs re-render on input (never on blur, which would swap out the
// button being clicked); checkboxes, selects and ranges re-render on change.
document.addEventListener('input', (ev) => {
  const el = ev.target;
  if (!el.dataset.bind || !isTexty(el)) {
    if (el.type === 'range' && el.dataset.bind) {
      bindValue(el);
      const lbl = document.querySelector(`label[for="${el.id}"] strong`);
      if (lbl) lbl.textContent = `${el.value} days`;
      save();
    }
    return;
  }
  const wasValidated = Boolean(state.draft.validated);
  bindValue(el);
  if ('rerender' in el.dataset || ('invalidate' in el.dataset && wasValidated)) rerenderKeepingFocus(el);
  else save();
});

document.addEventListener('change', (ev) => {
  const el = ev.target;
  if (el.dataset.entity) {
    const sel = new Set(state.draft.selected);
    el.checked ? sel.add(el.dataset.entity) : sel.delete(el.dataset.entity);
    state.draft.selected = [...sel];
    rerenderKeepingFocus(el);
    return;
  }
  if (el.dataset.kill) {
    if (el.checked) state.kill[el.dataset.kill] = true;
    else delete state.kill[el.dataset.kill];
    render();
    document.querySelector(`[data-kill="${el.dataset.kill}"]`)?.focus();
    return;
  }
  if (!el.dataset.bind || isTexty(el)) return;
  bindValue(el);
  if ('rerender' in el.dataset) rerenderKeepingFocus(el);
  else save();
});

if (state.step === 'status' && !state.pkg) state.step = 'verify';
render();
