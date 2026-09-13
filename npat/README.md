# Name, Place, Animal, Thing (NPAT)

A browser implementation of the classic word game, built from the NPAT
product & technical specification and playable at `/npat/`.

## What this is

This repository is a **GitHub Pages site** — static hosting with no server
runtime. The spec's v1 targets a server-authoritative real-time multiplayer
architecture (Node WebSocket game server, Redis snapshots, Postgres), which
cannot run on GitHub Pages. This build therefore implements the spec's full
**rules engine** and game flow as a client-side, **pass-and-play** game on
one shared device, keeping everything that doesn't require a server:

- Canonical rules (§3.1): configurable rounds, target score, letter drawn
  uniformly without replacement from the default pool (A–Z minus Q,X,Z,U,V),
  unique = 10 / duplicate = 5 / invalid = 0, optional Stop bonus.
- House rules (§3.2): categories (2–8, custom), rounds, target score, timer
  (or none), `stopRequiresAllFilled`, stop bonus, point values, letter pool,
  with/without replacement, duplicate-matching mode.
- Letter check (§7.1): NFKD → strip diacritics → first alphabetic character
  must match the round letter; automatic, with review override.
- Duplicate matching (§8.2): `exact`, `normalized` (articles, punctuation,
  simple plurals) and `fuzzy` (Damerau–Levenshtein ≤ 1 for length ≥ 5,
  grouped via union–find since fuzzy matching is not transitive).
- Scoring engine (§8.1): pure, deterministic function, unit-tested,
  including the spec's Appendix A example round as a fixture.
- Round lifecycle (§5.2): reveal countdown → writing (timer + non-blocking
  letter hint, FR-3.2) → review grid with validity flipping and duplicate
  pills → animated-free scoring table → game over podium with per-round
  breakdown and "play again".
- Resilience (FR-6.1 adapted): full game state persists to `localStorage`
  after every transition; a reload resumes at the current turn's handoff.
- Accessibility (§6): mobile-first at 360 px, numeric timers, validity shown
  with icons/text (never color alone), `aria-live` phase announcements,
  keyboard play, `prefers-reduced-motion` respected.

## Adaptations for pass-and-play

| Spec (online multiplayer) | This build (one device) |
|---|---|
| All players write simultaneously; first finisher presses **Stop** and cuts everyone off (with a grace window) | Each player takes a private timed turn with the same time budget; the **fastest finisher who filled all categories** is credited as the stopper (and earns the Stop bonus) |
| Challenges open votes among connected players | The group reviews together; tapping an answer flips it valid/invalid (equivalent to the vote outcome / host override) |
| Dictionary service tiers 1–3 | Not included (would require bundled datasets or an API); validity is decided by the group, as in `vote` mode |
| Rooms, join codes, spectators, chat, reconnect tokens | Not applicable on a single device |

## Files

- `engine.js` — pure rules engine (normalization, letter check, match keys,
  duplicate grouping, scoring, letter draw). No DOM, no I/O; loads in the
  browser and in Node.
- `engine.test.js` — test suite; run `node npat/engine.test.js`.
- `app.js` — state machine + UI (setup → handoff → reveal → writing →
  review → scoring → game over).
- `style.css`, `index.html` — presentation.

## Toward the full spec

The engine module is deliberately kept pure and I/O-free so it can be moved
into the spec's `@npat/engine` package unchanged when a real-time server
(§9) is built. The pass-and-play UI would then become the offline mode.
