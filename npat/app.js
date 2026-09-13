/*
 * NPAT app — pass-and-play state machine and UI.
 * Static-hosting adaptation of the multiplayer spec: one shared device,
 * each player takes a private writing turn; the fastest player to finish
 * all categories counts as having pressed "Stop!" (earns the stop bonus).
 */
(function () {
  'use strict';

  var E = window.NPAT;
  var STORAGE_KEY = 'npat.v1';
  var app = document.getElementById('app');
  var live = document.getElementById('live');

  var state = {
    screen: 'setup',
    settings: clone(E.DEFAULT_SETTINGS),
    players: [
      { id: 'p1', name: 'Player 1' },
      { id: 'p2', name: 'Player 2' }
    ],
    game: null
  };

  var timerHandle = null;
  var timerDeadline = 0;

  // ------------------------------------------------------------------
  // Utilities
  // ------------------------------------------------------------------

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function announce(msg) { live.textContent = msg; }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* private mode etc. */ }
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      var s = JSON.parse(raw);
      if (!s || !s.settings || !s.players) return false;
      // Never resume mid-turn screens; fall back to the turn handoff.
      if (s.screen === 'writing' || s.screen === 'reveal') s.screen = 'handoff';
      state = s;
      return true;
    } catch (e) { return false; }
  }

  function clearSaved() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
  }

  function stopTimer() {
    if (timerHandle) { clearInterval(timerHandle); timerHandle = null; }
  }

  function playerById(pid) {
    for (var i = 0; i < state.players.length; i++) {
      if (state.players[i].id === pid) return state.players[i];
    }
    return { name: '?' };
  }

  function render() {
    stopTimer();
    app.innerHTML = '';
    var screens = {
      setup: renderSetup,
      handoff: renderHandoff,
      reveal: renderReveal,
      writing: renderWriting,
      review: renderReview,
      scoring: renderScoring,
      gameover: renderGameOver
    };
    (screens[state.screen] || renderSetup)();
    save();
  }

  // ------------------------------------------------------------------
  // Setup / lobby
  // ------------------------------------------------------------------

  function renderSetup() {
    var s = state.settings;

    var playersCard = el('div', { class: 'card stack' });
    playersCard.appendChild(el('h2', { text: 'Players (2–' + s.maxPlayers + ')' }));
    var list = el('div', { class: 'row' });
    state.players.forEach(function (p, i) {
      var chip = el('div', { class: 'player-chip' }, [
        el('span', { text: p.name }),
        el('button', {
          class: 'x btn-ghost', 'aria-label': 'Remove ' + p.name, text: '✕',
          onclick: function () {
            if (state.players.length <= 2) { alert('At least 2 players are needed.'); return; }
            state.players.splice(i, 1);
            render();
          }
        })
      ]);
      list.appendChild(chip);
    });
    playersCard.appendChild(list);

    var nameInput = el('input', {
      type: 'text', maxlength: '20', placeholder: 'Nickname (2–20 chars)',
      'aria-label': 'New player nickname',
      onkeydown: function (ev) { if (ev.key === 'Enter') addPlayer(); }
    });
    function addPlayer() {
      var name = nameInput.value.trim();
      if (name.length < 2) { alert('Nickname needs 2–20 characters.'); return; }
      if (state.players.length >= s.maxPlayers) { alert('Room is full (max ' + s.maxPlayers + ').'); return; }
      // FR-1.2: uniqueness with auto-suffix on collision.
      var base = name, n = 2;
      while (state.players.some(function (p) { return p.name.toLowerCase() === name.toLowerCase(); })) {
        name = base + ' ' + n++;
      }
      state.players.push({ id: 'p' + Date.now() + Math.floor(Math.random() * 1000), name: name });
      nameInput.value = '';
      render();
    }
    playersCard.appendChild(el('div', { class: 'row' }, [
      el('div', { class: 'grow' }, [nameInput]),
      el('button', { text: 'Add player', onclick: addPlayer })
    ]));

    var settingsBox = el('details', { class: 'settings' });
    settingsBox.appendChild(el('summary', { text: 'House rules' }));
    var inner = el('div', { class: 'inner' });

    inner.appendChild(field('Categories (2–8, comma-separated)', el('input', {
      type: 'text', value: s.categories.join(', '),
      onchange: function (ev) {
        var cats = ev.target.value.split(',').map(function (c) { return c.trim(); }).filter(Boolean);
        if (cats.length < 2 || cats.length > 8) { alert('Use between 2 and 8 categories.'); render(); return; }
        s.categories = cats; save();
      }
    })));
    inner.appendChild(numField('Rounds (1–20)', s.rounds, 1, 20, function (v) { s.rounds = v; }));
    inner.appendChild(numField('Target score (0 = off)', s.targetScore || 0, 0, 9999, function (v) { s.targetScore = v > 0 ? v : null; }));
    inner.appendChild(numField('Timer per turn, seconds (0 = no timer)', s.roundTimerSec || 0, 0, 600, function (v) { s.roundTimerSec = v > 0 ? v : null; }));
    inner.appendChild(numField('Points for a unique answer', s.uniquePoints, 0, 100, function (v) { s.uniquePoints = v; }));
    inner.appendChild(numField('Points for a duplicated answer', s.duplicatePoints, 0, 100, function (v) { s.duplicatePoints = v; }));
    inner.appendChild(numField('Stop bonus (fastest finisher)', s.stopBonus, 0, 100, function (v) { s.stopBonus = v; }));

    inner.appendChild(checkLine('Finishing early requires all categories filled', s.stopRequiresAllFilled, function (v) { s.stopRequiresAllFilled = v; }));
    inner.appendChild(checkLine('Draw letters without replacement', s.letterWithoutReplacement, function (v) { s.letterWithoutReplacement = v; }));

    inner.appendChild(field('Letter pool', el('input', {
      type: 'text', value: s.letterPool.join(''),
      onchange: function (ev) {
        var pool = ev.target.value.toUpperCase().replace(/[^A-Z]/g, '').split('');
        pool = pool.filter(function (l, i) { return pool.indexOf(l) === i; });
        if (pool.length === 0) { alert('The letter pool cannot be empty.'); render(); return; }
        s.letterPool = pool; save();
      }
    }), 'Default: A–Z minus Q, X, Z, U, V'));

    var dupSel = el('select', {
      'aria-label': 'Duplicate matching mode',
      onchange: function (ev) { s.duplicateMatching = ev.target.value; save(); }
    });
    [['exact', 'Exact (case-insensitive)'], ['normalized', 'Normalized (articles, plurals, punctuation)'], ['fuzzy', 'Fuzzy (also catches 1-letter typos)']]
      .forEach(function (o) {
        var opt = el('option', { value: o[0], text: o[1] });
        if (s.duplicateMatching === o[0]) opt.selected = true;
        dupSel.appendChild(opt);
      });
    dupSel.style.cssText = 'font:inherit;width:100%;min-height:44px;border-radius:10px;border:1px solid var(--line);background:var(--panel);color:var(--text);padding:10px 12px;';
    inner.appendChild(field('Duplicate matching', dupSel));

    settingsBox.appendChild(inner);

    app.appendChild(el('div', { class: 'wrap' }, [
      el('h1', { text: 'Name, Place, Animal, Thing' }),
      el('p', { class: 'tagline', text: 'Pass-and-play word race. One device, ' + state.players.length + ' players, zero mercy.' }),
      playersCard,
      settingsBox,
      el('div', { style: 'margin-top:16px' }, [
        el('button', {
          class: 'btn-primary btn-big', text: 'Start game',
          onclick: startGame
        })
      ]),
      el('p', { class: 'footer-note', text: 'How a round works: everyone gets the same letter and takes a private turn on this device. Fill one answer per category, hit “Done — Stop!” as fast as you can, then review everyone’s answers together. Unique answers score ' + s.uniquePoints + ', duplicates ' + s.duplicatePoints + '.' })
    ]));
  }

  function field(label, control, hint) {
    var f = el('div', { class: 'field' });
    var lab = el('label', { text: label });
    f.appendChild(lab);
    f.appendChild(control);
    if (hint) f.appendChild(el('div', { class: 'hint', text: hint }));
    return f;
  }

  function numField(label, value, min, max, onset) {
    return field(label, el('input', {
      type: 'number', value: String(value), min: String(min), max: String(max), inputmode: 'numeric',
      onchange: function (ev) {
        var v = parseInt(ev.target.value, 10);
        if (isNaN(v) || v < min || v > max) { render(); return; }
        onset(v); save();
      }
    }));
  }

  function checkLine(label, checked, onset) {
    var cb = el('input', { type: 'checkbox', onchange: function (ev) { onset(ev.target.checked); save(); } });
    cb.checked = checked;
    var id = 'cb' + Math.random().toString(36).slice(2);
    cb.id = id;
    return el('div', { class: 'checkline' }, [cb, el('label', { for: id, text: label })]);
  }

  // ------------------------------------------------------------------
  // Game lifecycle
  // ------------------------------------------------------------------

  function startGame() {
    if (state.players.length < 2) { alert('At least 2 players are needed.'); return; }
    state.game = {
      roundIndex: 0,
      usedLetters: [],
      totals: {},
      history: [],
      round: null
    };
    state.players.forEach(function (p) { state.game.totals[p.id] = 0; });
    startRound();
  }

  function startRound() {
    var g = state.game;
    var letter = E.drawLetter(state.settings, g.usedLetters);
    g.usedLetters.push(letter);
    g.round = {
      letter: letter,
      turnIndex: 0,
      answers: {},
      elapsedMs: {},
      finishedEarly: {},
      stoppedBy: null
    };
    state.screen = 'handoff';
    announce('Round ' + (g.roundIndex + 1) + '. Pass the device to ' + state.players[0].name + '.');
    render();
  }

  function currentPlayer() {
    return state.players[state.game.round.turnIndex];
  }

  function renderHandoff() {
    var g = state.game;
    var p = currentPlayer();
    app.appendChild(el('div', { class: 'wrap handoff' }, [
      el('p', { class: 'tagline', text: 'Round ' + (g.roundIndex + 1) + ' of ' + state.settings.rounds }),
      el('p', { text: 'Pass the device to' }),
      el('div', { class: 'who', text: p.name }),
      el('button', {
        class: 'btn-primary btn-big', text: 'I’m ' + p.name + ' — reveal my letter',
        onclick: function () {
          state.screen = 'reveal';
          render();
        }
      }),
      el('div', { style: 'margin-top:24px' }, [abandonButton()])
    ]));
  }

  // FR-2.1: 3-second countdown, then the letter is shown.
  function renderReveal() {
    var count = 3;
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { state.screen = 'writing'; render(); return; }
    var num = el('div', { class: 'count', text: String(count), 'aria-hidden': 'true' });
    app.appendChild(el('div', { class: 'wrap reveal' }, [
      el('p', { text: 'Get ready, ' + currentPlayer().name + '…' }),
      num
    ]));
    announce('Letter reveals in 3 seconds.');
    timerHandle = setInterval(function () {
      count--;
      if (count <= 0) {
        stopTimer();
        state.screen = 'writing';
        render();
      } else {
        num.textContent = String(count);
      }
    }, 1000);
  }

  function renderWriting() {
    var s = state.settings;
    var g = state.game;
    var r = g.round;
    var p = currentPlayer();
    var startedAt = Date.now();
    var drafts = {};
    s.categories.forEach(function (c) { drafts[c] = ''; });

    var timerEl = null;
    var doneBtn = el('button', { class: 'btn-primary btn-big', text: 'Done — Stop! ✋', onclick: function () { submitTurn(false); } });

    function allFilled() {
      return s.categories.every(function (c) { return !E.isBlank(drafts[c]); });
    }
    function refreshDone() {
      doneBtn.disabled = s.stopRequiresAllFilled && !allFilled();
    }

    var inputs = el('div', { class: 'answers' });
    s.categories.forEach(function (cat, idx) {
      var hint = el('div', { class: 'letterhint hint', text: '', 'aria-live': 'polite' });
      var input = el('input', {
        type: 'text', maxlength: '40', autocomplete: 'off', autocapitalize: 'words',
        spellcheck: 'false', 'aria-label': cat + ' starting with ' + r.letter,
        oninput: function (ev) {
          drafts[cat] = ev.target.value;
          var ok = E.letterCheck(drafts[cat], r.letter);
          ev.target.classList.toggle('ok', ok);
          // FR-3.2: inline, non-blocking hint.
          hint.textContent = (!E.isBlank(drafts[cat]) && !ok) ? 'Doesn’t start with ' + r.letter : '';
          refreshDone();
        },
        onkeydown: function (ev) {
          if (ev.key === 'Enter') {
            var next = inputs.querySelectorAll('input')[idx + 1];
            if (next) next.focus();
            else if (!doneBtn.disabled) submitTurn(false);
          }
        }
      });
      inputs.appendChild(field(cat, input, undefined));
      inputs.lastChild.appendChild(hint);
    });

    function submitTurn(timedOut) {
      stopTimer();
      var elapsed = Date.now() - startedAt;
      r.answers[p.id] = {};
      s.categories.forEach(function (cat) {
        var raw = drafts[cat] || '';
        var iv = E.initialValidity(raw, r.letter);
        r.answers[p.id][cat] = { raw: raw, validity: iv.validity, decidedBy: iv.decidedBy };
      });
      r.elapsedMs[p.id] = elapsed;
      r.finishedEarly[p.id] = !timedOut && (!s.stopRequiresAllFilled || allFilled());
      if (r.turnIndex + 1 < state.players.length) {
        r.turnIndex++;
        state.screen = 'handoff';
      } else {
        // Stop attribution: fastest early finisher (§3.1 rule 4 adapted).
        var best = null;
        state.players.forEach(function (pl) {
          if (r.finishedEarly[pl.id] && (best === null || r.elapsedMs[pl.id] < r.elapsedMs[best])) best = pl.id;
        });
        r.stoppedBy = best;
        state.screen = 'review';
        announce('All answers in. Review time.');
      }
      render();
    }

    var head = el('div', { class: 'letter-banner' }, [
      el('div', { class: 'big-letter', text: r.letter, role: 'img', 'aria-label': 'Round letter ' + r.letter })
    ]);
    if (s.roundTimerSec) {
      timerEl = el('div', { class: 'timer', role: 'timer', 'aria-label': 'Time left', text: format(s.roundTimerSec * 1000) });
      head.appendChild(timerEl);
      timerDeadline = startedAt + s.roundTimerSec * 1000;
      timerHandle = setInterval(function () {
        var left = timerDeadline - Date.now();
        if (left <= 0) { submitTurn(true); return; }
        timerEl.textContent = format(left);
        timerEl.classList.toggle('low', left < 10000);
      }, 200);
    }

    refreshDone();
    app.appendChild(el('div', { class: 'wrap' }, [
      el('p', { class: 'tagline', text: p.name + ' — round ' + (g.roundIndex + 1) + ' of ' + s.rounds }),
      head,
      inputs,
      el('div', { style: 'margin-top:12px' }, [doneBtn]),
      s.stopRequiresAllFilled ? el('p', { class: 'footer-note', text: 'Stop unlocks once every category is filled. Fastest finisher takes the Stop' + (s.stopBonus ? ' bonus (+' + s.stopBonus + ')' : ' crown') + '.' }) : null
    ]));
    var first = inputs.querySelector('input');
    if (first) first.focus();
    announce('Letter ' + r.letter + '. Go!');
  }

  function format(ms) {
    var total = Math.ceil(ms / 1000);
    var m = Math.floor(total / 60), sec = total % 60;
    return m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  // ------------------------------------------------------------------
  // Review (FR-2.3): tap an answer to flip valid/invalid; duplicates
  // and letter-check failures are labeled. Blank stays invalid.
  // ------------------------------------------------------------------

  function renderReview() {
    var s = state.settings;
    var g = state.game;
    var r = g.round;

    var wrap = el('div', { class: 'wrap' });
    wrap.appendChild(el('h1', { text: 'Review — letter ' + r.letter }));
    wrap.appendChild(el('p', { class: 'tagline', text: 'Tap any answer to flip it between valid and invalid. Argue loudly, then score.' }));
    if (r.stoppedBy) {
      wrap.appendChild(el('p', {
        class: 'footer-note',
        text: '✋ ' + playerById(r.stoppedBy).name + ' finished fastest (' + (r.elapsedMs[r.stoppedBy] / 1000).toFixed(1) + 's).'
      }));
    }

    var grid = el('div', { class: 'review-grid' });

    // Precompute duplicate groups among currently-valid answers.
    function dupSetFor(cat) {
      var entries = [];
      state.players.forEach(function (p) {
        var a = r.answers[p.id] && r.answers[p.id][cat];
        if (a && a.validity === 'VALID') entries.push({ playerId: p.id, key: E.matchKey(a.raw, s.duplicateMatching) });
      });
      var dupIds = {};
      E.groupDuplicates(entries, s.duplicateMatching).forEach(function (grp) {
        if (grp.length > 1) grp.forEach(function (e) { dupIds[e.playerId] = true; });
      });
      return dupIds;
    }

    s.categories.forEach(function (cat) {
      grid.appendChild(el('div', { class: 'cat-title', text: cat }));
      var dups = dupSetFor(cat);
      state.players.forEach(function (p) {
        var a = r.answers[p.id] && r.answers[p.id][cat];
        if (!a) return;
        var blank = E.isBlank(a.raw);
        var pills = [];
        if (a.validity === 'VALID') {
          pills.push(el('span', { class: 'pill valid', text: '✓ valid' }));
          if (dups[p.id]) pills.push(el('span', { class: 'pill dup', text: '= duplicate' }));
        } else {
          var why = a.decidedBy === 'blank' ? 'blank' : a.decidedBy === 'letter' ? 'wrong letter' : 'rejected';
          pills.push(el('span', { class: 'pill invalid', text: '✗ ' + why }));
        }
        var cell = el('button', {
          class: 'answer-cell',
          'aria-label': p.name + ', ' + cat + ': ' + (blank ? 'blank' : a.raw) + '. Currently ' + a.validity.toLowerCase() + '. Activate to flip.',
          onclick: function () {
            if (blank) return; // a blank can't become valid
            if (a.validity === 'VALID') {
              a.validity = 'INVALID'; a.decidedBy = 'group';
            } else {
              a.validity = 'VALID'; a.decidedBy = 'override'; // letter-fail override allowed (§7.1)
            }
            render();
          }
        }, [
          el('span', {}, [
            el('span', { class: 'cell-owner', text: p.name }),
            el('span', { class: 'raw' + (blank ? ' blank' : ''), text: blank ? '(blank)' : a.raw })
          ]),
          el('span', { class: 'row' }, pills)
        ]);
        grid.appendChild(cell);
      });
    });

    wrap.appendChild(grid);
    wrap.appendChild(el('div', { style: 'margin-top:20px' }, [
      el('button', {
        class: 'btn-primary btn-big', text: 'Score this round',
        onclick: function () {
          r.scores = E.scoreRound({ letter: r.letter, stoppedBy: r.stoppedBy, answers: r.answers }, s);
          state.players.forEach(function (p) {
            g.totals[p.id] += r.scores.totals[p.id] || 0;
          });
          g.history.push({
            letter: r.letter,
            stoppedBy: r.stoppedBy,
            totals: clone(r.scores.totals)
          });
          state.screen = 'scoring';
          announce('Round scored.');
          render();
        }
      })
    ]));
    wrap.appendChild(el('div', { style: 'margin-top:12px' }, [abandonButton()]));
    app.appendChild(wrap);
  }

  // ------------------------------------------------------------------
  // Scoring (FR-2.4) and game over (FR-2.5)
  // ------------------------------------------------------------------

  function sortedByTotal() {
    return state.players.slice().sort(function (a, b) {
      return state.game.totals[b.id] - state.game.totals[a.id];
    });
  }

  function renderScoring() {
    var s = state.settings;
    var g = state.game;
    var r = g.round;

    var wrap = el('div', { class: 'wrap' });
    wrap.appendChild(el('h1', { text: 'Round ' + (g.roundIndex + 1) + ' — letter ' + r.letter }));

    var table = el('table', { class: 'score' });
    var thead = el('tr', {}, [el('th', { text: 'Player' })]);
    s.categories.forEach(function (c) { thead.appendChild(el('th', { class: 'num', text: c })); });
    if (s.stopBonus) thead.appendChild(el('th', { class: 'num', text: '✋' }));
    thead.appendChild(el('th', { class: 'num', text: 'Round' }));
    thead.appendChild(el('th', { class: 'num', text: 'Total' }));
    table.appendChild(thead);

    sortedByTotal().forEach(function (p) {
      var pts = r.scores.points[p.id];
      var tr = el('tr', {}, [el('td', { text: p.name })]);
      s.categories.forEach(function (c) { tr.appendChild(el('td', { class: 'num', text: String(pts.byCategory[c]) })); });
      if (s.stopBonus) tr.appendChild(el('td', { class: 'num', text: String(pts.bonus) }));
      tr.appendChild(el('td', { class: 'num', text: String(pts.total) }));
      tr.appendChild(el('td', { class: 'num', text: String(g.totals[p.id]) }));
      table.appendChild(tr);
    });

    var lastRound = g.roundIndex + 1 >= s.rounds;
    var targetHit = s.targetScore && state.players.some(function (p) { return g.totals[p.id] >= s.targetScore; });
    var over = lastRound || targetHit;

    wrap.appendChild(el('div', { class: 'card table-scroll' }, [table]));
    wrap.appendChild(el('div', { style: 'margin-top:16px' }, [
      el('button', {
        class: 'btn-primary btn-big',
        text: over ? 'Final standings' : 'Next round →',
        onclick: function () {
          if (over) {
            state.screen = 'gameover';
            render();
          } else {
            g.roundIndex++;
            startRound();
          }
        }
      })
    ]));
    wrap.appendChild(el('div', { style: 'margin-top:12px' }, [abandonButton()]));
    app.appendChild(wrap);
  }

  function renderGameOver() {
    var g = state.game;
    var ranked = sortedByTotal();
    var top = g.totals[ranked[0].id];
    var winners = ranked.filter(function (p) { return g.totals[p.id] === top; });

    var wrap = el('div', { class: 'wrap' });
    wrap.appendChild(el('div', { class: 'podium' }, [
      el('div', { class: 'medal', text: '🏆', 'aria-hidden': 'true' }),
      el('div', { class: 'winner', text: winners.map(function (p) { return p.name; }).join(' & ') + (winners.length > 1 ? ' tie!' : ' wins!') }),
      el('p', { class: 'tagline', text: top + ' points' })
    ]));

    var table = el('table', { class: 'score' });
    var head = el('tr', {}, [el('th', { text: '#' }), el('th', { text: 'Player' })]);
    g.history.forEach(function (h, i) { head.appendChild(el('th', { class: 'num', text: h.letter })); });
    head.appendChild(el('th', { class: 'num', text: 'Total' }));
    table.appendChild(head);
    ranked.forEach(function (p, i) {
      var tr = el('tr', {}, [el('td', { text: String(i + 1) }), el('td', { text: p.name })]);
      g.history.forEach(function (h) { tr.appendChild(el('td', { class: 'num', text: String(h.totals[p.id] || 0) })); });
      tr.appendChild(el('td', { class: 'num', text: String(g.totals[p.id]) }));
      table.appendChild(tr);
    });
    wrap.appendChild(el('div', { class: 'card table-scroll' }, [table]));

    wrap.appendChild(el('div', { class: 'stack', style: 'margin-top:16px' }, [
      el('button', {
        class: 'btn-primary btn-big', text: 'Play again (same players & rules)',
        onclick: startGame
      }),
      el('button', {
        class: 'btn-big', text: 'Back to lobby',
        onclick: function () { state.game = null; state.screen = 'setup'; render(); }
      })
    ]));
    app.appendChild(wrap);
    announce('Game over. ' + winners.map(function (p) { return p.name; }).join(' and ') + ' won with ' + top + ' points.');
  }

  function abandonButton() {
    return el('button', {
      class: 'btn-danger', text: 'Abandon game',
      onclick: function () {
        if (confirm('Abandon this game? Scores will be lost.')) {
          state.game = null;
          state.screen = 'setup';
          clearSaved();
          render();
        }
      }
    });
  }

  // ------------------------------------------------------------------
  // Boot: FR-6.1 adapted — reload restores the saved game.
  // ------------------------------------------------------------------

  load();
  render();
})();
