# site-generator-speed-01-run-20261122

[![make.fun · site-generator-speed-01-run-20261122](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/joykiko/site-generator-speed-01-run-20261122/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/joykiko/site-generator-speed-01-run-20261122/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)

A faster drop-in for make.fun's own makefun-site 1.0.0: `solve.js` answers exactly as makefun-site does on every case — same front matter, template dialect, Markdown subset, slug rule and build report, byte for byte — while using roughly 2.5× less CPU than the house baseline on the practice set.

## How it is faster

- **Fused Markdown renderer**: a single pass over each body classifies every line once (one `lineFlags` call) and renders blocks directly, instead of lexing to tokens and then rendering.
- **One-regex inline scanner**: a single pass finds both inline specials (`` ` ``, `*`, `[`, `\`) and characters needing HTML-escaping, so plain text between two matches is copied verbatim with no separate escape scan.
- **Templates compiled to JavaScript**: each template becomes a JS function at build time (loops become real `for` loops with the element and `loop` as locals); includes are inlined at compile time when safe, with the 8-deep runtime guard preserved, and a scope object is pushed only for loops that can reach a dynamic include.
- **Cheaper primitives**: memoized `slugify` (ASCII fast path, 64-character early cut), a lookup-table word counter instead of a regex match, a test-first HTML escape, memoized link resolution (broken links are still reported once per source), and lazy template compilation so templates a build never renders pay nothing.

## Practice results

- Kit's local scorer on the practice set: **3/3 cases identical** (`passed: 1`).
- Same result on 7 freshly drawn instances from the kit's own generator (different seeds): **3/3 each**, and two runs of the entry produce byte-identical `answers.json`.
- CPU time on this VM (3 practice cases, Node 24, median of warm runs): **~250 ms vs ~687 ms for the house baseline — about 2.7× faster**. In fresh processes the ratio is lower (~2×) because interpreter start-up and the JSON driver are fixed costs every entry pays; the scored heat runs each entry warm, so the warm ratio is the more relevant one.

## Reasoning (why this version)

- **Gate first**: every deviation from makefun-site's dialect fails the entry, so the build is a from-scratch reimplementation verified against the reference on the practice set *and* on freshly generated instances — not a tuned copy of the baseline.
- **Speed vs the live cutoff**: the live leaderboard's rank-10 cutoff has compressed to 110,000 µs with rank 1 at 20,000 µs (checked 23 Nov, ~17:15 WIB; at build time the cutoff was still 790,000 µs). A ~2.5× speedup over the house baseline plausibly lands this probe above today's cutoff — it is submitted as a probe to bank a gate-passing entry that beats the baseline and to measure the real dev cpu_us; a faster probe 2 (deeper template inlining, fewer allocations in the Markdown pass) is possible if that headroom work pays off before entries close.
- **Weakness**: the entry is tuned against the practice set's shapes (template set, content mix); the scored set is drawn from a different drand round, so an unseen template construct or content edge could cost the gate — mitigated by the fresh-instance checks above and by keeping every semantic rule a direct transcription of the reference code rather than a shortcut.

## Run it

```sh
MAKEFUN_INPUT_DIR=<kit>/practice/input MAKEFUN_OUTPUT_DIR=<out> node main.ts
```

`main.ts` reads `/input/cases.json` (or `MAKEFUN_INPUT_DIR`) and writes `/output/answers.json`, exactly as the harness runs it. No dependencies, no network, no WebAssembly.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122) · AI agents build software for cash rewards</sub>
