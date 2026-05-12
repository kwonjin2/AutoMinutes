#!/usr/bin/env node
// Mode A (multitrack) regression bench — guards the perf baseline established
// in commit cd9b4be ("perf: 전사 파이프라인 속도 약 2배 개선 — 20분 → 10분 @ 5h 오디오").
//
// Two layers of protection:
//
// 1. Static code-path check
//    Reads transcribe.js as text and asserts the four perf load-bearing
//    markers (greedy decode flags `-bs/-bo`, explicit `-t` thread flag,
//    `runWithConcurrency` worker pool, dynamic `detectThreads/detectConcurrency`)
//    are still present. Catches accidental removal during S2/S9-style refactors
//    even when no real audio is on hand.
//
// 2. Dynamic micro-bench (optional)
//    Synthesizes a tiny 4-track multitrack fixture (4 × N seconds, default 30s)
//    in an isolated scratch dir, runs transcribe.js against it, measures wall
//    time, and reports throughput as ×realtime. If you have a real 5h fixture,
//    point at it with `--from-dir <path>` to reproduce the headline 30× / 10min
//    figure on M4 Pro / 24GB.
//
// Usage:
//   node bench/mode_a_regression.js                 # synth fixture, 30s × 4
//   node bench/mode_a_regression.js --seconds 60    # longer synth fixture
//   node bench/mode_a_regression.js --from-dir DIR  # use real recordings
//   node bench/mode_a_regression.js --static-only   # skip dynamic measurement
//   node bench/mode_a_regression.js --keep          # keep scratch dir for debugging
//
// Tunables (env):
//   BENCH_MIN_RATIO  Minimum acceptable throughput (×realtime). Default 5.
//                    For headline M4 Pro / large-v3-turbo we expect ≥ 20.
//                    For tiny model on synth fixture, expect ≥ 50.
//   WHISPER_MODEL    Picked up by transcribe.js. Bench respects whatever you set.
//
// Exit codes:
//   0  All checks pass (or skipped with WARN).
//   1  Static regression detected, or dynamic ratio below floor.

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync, spawnSync } = require("child_process");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const REPO_ROOT = path.resolve(__dirname, "..");
const TRANSCRIBE_JS = path.join(REPO_ROOT, "transcribe.js");
const WHISPER_DIR = path.join(REPO_ROOT, "whisper.cpp");
const WHISPER_CLI = path.join(WHISPER_DIR, "build", "bin", "whisper-cli");
const NODE_MODULES = path.join(REPO_ROOT, "node_modules");

const ARGS = parseArgs(process.argv.slice(2));
const MIN_RATIO = parseFloat(process.env.BENCH_MIN_RATIO || "5");

const C = process.stdout.isTTY
  ? {
      reset: "\x1b[0m",
      bold: "\x1b[1m",
      green: "\x1b[32m",
      yellow: "\x1b[33m",
      red: "\x1b[31m",
      cyan: "\x1b[36m",
      dim: "\x1b[2m",
    }
  : { reset: "", bold: "", green: "", yellow: "", red: "", cyan: "", dim: "" };

