const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync, spawn } = require("child_process");

// setup.sh 가 .env 에 기록한 WHISPER_MODEL 을 픽업하기 위해 dotenv 로딩.
require("dotenv").config();

// [설정] 경로를 본인의 환경에 맞게 확인하세요.
const BASE_DIR = process.cwd();
const WHISPER_CLI = path.join(
  BASE_DIR,
  "whisper.cpp",
  "build",
  "bin",
  "whisper-cli",
);
const MODEL_NAME = process.env.WHISPER_MODEL || "large-v3-turbo";
const MODEL_PATH = path.join(
  BASE_DIR,
  "whisper.cpp",
  "models",
  `ggml-${MODEL_NAME}.bin`,
);
// 기본값 ko: 한국어 회의가 1차 시나리오. 다국어/영어 회의는 .env 에서 WHISPER_LANG 변경.
// "auto" 는 whisper.cpp 의 자동 언어 감지.
const WHISPER_LANG = process.env.WHISPER_LANG || "ko";
const INPUT_DIR = "recordings";
const OUTPUT_DIR = "transcripts";

// ffmpeg가 16kHz mono WAV 로 정규화한 뒤 whisper-cli 에 넘기므로 ffmpeg가
// 디코드 가능한 포맷이면 동작하지만, 실제로 검증한 화이트리스트만 받는다.
const AUDIO_EXTENSIONS = new Set([".flac", ".wav", ".mp3"]);

// Apple Silicon은 P-core 수를 우선 사용, 그 외 플랫폼은 논리 코어 - 2.
// OS 및 다른 프로세스 여유로 코어 1~2개는 비워둠.
function detectThreads() {
  const envOverride = parseInt(process.env.WHISPER_THREADS, 10);
  if (Number.isFinite(envOverride) && envOverride > 0) return envOverride;

  if (process.platform === "darwin") {
    try {
      const pCores = parseInt(
        execSync("sysctl -n hw.perflevel0.physicalcpu", { encoding: "utf8" }).trim(),
        10,
      );
      if (Number.isFinite(pCores) && pCores > 0) {
        return Math.max(2, Math.min(pCores - 1, 12));
      }
    } catch {
      // sysctl 미지원 환경 → fallback
    }
  }
  const logical = os.cpus().length;
  return Math.max(2, Math.min(logical - 2, 12));
}

// Whisper 인스턴스당 모델 ~1.5GB + working ~1GB ≈ 2.5GB. OS용 4GB 여유.
// Apple Silicon은 Metal GPU가 직렬화되므로 2 이상으로 늘려도 큰 이득 없음.
function detectConcurrency() {
  const envOverride = parseInt(process.env.WHISPER_CONCURRENCY, 10);
  if (Number.isFinite(envOverride) && envOverride > 0) return envOverride;

  const totalGB = os.totalmem() / 1024 ** 3;
  const memBased = Math.floor((totalGB - 4) / 3);
  return Math.max(1, Math.min(memBased, 2));
}

const THREADS = detectThreads();
const CONCURRENCY = detectConcurrency();

function runWhisperCli(wavPath, outputBase, prefix) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      WHISPER_CLI,
      [
        "-m",
        MODEL_PATH,
        "-f",
        wavPath,
        "-l",
        WHISPER_LANG,
        "-t",
        String(THREADS),
        "-bs",
        "1",
        "-bo",
        "1",
        "--output-json",
        "--output-file",
        outputBase,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    const prefixStream = (stream, dest) => {
      let buffer = "";
      stream.on("data", (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          if (line) dest.write(`${prefix} ${line}\n`);
        }
      });
      stream.on("end", () => {
        if (buffer) dest.write(`${prefix} ${buffer}\n`);
      });
    };
    prefixStream(child.stdout, process.stdout);
    prefixStream(child.stderr, process.stderr);

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`whisper-cli exited with code ${code}`));
    });
  });
}

async function transcribeFile(file) {
  const prefix = `[${file}]`;
  const inputPath = path.join(INPUT_DIR, file);
  const baseName = path.parse(file).name;

  let speaker = baseName;
  if (speaker.includes("-")) {
    speaker = speaker.split("-").slice(1).join("-");
  }

  // 임시 WAV 는 tmpdir 에 두어 입력이 .wav 일 때 원본과 충돌하지 않게 한다.
  const wavPath = path.join(
    os.tmpdir(),
    `autominutes-${process.pid}-${baseName}.wav`,
  );
  console.log(`${prefix} 🎵 변환 중 (16kHz mono WAV)...`);

  try {
    execSync(
      `ffmpeg -i "${inputPath}" -ar 16000 -ac 1 -c:a pcm_s16le "${wavPath}" -y`,
      { stdio: "ignore" },
    );
  } catch (error) {
    console.error(`${prefix} ❌ FFmpeg 변환 실패`, error.message);
    process.exitCode = 1;
    return [];
  }

  const outputBase = path.join(OUTPUT_DIR, baseName);
  const jsonFile = outputBase + ".json";

  if (fs.existsSync(jsonFile)) {
    console.log(`${prefix} ⏭️ 전사 결과가 이미 존재하여 건너뜁니다.`);
  } else {
    console.log(`${prefix} 🚀 [GPU 가속] 전사 시작 (Speaker: ${speaker})...`);
    try {
      await runWhisperCli(wavPath, outputBase, prefix);
    } catch (error) {
      console.error(`${prefix} ❌ whisper-cli 실행 중 에러: ${error.message}`);
      process.exitCode = 1;
    }
  }

  if (fs.existsSync(wavPath)) {
    fs.unlinkSync(wavPath);
  }

  const segments = [];
  if (!fs.existsSync(jsonFile)) {
    console.log(`${prefix} ⚠️ ${jsonFile} 생성에 실패했습니다.`);
    process.exitCode = 1;
    return segments;
  }

  const rawData = fs.readFileSync(jsonFile, "utf-8");
  let data;
  try {
    data = JSON.parse(rawData);
  } catch (e) {
    console.log(`${prefix} ⚠️ ${jsonFile} 파싱에 실패했습니다.`);
    process.exitCode = 1;
    return segments;
  }

  const results = data.transcription || data.segments || [];
  for (const trans of results) {
    const text = (trans.text || "").trim();
    let startTs = 0;
    if (trans.offsets && trans.offsets.from !== undefined) {
      startTs = trans.offsets.from / 1000;
    } else if (trans.start !== undefined) {
      startTs = trans.start / 1000;
    }
    if (text.length > 1 && !text.includes("MBC 뉴스")) {
      segments.push({ start: startTs, speaker, text });
    }
  }

  return segments;
}

