# Test and build timing review

Measured locally on 2026-10-17 with Node v24.15.0, Vitest v5.0.3, and 20 available
logical CPUs. Results are specific to this host, not a Linux-vs-Windows benchmark.

## Findings

- Frontend tests spend substantial aggregate worker time creating jsdom for 65
  files. In the original run, the full suite took 8.76 seconds and environment
  setup represented 49% of tracked work. That percentage includes parallel work;
  it is not half the wall-clock duration.
- Six interleaved A/B pairs moved 19 pure-logic files to the Node environment,
  preserving file isolation and every assertion. Median full-suite wall time was
  **9.125 s baseline vs 9.122 s candidate**. Two-sided paired sign-flip p = **0.375**;
  there was no statistically supported improvement. The candidate was reverted.
  The unchanged `npm run build` control medians were 1.113 s and 1.139 s.
- `vmThreads` was rejected before timing comparison: three existing tests failed
  because `ReadableStream` or `crypto.subtle` was missing in that environment.
  A four-worker threads smoke test passed, but offered no promising preliminary
  improvement and was not adopted. Isolation was never disabled.
- The initial Rust test build downloaded/compiled dependencies and took **1m 12s**;
  the 97 baseline tests themselves took **0.45s**. Subsequent source-change builds
  observed here took a few seconds. These cold/warm observations are diagnostic,
  not a controlled A/B estimate of a CI speedup.
- The shared `/tmp` tmpfs filled during a subsequent compile. This task's generated
  Cargo target directory (about 3.2 GiB then) was moved to a dedicated directory on
  `/var/tmp`, where sufficient disk space was available. No unrelated files were
  removed. A dedicated `CARGO_TARGET_DIR` on disk avoids repeating that capacity
  failure; it is not claimed to make compilation faster.

The existing runner configuration is retained because the measured alternatives
did not establish a safe speedup. Frontend production builds already take around
one second here.

## Practical development workflow

Run the changed area while editing, then all required checks before a PR:

```bash
npm test -- src/core/notify.test.ts
npm exec vitest -- src/core/notify.test.ts
cargo test --manifest-path src-tauri/Cargo.toml --locked now_playing
```

The second command uses watch mode, retaining transforms between edits. The focused
notification suite took about 0.8 seconds here; it is a smaller workload, not a
replacement for the full suite. Keep the Rust target directory between runs and
build the frontend bundles before Rust tests that embed them.

The CI workflows currently recreate Rust build state. Dependency/target caching is
a potential follow-up, but no CI cache speedup or cross-platform timing was verified
in this review. A cache change should be measured on the actual runners and must not
mix untrusted PR artifacts into signing/release jobs.
