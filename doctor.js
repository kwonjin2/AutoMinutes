#!/usr/bin/env node
// AutoMinutes doctor — 의존성/설정 헬스 체크.
// 필수 항목 누락 시 exit 1, 선택 항목만 비어 있으면 exit 0 (자동 스킵 예정).
//
// 사용:
//   npm run doctor

require("dotenv").config();
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

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

const REPO_ROOT = process.cwd();
const REQUIRED_NODE_MAJOR = 18;

const STATUS = { OK: "ok", WARN: "warn", FAIL: "fail" };
const results = [];

function record(name, status, message, severity /* required | optional */) {
  results.push({ name, status, message, severity });
}

function symbol(status) {
  if (status === STATUS.OK) return `${C.green}✓${C.reset}`;
  if (status === STATUS.WARN) return `${C.yellow}⚠${C.reset}`;
  return `${C.red}✗${C.reset}`;
}

function which(cmd) {
  try {
    return execSync(`command -v ${cmd}`, { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

// 1. Node 버전
(function checkNode() {
  const v = process.versions.node;
  const major = parseInt(v.split(".")[0], 10);
  if (major >= REQUIRED_NODE_MAJOR) {
    record("Node.js", STATUS.OK, `v${v} (≥ ${REQUIRED_NODE_MAJOR} 요구 충족)`, "required");
  } else {
    record(
      "Node.js",
      STATUS.FAIL,
      `v${v} — Node.js ${REQUIRED_NODE_MAJOR}+ 가 필요합니다.`,
      "required",
    );
  }
})();

// 2. FFmpeg
(function checkFfmpeg() {
  const p = which("ffmpeg");
  if (p) {
    record("FFmpeg", STATUS.OK, p, "required");
  } else {
    record(
      "FFmpeg",
      STATUS.FAIL,
      "PATH 에서 찾을 수 없습니다. macOS: `brew install ffmpeg`, Debian/Ubuntu: `sudo apt install ffmpeg`",
      "required",
    );
  }
})();

// 3. whisper-cli
(function checkWhisperCli() {
  const cli = path.join(REPO_ROOT, "whisper.cpp", "build", "bin", "whisper-cli");
  if (!fs.existsSync(cli)) {
    record(
      "whisper-cli",
      STATUS.FAIL,
      `${cli} 가 없습니다. \`./setup.sh\` 로 빌드하세요.`,
      "required",
    );
    return;
  }
  try {
    fs.accessSync(cli, fs.constants.X_OK);
    record("whisper-cli", STATUS.OK, cli, "required");
  } catch {
    record(
      "whisper-cli",
      STATUS.FAIL,
      `${cli} 실행 권한이 없습니다. \`chmod +x ${cli}\` 또는 재빌드 필요.`,
      "required",
    );
  }
})();

// 4. Whisper 모델 파일
(function checkModel() {
  const modelName = process.env.WHISPER_MODEL || "large-v3-turbo";
  const modelFile = path.join(
    REPO_ROOT,
    "whisper.cpp",
    "models",
    `ggml-${modelName}.bin`,
  );
  if (fs.existsSync(modelFile)) {
    const sizeMB = (fs.statSync(modelFile).size / 1024 / 1024).toFixed(1);
    record("Whisper 모델", STATUS.OK, `${modelFile} (${sizeMB} MB, model=${modelName})`, "required");
  } else {
    record(
      "Whisper 모델",
      STATUS.FAIL,
      `${modelFile} 가 없습니다. \`bash whisper.cpp/models/download-ggml-model.sh ${modelName}\` 또는 \`./setup.sh\`.`,
      "required",
    );
  }
})();

// 5. .env 파일 + 필수 키
(function checkEnv() {
  const envPath = path.join(REPO_ROOT, ".env");
  if (!fs.existsSync(envPath)) {
    record(
      ".env",
      STATUS.FAIL,
      "루트에 .env 파일이 없습니다. `.env.example` 를 복사해 채우세요 (또는 `./setup.sh`).",
      "required",
    );
    return;
  }
  record(".env", STATUS.OK, envPath, "required");

  // 5-1. GEMINI_API_KEY 필수
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0) {
    record("GEMINI_API_KEY", STATUS.OK, "(설정됨)", "required");
  } else {
    record(
      "GEMINI_API_KEY",
      STATUS.FAIL,
      ".env 에 GEMINI_API_KEY 가 비어 있습니다. https://ai.google.dev 에서 키를 발급받아 채우세요.",
      "required",
    );
  }

  // 5-2. 업로드 토큰 (선택)
  const optionalGroups = [
    { label: "Discord", vars: ["DISCORD_WEBHOOK_URL"] },
    { label: "Notion", vars: ["NOTION_TOKEN", "NOTION_DATABASE_ID"] },
    { label: "GitHub Wiki", vars: ["GITHUB_PAT", "GITHUB_USERNAME", "GITHUB_REPO_NAME"] },
  ];
  for (const g of optionalGroups) {
    const missing = g.vars.filter(
      (v) => !process.env[v] || process.env[v].trim().length === 0,
    );
    if (missing.length === 0) {
      record(`${g.label} 업로드`, STATUS.OK, "(토큰 셋업됨)", "optional");
    } else if (missing.length === g.vars.length) {
      record(
        `${g.label} 업로드`,
        STATUS.WARN,
        `${missing.join("/")} 비어있음 → 자동 스킵 예정`,
        "optional",
      );
    } else {
      record(
        `${g.label} 업로드`,
        STATUS.WARN,
        `${missing.join("/")} 누락 — 그룹 전체가 비어있어야 자동 스킵, 부분 셋업이면 그룹 전체 미설정으로 처리됩니다`,
        "optional",
      );
    }
  }
})();

// --- 출력 ---
const headerBar = "━".repeat(60);
console.log(`\n${C.bold}AutoMinutes doctor${C.reset}`);
console.log(headerBar);
const nameWidth = Math.max(...results.map((r) => r.name.length));
let requiredFail = 0;
for (const r of results) {
  const sev = r.severity === "required" ? "" : `${C.dim} [선택]${C.reset}`;
  console.log(`  ${symbol(r.status)} ${r.name.padEnd(nameWidth)}${sev}  ${r.message}`);
  if (r.severity === "required" && r.status === STATUS.FAIL) requiredFail += 1;
}
console.log(headerBar);

const okCount = results.filter((r) => r.status === STATUS.OK).length;
const warnCount = results.filter((r) => r.status === STATUS.WARN).length;
const failCount = results.filter((r) => r.status === STATUS.FAIL).length;

console.log(
  `요약: ${C.green}✓ ${okCount}${C.reset}  ${C.yellow}⚠ ${warnCount}${C.reset}  ${C.red}✗ ${failCount}${C.reset}` +
    ` (필수 실패 ${requiredFail}건)`,
);

if (requiredFail > 0) {
  console.log(
    `\n${C.red}필수 항목이 누락되어 파이프라인이 정상 동작하지 않을 수 있습니다.${C.reset}`,
  );
  console.log(`해결 후 다시 실행: ${C.bold}npm run doctor${C.reset}`);
  process.exit(1);
} else if (warnCount > 0) {
  console.log(
    `\n${C.yellow}선택 업로드 채널이 비어있습니다 — 해당 단계는 자동으로 스킵됩니다.${C.reset}`,
  );
  process.exit(0);
} else {
  console.log(`\n${C.green}모든 항목이 준비되었습니다.${C.reset} \`npm run start\` 로 파이프라인을 실행하세요.`);
  process.exit(0);
}