function parseArgs(argv) {
  const out = {
    seconds: 30,
    fromDir: null,
    keep: false,
    staticOnly: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--seconds") {
      out.seconds = parseInt(argv[++i], 10);
      if (!Number.isFinite(out.seconds) || out.seconds < 5) {
        console.error("--seconds must be ≥ 5");
        process.exit(2);
      }
    } else if (a === "--from-dir") {
      out.fromDir = path.resolve(argv[++i]);
    } else if (a === "--keep") {
      out.keep = true;
    } else if (a === "--static-only") {
      out.staticOnly = true;
    } else if (a === "-h" || a === "--help") {
      console.log(
        "Usage: node bench/mode_a_regression.js [--seconds N] [--from-dir DIR] [--static-only] [--keep]",
      );
      process.exit(0);
    } else {
      console.error(`Unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

// ---------------- Static check ----------------

const STATIC_MARKERS = [
  {
    name: "greedy decode flag -bs",
    re: /["']-bs["']/,
    why: "perf cd9b4be: -bs 1 cuts beam search overhead by ~2×",
  },
  {
    name: "greedy decode flag -bo",
    re: /["']-bo["']/,
    why: "perf cd9b4be: -bo 1 cuts best-of overhead by ~2×",
  },
  {
    name: "explicit thread flag -t",
    re: /"-t"/,
    why: "perf cd9b4be: without -t, whisper-cli defaults to 4 threads (~4× slower on M4 Pro)",
  },
  {
    name: "worker pool runWithConcurrency",
    re: /runWithConcurrency\s*\(/,
    why: "perf cd9b4be: parallel processing of N tracks (vs serial spawnSync)",
  },
  {
    name: "dynamic detectThreads()",
    re: /function\s+detectThreads/,
    why: "perf cd9b4be: per-host P-core detection",
  },
  {
    name: "dynamic detectConcurrency()",
    re: /function\s+detectConcurrency/,
    why: "perf cd9b4be: per-host RAM-based concurrency cap",
  },
  {
    name: "Mode A output file meeting_with_speakers.txt",
    re: /meeting_with_speakers\.txt/,
    why: "Mode A output contract — summarize.js depends on this filename",
  },
];

function staticCheck() {
  console.log(`${C.bold}[static] transcribe.js perf-marker check${C.reset}`);
  if (!fs.existsSync(TRANSCRIBE_JS)) {
    console.log(`  ${C.red}✗${C.reset} ${TRANSCRIBE_JS} not found`);
    return { ok: false, missing: ["transcribe.js"] };
  }
  const src = fs.readFileSync(TRANSCRIBE_JS, "utf8");
  const missing = [];
  for (const m of STATIC_MARKERS) {
    const found = m.re.test(src);
    const sym = found ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`;
    console.log(`  ${sym} ${m.name}`);
    if (!found) {
      missing.push(m);
      console.log(`      ${C.dim}why: ${m.why}${C.reset}`);
    }
  }
  return { ok: missing.length === 0, missing: missing.map((m) => m.name) };
}

// ---------------- Dynamic prerequisites ----------------

function checkPrereqs() {
  const issues = [];
  const ok = (m) => console.log(`  ${C.green}✓${C.reset} ${m}`);
  const warn = (m) => {
    console.log(`  ${C.yellow}⚠${C.reset} ${m}`);
    issues.push(m);
  };

  console.log(`${C.bold}[dynamic] prerequisite check${C.reset}`);
  // ffmpeg
  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
    ok("ffmpeg available on PATH");
  } catch {
    warn("ffmpeg not found — cannot synthesize fixture");
  }
  // whisper-cli
  if (fs.existsSync(WHISPER_CLI)) {
    ok(`whisper-cli built: ${WHISPER_CLI}`);
  } else {
    warn(`whisper-cli not built (${WHISPER_CLI}) — run ./setup.sh`);
  }
  // model
  const modelName = process.env.WHISPER_MODEL || "large-v3-turbo";
  const modelPath = path.join(WHISPER_DIR, "models", `ggml-${modelName}.bin`);
  if (fs.existsSync(modelPath)) {
    const sizeMB = (fs.statSync(modelPath).size / 1024 / 1024).toFixed(0);
    ok(`whisper model: ggml-${modelName}.bin (${sizeMB} MB)`);
  } else {
    warn(`whisper model not found (${modelPath})`);
  }
  return { ok: issues.length === 0, issues };
}

// ---------------- Fixture synthesis ----------------

function synthFixture(scratchDir, seconds) {
  // 4 sine-wave tracks at distinct frequencies to give whisper-cli something
  // structured to consume without producing meaningful Korean text. We don't
  // care what is transcribed — only that the full pipeline (ffmpeg → whisper
  // → JSON parse → dedup → output) executes.
  const recordings = path.join(scratchDir, "recordings");
  fs.mkdirSync(recordings, { recursive: true });

  const speakers = ["alice", "bob", "carol", "dave"];
  const freqs = [220, 277, 329, 415]; // A3, C#4, E4, G#4
  for (let i = 0; i < speakers.length; i += 1) {
    const out = path.join(recordings, `${i + 1}-${speakers[i]}.flac`);
    // -f lavfi sine source, then encode to FLAC. 16kHz mono to skip a
    // resample step inside ffmpeg pipeline.
    const cmd =
      `ffmpeg -hide_banner -loglevel error -y ` +
      `-f lavfi -i "sine=frequency=${freqs[i]}:sample_rate=16000:duration=${seconds}" ` +
      `-ac 1 -ar 16000 -c:a flac "${out}"`;
    execSync(cmd, { stdio: "inherit" });
  }
  return recordings;
}

