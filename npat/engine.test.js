// Node test suite for the NPAT engine. Run with: node npat/engine.test.js
'use strict';
const E = require('./engine.js');

let failures = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    failures++;
    console.error(`FAIL ${label}\n  expected ${b}\n  actual   ${a}`);
  } else {
    console.log(`ok   ${label}`);
  }
}

// --- Normalization & letter check (§7.1) ---
eq(E.normalizeAnswer('  éclair  cake '), 'ECLAIR CAKE', 'normalize: diacritics, whitespace, case');
eq(E.letterCheck('Éclair', 'E'), true, 'letter check: diacritic start');
eq(E.letterCheck('"Paris"', 'P'), true, 'letter check: skips leading punctuation');
eq(E.letterCheck('  panda', 'P'), true, 'letter check: leading spaces');
eq(E.letterCheck('panda', 'B'), false, 'letter check: wrong letter');
eq(E.letterCheck('123', 'P'), false, 'letter check: no alphabetic char');
eq(E.isBlank('   '), true, 'blank detection');

// --- Match keys (§8.2) ---
eq(E.matchKey('The Lion', 'normalized'), 'LION', 'key: drops leading article');
eq(E.matchKey('lions', 'normalized'), 'LION', 'key: simple plural');
eq(E.matchKey('ponies', 'normalized'), 'PONY', 'key: -ies plural');
eq(E.matchKey('foxes', 'normalized'), 'FOX', 'key: -xes plural');
eq(E.matchKey('glass', 'normalized'), 'GLASS', 'key: -ss not singularized');
eq(E.matchKey('  New   York! ', 'normalized'), 'NEWYORK', 'key: punctuation/whitespace removed');
eq(E.matchKey('Pen', 'exact'), 'PEN', 'key exact: case-insensitive trim');
eq(E.matchKey('The Pen', 'exact'), 'THE PEN', 'key exact: keeps article');

// --- Fuzzy distance ---
eq(E.osaDistanceAtMost('ZEBRA', 'ZEBAR', 1), 1, 'OSA: transposition = 1');
eq(E.osaDistanceAtMost('ZEBRA', 'ZEBRA', 1), 0, 'OSA: identical = 0');
eq(E.osaDistanceAtMost('ZEBRA', 'ZEBUS', 1) > 1, true, 'OSA: distance > 1 detected');

const fuzzyGroups = E.groupDuplicates(
  [{ playerId: 'a', key: 'ZEBRA' }, { playerId: 'b', key: 'ZEBAR' }, { playerId: 'c', key: 'PANDA' }],
  'fuzzy'
);
eq(fuzzyGroups.length, 2, 'fuzzy grouping: ZEBRA/ZEBAR merge, PANDA separate');
const shortNoFuzz = E.groupDuplicates(
  [{ playerId: 'a', key: 'PEN' }, { playerId: 'b', key: 'PAN' }],
  'fuzzy'
);
eq(shortNoFuzz.length, 2, 'fuzzy grouping: length < 5 never fuzzy-merges');

// --- Scoring: Appendix A example round ---
const settings = Object.assign({}, E.DEFAULT_SETTINGS);
const round = {
  letter: 'P',
  stoppedBy: 'cara',
  answers: {
    ana:  { Name: { raw: 'Paul',  validity: 'VALID' }, Place: { raw: 'Paris', validity: 'VALID' },
            Animal: { raw: 'Panda',  validity: 'VALID' }, Thing: { raw: 'Pen', validity: 'VALID' } },
    ben:  { Name: { raw: 'Priya', validity: 'VALID' }, Place: { raw: 'Paris', validity: 'VALID' },
            Animal: { raw: 'Pigeon', validity: 'VALID' }, Thing: { raw: 'Pen', validity: 'VALID' } },
    cara: { Name: { raw: 'Pablo', validity: 'VALID' }, Place: { raw: 'Peru',  validity: 'VALID' },
            Animal: { raw: 'Parrot', validity: 'VALID' }, Thing: { raw: 'Pxylo', validity: 'INVALID' } }
  }
};
const res = E.scoreRound(round, settings);
eq(res.totals, { ana: 30, ben: 30, cara: 30 }, 'Appendix A: all totals 30');
eq(res.points.ana.byCategory, { Name: 10, Place: 5, Animal: 10, Thing: 5 }, 'Appendix A: Ana breakdown');
eq(res.points.cara.byCategory, { Name: 10, Place: 10, Animal: 10, Thing: 0 }, 'Appendix A: Cara breakdown');

// Stop bonus applied when configured
const bonusRes = E.scoreRound(round, Object.assign({}, settings, { stopBonus: 5 }));
eq(bonusRes.totals.cara, 35, 'stop bonus adds to stopper total');
eq(bonusRes.points.cara.bonus, 5, 'stop bonus recorded');

// Duplicate matching across articles/plurals in normalized mode
const dupRound = {
  letter: 'L', stoppedBy: null,
  answers: {
    a: { Name: { raw: 'Lena', validity: 'VALID' }, Place: { raw: 'Lagos', validity: 'VALID' },
         Animal: { raw: 'The Lions', validity: 'VALID' }, Thing: { raw: 'Lamp', validity: 'VALID' } },
    b: { Name: { raw: 'Lena', validity: 'VALID' }, Place: { raw: 'London', validity: 'VALID' },
         Animal: { raw: 'lion', validity: 'VALID' }, Thing: { raw: '', validity: 'INVALID' } }
  }
};
const dupRes = E.scoreRound(dupRound, settings);
eq(dupRes.points.a.byCategory, { Name: 5, Place: 10, Animal: 5, Thing: 10 }, 'normalized dup: articles+plural merge');
eq(dupRes.points.b.byCategory, { Name: 5, Place: 10, Animal: 5, Thing: 0 }, 'invalid/blank scores 0');

// Scoring invariants (§13 property checks, small deterministic sweep)
let invariantOk = true;
['exact', 'normalized', 'fuzzy'].forEach(mode => {
  const s2 = Object.assign({}, settings, { duplicateMatching: mode });
  const r2 = E.scoreRound(dupRound, s2);
  Object.keys(r2.points).forEach(pid => {
    Object.values(r2.points[pid].byCategory).forEach(p => {
      if (![0, s2.duplicatePoints, s2.uniquePoints].includes(p)) invariantOk = false;
    });
  });
  // idempotent re-scoring
  if (JSON.stringify(E.scoreRound(dupRound, s2)) !== JSON.stringify(r2)) invariantOk = false;
});
eq(invariantOk, true, 'invariants: points ∈ {0,dup,unique}; re-scoring idempotent');

// --- Letter draw ---
const rng = () => 0; // always first eligible letter
eq(E.drawLetter(settings, [], rng), 'A', 'draw: first from pool');
eq(E.drawLetter(settings, ['A'], rng), 'B', 'draw: without replacement skips used');
eq(E.drawLetter(settings, E.DEFAULT_LETTER_POOL, rng), 'A', 'draw: pool exhausted resets');
eq(E.DEFAULT_LETTER_POOL.join(''), 'ABCDEFGHIJKLMNOPRSTWY', 'default pool = A–Z minus Q,X,Z,U,V');

// --- Initial validity ---
eq(E.initialValidity('', 'P'), { validity: 'INVALID', decidedBy: 'blank' }, 'initial: blank invalid');
eq(E.initialValidity('Dog', 'P'), { validity: 'INVALID', decidedBy: 'letter' }, 'initial: letter fail invalid');
eq(E.initialValidity('Panda', 'P'), { validity: 'VALID', decidedBy: null }, 'initial: letter ok valid');

if (failures) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log('\nAll engine tests passed');
