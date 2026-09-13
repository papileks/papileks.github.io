/*
 * NPAT engine — pure, deterministic game logic per spec §3, §7, §8.
 * No DOM, no timers, no I/O. Loaded as a browser script (window.NPAT)
 * and as a CommonJS module for the Node test suite.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.NPAT = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULT_LETTER_POOL = 'ABCDEFGHIJKLMNOPRSTWY'.split(''); // A–Z minus Q,X,Z,U,V

  var DEFAULT_SETTINGS = {
    categories: ['Name', 'Place', 'Animal', 'Thing'],
    rounds: 5,
    targetScore: null,
    roundTimerSec: 60,          // null disables the timer
    stopRequiresAllFilled: true,
    stopBonus: 0,
    uniquePoints: 10,
    duplicatePoints: 5,
    letterPool: DEFAULT_LETTER_POOL.slice(),
    letterWithoutReplacement: true,
    duplicateMatching: 'normalized', // 'exact' | 'normalized' | 'fuzzy'
    maxPlayers: 8
  };

  // ---------------------------------------------------------------------
  // Normalization (§7.1): Unicode NFKD → strip diacritics → uppercase.
  // ---------------------------------------------------------------------

  function stripDiacritics(s) {
    return s.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  }

  // General-purpose normalization used for display and letter check:
  // trims, collapses whitespace, strips diacritics, uppercases.
  function normalizeAnswer(raw) {
    if (typeof raw !== 'string') return '';
    return stripDiacritics(raw).replace(/\s+/g, ' ').trim().toUpperCase();
  }

  // Letter check (§7.1): first alphabetic character after normalization
  // must equal the round letter. Non-letters at the start are skipped.
  function letterCheck(raw, letter) {
    var norm = normalizeAnswer(raw);
    var m = norm.match(/[A-Z]/);
    if (!m) return false;
    return m[0] === String(letter).toUpperCase();
  }

  function isBlank(raw) {
    return normalizeAnswer(raw) === '';
  }

  // ---------------------------------------------------------------------
  // Duplicate matching keys (§8.2)
  // ---------------------------------------------------------------------

  var ARTICLES = /^(THE|A|AN)\s+/;

  function singularize(word) {
    // Small rule set, deliberately not a full stemmer (§8.2).
    if (word.length > 3 && /IES$/.test(word)) return word.slice(0, -3) + 'Y';
    if (word.length > 3 && /(SES|XES|ZES|CHES|SHES)$/.test(word)) return word.slice(0, -2);
    if (word.length > 2 && /S$/.test(word) && !/SS$/.test(word)) return word.slice(0, -1);
    return word;
  }

  function matchKey(raw, mode) {
    var norm = normalizeAnswer(raw);
    if (mode === 'exact') {
      return norm; // trimmed, case-insensitive (whitespace collapsed)
    }
    // 'normalized' and 'fuzzy' share the normalized key; fuzzy adds a
    // distance comparison at grouping time (see groupDuplicates).
    var s = norm.replace(ARTICLES, '');
    s = s.replace(/[^A-Z0-9]/g, ''); // drop punctuation and whitespace
    s = singularize(s);
    return s;
  }

  // Optimal-string-alignment (restricted Damerau-Levenshtein) distance,
  // early-exit when the distance must exceed `max`.
  function osaDistanceAtMost(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    var la = a.length, lb = b.length;
    var prev2 = null;
    var prev = [];
    for (var j = 0; j <= lb; j++) prev[j] = j;
    for (var i = 1; i <= la; i++) {
      var cur = [i];
      var rowMin = i;
      for (j = 1; j <= lb; j++) {
        var cost = a[i - 1] === b[j - 1] ? 0 : 1;
        var v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          v = Math.min(v, prev2[j - 2] + cost);
        }
        cur[j] = v;
        if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return max + 1;
      prev2 = prev;
      prev = cur;
    }
    return prev[lb];
  }

  function fuzzyEqual(keyA, keyB) {
    if (keyA === keyB) return true;
    // §8.2: distance ≤ 1 only for length ≥ 5.
    if (keyA.length < 5 || keyB.length < 5) return false;
    return osaDistanceAtMost(keyA, keyB, 1) <= 1;
  }

  // Groups entries [{playerId, key}] into duplicate groups. Fuzzy matching
  // is not transitive, so grouping uses union-find over pairwise matches.
  function groupDuplicates(entries, mode) {
    var parent = entries.map(function (_, i) { return i; });
    function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
    function union(a, b) { var ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; }

    for (var i = 0; i < entries.length; i++) {
      for (var j = i + 1; j < entries.length; j++) {
        var same = mode === 'fuzzy'
          ? fuzzyEqual(entries[i].key, entries[j].key)
          : entries[i].key === entries[j].key;
        if (same) union(i, j);
      }
    }
    var groups = {};
    entries.forEach(function (e, idx) {
      var r = find(idx);
      (groups[r] = groups[r] || []).push(e);
    });
    return Object.keys(groups).map(function (k) { return groups[k]; });
  }

  // ---------------------------------------------------------------------
  // Scoring (§8.1) — pure function.
  //
  // round: {
  //   letter, stoppedBy (playerId | null),
  //   answers: { [playerId]: { [category]: { raw, validity } } }
  // }
  // validity: 'VALID' | 'INVALID' (already decided; letter check and
  // review overrides happen before scoring).
  //
  // Returns { points: {pid: {byCategory, bonus, total}}, totals: {pid} }
  // ---------------------------------------------------------------------

  function scoreRound(round, settings) {
    var s = settings || DEFAULT_SETTINGS;
    var points = {};
    var playerIds = Object.keys(round.answers);

    playerIds.forEach(function (pid) {
      points[pid] = { byCategory: {}, bonus: 0, total: 0 };
    });

    s.categories.forEach(function (cat) {
      var validEntries = [];
      playerIds.forEach(function (pid) {
        var a = round.answers[pid] && round.answers[pid][cat];
        if (a && a.validity === 'VALID') {
          validEntries.push({ playerId: pid, key: matchKey(a.raw, s.duplicateMatching) });
        }
      });
      var groups = groupDuplicates(validEntries, s.duplicateMatching);
      var groupSize = {};
      groups.forEach(function (g) {
        g.forEach(function (e) { groupSize[e.playerId] = g.length; });
      });
      playerIds.forEach(function (pid) {
        var a = round.answers[pid] && round.answers[pid][cat];
        var p = 0;
        if (a && a.validity === 'VALID') {
          p = groupSize[pid] === 1 ? s.uniquePoints : s.duplicatePoints;
        }
        points[pid].byCategory[cat] = p;
        points[pid].total += p;
      });
    });

    if (round.stoppedBy && points[round.stoppedBy]) {
      points[round.stoppedBy].bonus = s.stopBonus;
      points[round.stoppedBy].total += s.stopBonus;
    }

    var totals = {};
    playerIds.forEach(function (pid) { totals[pid] = points[pid].total; });
    return { points: points, totals: totals };
  }

  // ---------------------------------------------------------------------
  // Letter draw (§3.1 rule 2): uniform from pool, without replacement
  // within a game when configured.
  // ---------------------------------------------------------------------

  function drawLetter(settings, usedLetters, rng) {
    var random = rng || Math.random;
    var pool = settings.letterPool.slice();
    if (settings.letterWithoutReplacement) {
      pool = pool.filter(function (l) { return usedLetters.indexOf(l) === -1; });
      if (pool.length === 0) pool = settings.letterPool.slice(); // pool exhausted: reset
    }
    return pool[Math.floor(random() * pool.length)];
  }

  // Decide initial validity of a frozen answer: blank or failed letter
  // check → INVALID (decided by 'letter'); otherwise VALID pending review.
  function initialValidity(raw, letter) {
    if (isBlank(raw)) return { validity: 'INVALID', decidedBy: 'blank' };
    if (!letterCheck(raw, letter)) return { validity: 'INVALID', decidedBy: 'letter' };
    return { validity: 'VALID', decidedBy: null };
  }

  return {
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    DEFAULT_LETTER_POOL: DEFAULT_LETTER_POOL,
    normalizeAnswer: normalizeAnswer,
    letterCheck: letterCheck,
    isBlank: isBlank,
    matchKey: matchKey,
    groupDuplicates: groupDuplicates,
    osaDistanceAtMost: osaDistanceAtMost,
    scoreRound: scoreRound,
    drawLetter: drawLetter,
    initialValidity: initialValidity
  };
});