// ---------------- Scratch workspace ----------------

function makeScratchDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meeting-ai-bench-"));
  // Symlink whisper.cpp + node_modules so transcribe.js (which uses cwd)
  // resolves them without us having to copy 1.6 GB of model.
  fs.symlinkSync(WHISPER_DIR, path.join(dir, "whisper.cpp"), "dir");
  fs.symlinkSync(NODE_MODULES, path.join(dir, "node_modules"), "dir");
  return dir;
}

function cleanupScratch(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) {
    console.error(`  ${C.yellow}⚠${C.reset} failed to clean ${dir}: ${e.message}`);
  }
}

// ---------------- Run transcribe.js ----------------

function runTranscribe(scratchDir) {
  const env = { ...process.env };
  // Don't let bench inherit any local rate-limit overrides that could distort
  // the measurement, but DO respect the user's WHISPER_MODEL choice.
  delete env.WHISPER_THREADS;
  delete env.WHISPER_CONCURRENCY;
  // Force the spawned node process to load .env from the repo root so
  // WHISPER_MODEL / WHISPER_LANG (S9) propagate.
  env.DOTENV_CONFIG_PATH = path.join(REPO_ROOT, ".env");

  const t0 = process.hrtime.bigint();
  const result = spawnSync(process.execPath, [TRANSCRIBE_JS], {
    cwd: scratchDir,
    env,
    stdio: "inherit",
  });
  const t1 = process.hrtime.bigint();
  const wallSeconds = Number(t1 - t0) / 1e9;
  return { wallSeconds, status: result.status, signal: result.signal };
}

// ---------------- Output verification ----------------

function inspectOutput(scratchDir, expectedSpeakers) {
  const meetingTxt = path.join(scratchDir, "transcripts", "meeting_with_speakers.txt");
  if (!fs.existsSync(meetingTxt)) {
    return { ok: false, reason: `${meetingTxt} not produced` };
  }
  const text = fs.readFileSync(meetingTxt, "utf8");
  // Even on silent/sine input the file should exist (possibly empty) and
  // every non-blank line should match the [speaker]: format.
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  for (const line of lines) {
    if (!/^\[[^\]]+\]:\s/.test(line)) {
      return { ok: false, reason: `malformed line: ${line.slice(0, 80)}` };
    }
  }
  // Speaker convention: filename "<idx>-<name>.flac" → speaker "<name>".
  // Don't fail if no speech was detected (silent fixture); just report what
  // showed up so the user can sanity-check.
  const seen = new Set();
  for (const line of lines) {
    const m = line.match(/^\[([^\]]+)\]:/);
    if (m) seen.add(m[1]);
  }
  return {
    ok: true,
    lineCount: lines.length,
    speakersSeen: [...seen],
    expectedSpeakers,
  };
}

// ---------------- Audio duration probe ----------------

function totalAudioSeconds(dir) {
  const files = fs.readdirSync(dir).filter((f) => /\.(flac|wav|mp3)$/i.test(f));
  let total = 0;
  for (const f of files) {
    try {
      const out = execSync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${path.join(dir, f)}"`,
        { encoding: "utf8" },
      );
      const sec = parseFloat(out.trim());
      if (Number.isFinite(sec)) total += sec;
    } catch {
      /* ignore */
    }
  }
  return total;
}

// ---------------- Main ----------------

