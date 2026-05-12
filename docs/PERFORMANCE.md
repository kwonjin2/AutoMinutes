# Performance baseline (Mode A multitrack)

This document fixes the perf contract for Mode A — N speaker-separated audio
files in `recordings/` → one combined `transcripts/meeting_with_speakers.txt`.
Any change that crosses this baseline downward is a release blocker per
seed exit condition `regression_blocker`.

## Headline baseline

| Item                  | Value                                      |
| --------------------- | ------------------------------------------ |
| Hardware              | Apple M4 Pro / 24 GB unified memory        |
| OS                    | macOS 14+ (Apple Silicon, Metal backend)   |
| whisper.cpp build     | Metal + Apple Accelerate (BLAS) on         |
| Model                 | `ggml-large-v3-turbo.bin` (~1.6 GB)        |
| Workload              | 5 hours wall × 4 speakers (4 FLAC tracks)  |
| **Wall time**         | **~10 minutes**                            |
| **Throughput**        | **~30× realtime**                          |
| Established by commit | `cd9b4be` (perf: 20분 → 10분 @ 5h 오디오)  |

Pre-`cd9b4be` baseline was ~20 minutes (≈15× realtime). Anything slower than
~15 minutes / ~20× realtime on the reference hardware is treated as a regression.

## Why this is fast

`transcribe.js` carries four load-bearing optimizations. The `bench/` static
check guards each one by name; the perf review is at `cd9b4be`'s commit message.

1. **Greedy decode** — `-bs 1 -bo 1` flags on `whisper-cli`. Korean meeting
   transcript quality is unchanged vs. the default beam-5/best-of-5; speed
   roughly doubles.
2. **Explicit `-t` thread flag** — without it `whisper-cli` defaults to 4
   threads, leaving M4 Pro's 10 P-cores idle.
3. **`runWithConcurrency` worker pool** — N tracks transcribe in parallel via
   `child_process.spawn` Promise wrappers (default concurrency = 2 on Apple
   Silicon, where the Metal GPU serializes anyway).
4. **Dynamic sizing** — `detectThreads()` reads `hw.perflevel0.physicalcpu` on
   macOS, falls back to `cpus().length - 2` elsewhere; `detectConcurrency()`
   sizes from RAM (`(totalGB - 4) / 3`, capped at 2). Both honor
   `WHISPER_THREADS` / `WHISPER_CONCURRENCY` env overrides.

## How to verify

### Quick (every PR, no real audio required)

```bash
npm run bench:static    # static check only — no whisper-cli, no model
```

This reads `transcribe.js` as text and asserts the four optimization markers
above are still present. Catches accidental removal during sibling refactors
(S2 input contract, S9 lang env, etc.) in under a second.

### Synthetic micro-bench (sanity)

```bash
npm run bench
# or with a longer fixture:
node bench/mode_a_regression.js --seconds 60
```

Synthesizes 4 sine-wave FLAC tracks in a temp dir, runs the full pipeline
(ffmpeg → whisper-cli → JSON parse → dedup → combined output), and reports
throughput as ×realtime. The numbers are not directly comparable to the 5h
headline — sine-wave audio gives whisper-cli very little to chew on, so the
ratio is artificially high — but a *break* (transcribe.js exits non-zero,
output file missing, or throughput collapses) is caught immediately.

Default floor is 5× realtime via `BENCH_MIN_RATIO`. Bump it for tighter
guard on M4-class hardware:

```bash
BENCH_MIN_RATIO=20 npm run bench
```

### Full regression (release gate)

The headline 5h × 4-speaker measurement remains a manual user step — we don't
ship 5 hours of test audio in the repo. Use:

```bash
node bench/mode_a_regression.js --from-dir /path/to/your/5h-recordings
```

…against a real multitrack recording (e.g., a Craig export, or any prior
production input). The script measures wall time end-to-end and prints the
×realtime ratio, which you compare to the table above.

### Acceptance bar (release v1.0)

| Check                                            | Floor                                           |
| ------------------------------------------------ | ----------------------------------------------- |
| `npm run bench:static`                           | exit 0 (all 7 markers found)                    |
| `npm run bench` (synth, default)                 | exit 0, throughput ≥ 5× realtime                |
| `bench --from-dir <real-5h>` on M4 Pro / 24GB    | wall ≤ ~15 min, throughput ≥ ~20× realtime      |
| `bench --from-dir <real-5h>` on M4 Pro / 24GB    | output `meeting_with_speakers.txt` byte-identical to pre-change run, modulo whisper nondeterminism |

## Other hardware (informational, not gates)

These are reported figures, not enforced floors. The release gate above is
M4 Pro / 24GB only.

| Hardware                   | Model              | 5h × 4spk wall  | ×realtime    |
| -------------------------- | ------------------ | --------------- | ------------ |
| M4 Pro / 24 GB (reference) | large-v3-turbo     | ~10 min         | ~30×         |
| M2 / 16 GB                 | large-v3-turbo     | ~30 min (est.)  | ~10×         |
| Linux + RTX 4090 / 32 GB   | large-v3-turbo     | not yet measured| —            |
| Linux CPU only / 16 GB     | large-v3-turbo     | not recommended | <1×          |

If you measure on hardware not listed here, please open a PR adding a row.

## What is *not* in scope

- Mode B (single-track + speaker diarization) — explicitly out of v1.0 per the
  seed (`scope_creep_block`).
- Summarize-step timing (Gemini API latency dominates, not local).
- Upload-step timing (network bound).