async function runWithConcurrency(items, limit, fn) {
  const queue = items.slice();
  const results = [];
  const workerCount = Math.min(limit, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (queue.length) {
      const item = queue.shift();
      const r = await fn(item);
      results.push(r);
    }
  });
  await Promise.all(workers);
  return results;
}

async function runTranscription() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  if (!fs.existsSync(INPUT_DIR)) {
    console.log(`❌ ${INPUT_DIR} 폴더가 존재하지 않습니다.`);
    process.exitCode = 1;
    return;
  }

  const files = fs.readdirSync(INPUT_DIR);
  const audioFiles = files.filter((f) => {
    const ext = path.extname(f).toLowerCase();
    if (!AUDIO_EXTENSIONS.has(ext)) return false;
    // 화자별 트랙 옆에 놓인 합본(mixdown) meeting.* 은 단일 화자로 재전사되지
    // 않도록 스킵한다. 확장자만 다를 뿐 의미는 동일.
    return path.parse(f).name.toLowerCase() !== "meeting";
  });

  if (audioFiles.length === 0) {
    console.log(
      "❌ recordings 폴더에 분석할 오디오 파일이 없습니다 (.flac/.wav/.mp3).",
    );
    process.exitCode = 1;
    return;
  }

  if (!fs.existsSync(WHISPER_CLI)) {
    console.log(`❌ whisper-cli 엔진을 찾을 수 없습니다: ${WHISPER_CLI}`);
    process.exitCode = 1;
    return;
  }

  const totalGB = (os.totalmem() / 1024 ** 3).toFixed(1);
  console.log(
    `🖥️  환경 감지: ${process.platform}/${process.arch}, 논리코어 ${os.cpus().length}개, RAM ${totalGB}GB`,
  );
  console.log(
    `🚀 동시 ${CONCURRENCY}개 워커 × whisper 스레드 ${THREADS}개로 전사 시작 (총 ${audioFiles.length}개 파일)`,
  );
  const perFileSegments = await runWithConcurrency(
    audioFiles,
    CONCURRENCY,
    transcribeFile,
  );
  const conversationSegments = perFileSegments.flat();

  conversationSegments.sort((a, b) => a.start - b.start);

  const filteredSegments = [];
  const TIME_THRESHOLD = 2.0;
  const LONG_PHRASE_THRESHOLD = 60.0;
  const SHORT_PHRASE_THRESHOLD = 5.0;

  const BANNED_PHRASES = [
    "감사합니다",
    "MBC뉴스",
    "시청해주셔서감사합니다",
    "구독과좋아요",
    "알람설정",
    "오늘영상은여기까지입니다",
    "채널고정",
    "소리가안들려요",
  ];

  for (const seg of conversationSegments) {
    const cleanCurr = seg.text.replace(/[\s.?!,]/g, "");

    if (
      BANNED_PHRASES.some((phrase) => cleanCurr === phrase) ||
      cleanCurr.length <= 1
    ) {
      continue;
    }

    const isDuplicate = filteredSegments.some((prev) => {
      const timeDiff = Math.abs(prev.start - seg.start);
      const cleanPrev = prev.text.replace(/[\s.?!,]/g, "");

      if (timeDiff <= TIME_THRESHOLD) {
        return (
          cleanPrev === cleanCurr ||
          cleanPrev.includes(cleanCurr) ||
          cleanCurr.includes(cleanPrev)
        );
      }

      if (prev.speaker === seg.speaker) {
        if (cleanCurr.length >= 10 && timeDiff <= LONG_PHRASE_THRESHOLD) {
          return (
            cleanPrev === cleanCurr ||
            cleanPrev.includes(cleanCurr) ||
            cleanCurr.includes(cleanPrev)
          );
        }
        if (cleanCurr.length < 10 && timeDiff <= SHORT_PHRASE_THRESHOLD) {
          return cleanPrev === cleanCurr;
        }
      }

      return false;
    });

    if (!isDuplicate) {
      filteredSegments.push(seg);
    }
  }

  const combinedPath = path.join(OUTPUT_DIR, "meeting_with_speakers.txt");
  const fd = fs.openSync(combinedPath, "w");
  for (const seg of filteredSegments) {
    fs.writeSync(fd, `[${seg.speaker}]: ${seg.text}\n`);
  }
  fs.closeSync(fd);

  console.log(`\n✅ 고속 엔진 기반 회의록 생성 완료: ${combinedPath}`);
}

if (require.main === module) {
  runTranscription().catch((err) => {
    console.error(`❌ 에러:`, err);
    process.exitCode = 1;
  });
}

module.exports = { runTranscription };