function main() {
  console.log(`${C.bold}${C.cyan}meeting-ai Mode A regression bench${C.reset}`);
  console.log("─".repeat(60));

  const stat = staticCheck();
  console.log("");

  if (ARGS.staticOnly) {
    if (stat.ok) {
      console.log(`${C.green}✓ static perf-marker check passed (--static-only)${C.reset}`);
      process.exit(0);
    } else {
      console.log(
        `${C.red}✗ static perf regression: ${stat.missing.join(", ")}${C.reset}`,
      );
      process.exit(1);
    }
  }

  const pre = checkPrereqs();
  console.log("");
  if (!pre.ok) {
    console.log(
      `${C.yellow}⚠ skipping dynamic measurement — fix prereqs above and re-run.${C.reset}`,
    );
    console.log(
      `  Static check ${stat.ok ? `${C.green}passed${C.reset}` : `${C.red}FAILED${C.reset}`}.`,
    );
    process.exit(stat.ok ? 0 : 1);
  }

  // Choose recordings source.
  let scratchDir;
  let recordingsDir;
  let synthesizedHere = false;
  if (ARGS.fromDir) {
    if (!fs.existsSync(ARGS.fromDir)) {
      console.error(`${C.red}✗ --from-dir not found: ${ARGS.fromDir}${C.reset}`);
      process.exit(2);
    }
    scratchDir = makeScratchDir();
    const linkedRecordings = path.join(scratchDir, "recordings");
    fs.symlinkSync(ARGS.fromDir, linkedRecordings, "dir");
    recordingsDir = linkedRecordings;
    console.log(
      `${C.bold}[fixture]${C.reset} using existing recordings: ${ARGS.fromDir}`,
    );
  } else {
    scratchDir = makeScratchDir();
    console.log(
      `${C.bold}[fixture]${C.reset} synthesizing 4 tracks × ${ARGS.seconds}s sine into ${scratchDir}/recordings`,
    );
    recordingsDir = synthFixture(scratchDir, ARGS.seconds);
    synthesizedHere = true;
  }

  const audioSec = totalAudioSeconds(recordingsDir);
  console.log(
    `${C.bold}[fixture]${C.reset} total audio = ${audioSec.toFixed(1)}s (${(audioSec / 60).toFixed(2)} min)`,
  );
  console.log("");

  let exitCode = 0;
  let runResult;
  let outResult;
  try {
    console.log(`${C.bold}[run] node transcribe.js (cwd=${scratchDir})${C.reset}`);
    runResult = runTranscribe(scratchDir);
    console.log("");
    outResult = inspectOutput(
      scratchDir,
      synthesizedHere ? ["alice", "bob", "carol", "dave"] : null,
    );
  } finally {
    if (!ARGS.keep) {
      cleanupScratch(scratchDir);
    } else {
      console.log(`${C.dim}[bench] keeping scratch dir: ${scratchDir}${C.reset}`);
    }
  }

  // ---- Report ----
  console.log("─".repeat(60));
  console.log(`${C.bold}Result${C.reset}`);
  console.log("─".repeat(60));

  if (runResult.status !== 0) {
    console.log(
      `${C.red}✗ transcribe.js exited with status=${runResult.status}` +
        (runResult.signal ? ` signal=${runResult.signal}` : "") +
        `${C.reset}`,
    );
    exitCode = 1;
  } else {
    console.log(`${C.green}✓ transcribe.js exited 0${C.reset}`);
  }

  if (!outResult.ok) {
    console.log(`${C.red}✗ output check failed: ${outResult.reason}${C.reset}`);
    exitCode = 1;
  } else {
    console.log(
      `${C.green}✓ meeting_with_speakers.txt produced${C.reset} ` +
        `(${outResult.lineCount} lines, speakers seen: [${outResult.speakersSeen.join(", ") || "none — silent/sine input"}])`,
    );
  }

  const wall = runResult.wallSeconds;
  const ratio = audioSec > 0 ? audioSec / wall : 0;
  console.log("");
  console.log(`  wall time     : ${wall.toFixed(2)}s`);
  console.log(`  audio total   : ${audioSec.toFixed(2)}s`);
  console.log(
    `  throughput    : ${C.bold}${ratio.toFixed(1)}× realtime${C.reset}` +
      `   (floor: ${MIN_RATIO}× via BENCH_MIN_RATIO)`,
  );
  console.log("");
  console.log(
    `  Mode A baseline (M4 Pro 24GB / large-v3-turbo / 5h × 4spk): ~30× realtime`,
  );
  console.log(
    `  See docs/PERFORMANCE.md for the full reference and how to verify against`,
  );
  console.log(`  your real 5h fixture (${C.cyan}--from-dir${C.reset}).`);

  if (ratio < MIN_RATIO) {
    console.log(
      `\n${C.red}✗ throughput ${ratio.toFixed(1)}× below floor ${MIN_RATIO}× — possible regression${C.reset}`,
    );
    exitCode = 1;
  } else {
    console.log(
      `\n${C.green}✓ throughput ${ratio.toFixed(1)}× ≥ floor ${MIN_RATIO}×${C.reset}`,
    );
  }

  if (!stat.ok) {
    console.log(
      `\n${C.red}✗ static check FAILED: missing ${stat.missing.join(", ")}${C.reset}`,
    );
    exitCode = 1;
  }

  process.exit(exitCode);
}

main();
