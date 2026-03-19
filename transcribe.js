const fs = require("fs");
const path = require("path");
const { execSync, spawnSync } = require("child_process");

// [설정] 경로를 본인의 환경에 맞게 확인하세요.
const BASE_DIR = process.cwd();
const WHISPER_CLI = path.join(
  BASE_DIR,
  "whisper.cpp",
  "build",
  "bin",
  "whisper-cli",
);
const MODEL_PATH = path.join(
  BASE_DIR,
  "whisper.cpp",
  "models",
  "ggml-large-v3-turbo.bin",
);
const INPUT_DIR = "recordings";
const OUTPUT_DIR = "transcripts";

function runTranscription() {
  // 1. 폴더 생성
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  if (!fs.existsSync(INPUT_DIR)) {
    console.log(`❌ ${INPUT_DIR} 폴더가 존재하지 않습니다.`);
    return;
  }

  // 전사할 FLAC 파일 목록 추출
  const files = fs.readdirSync(INPUT_DIR);
  const flacFiles = files.filter(
    (f) => f.endsWith(".flac") && f !== "meeting.flac",
  );

  if (flacFiles.length === 0) {
    console.log("❌ recordings 폴더에 분석할 .flac 파일이 없습니다.");
    return;
  }

  // 실행 파일 존재 여부 확인
  if (!fs.existsSync(WHISPER_CLI)) {
    console.log(`❌ whisper-cli 엔진을 찾을 수 없습니다: ${WHISPER_CLI}`);
    return;
  }

  const conversationSegments = [];

  for (const file of flacFiles) {
    const inputPath = path.join(INPUT_DIR, file);

    let speaker = file.replace(".flac", "");
    if (speaker.includes("-")) {
      // "1234-UserName.flac" 같은 형태라면 UserName만 추출
      speaker = speaker.split("-").slice(1).join("-");
    }

    // 1. FFmpeg로 16kHz WAV 변환 (whisper.cpp 필수 사양)
    const wavPath = inputPath.replace(".flac", ".wav");
    console.log(`🎵 ${file} 변환 중 (FLAC -> 16kHz WAV)...`);

    try {
      execSync(
        `ffmpeg -i "${inputPath}" -ar 16000 -ac 1 -c:a pcm_s16le "${wavPath}" -y`,
        { stdio: "ignore" },
      );
    } catch (error) {
      console.error(`❌ FFmpeg 변환 실패: ${file}`, error.message);
      continue;
    }

    console.log(`🚀 [GPU 가속] ${file} 전사 시작 (Speaker: ${speaker})...`);

    // 2. whisper.cpp 실행 (JSON 출력 모드)
    // whisper.cpp는 결과 파일명 뒤에 자동으로 .json을 붙입니다.
    const outputBase = path.join(OUTPUT_DIR, file.replace(".flac", ""));

    try {
      spawnSync(
        WHISPER_CLI,
        [
          "-m",
          MODEL_PATH,
          "-f",
          wavPath,
          "-l",
          "ko",
          "--output-json",
          "--output-file",
          outputBase,
        ],
        { stdio: "inherit" },
      );
    } catch (error) {
      console.error(`❌ whisper-cli 실행 중 에러: ${error.message}`);
    }

    // 3. 임시 WAV 파일 삭제
    if (fs.existsSync(wavPath)) {
      fs.unlinkSync(wavPath);
    }

    // 4. 생성된 JSON 결과 읽기
    const jsonFile = outputBase + ".json";
    if (fs.existsSync(jsonFile)) {
      const rawData = fs.readFileSync(jsonFile, "utf-8");
      let data;
      try {
        data = JSON.parse(rawData);
      } catch (e) {
        console.log(`⚠️ ${jsonFile} 파싱에 실패했습니다.`);
        continue;
      }

      // whisper.cpp의 다양한 JSON 구조에 대응 (transcription 혹은 segments)
      const results = data.transcription || data.segments || [];

      for (const trans of results) {
        const text = (trans.text || "").trim();
        // [중요] 오프셋 구조 확인: 'from' 혹은 'start'
        let startTs = 0;
        if (trans.offsets && trans.offsets.from !== undefined) {
          startTs = trans.offsets.from / 1000;
        } else if (trans.start !== undefined) {
          startTs = trans.start / 1000;
        }

        if (text.length > 1 && !text.includes("MBC 뉴스")) {
          conversationSegments.push({
            start: startTs,
            speaker: speaker,
            text: text,
          });
        }
      }
    } else {
      console.log(`⚠️ ${jsonFile} 생성에 실패했습니다.`);
    }
  }

  // 5. 시간순 정렬
  conversationSegments.sort((a, b) => a.start - b.start);

  // 6. 최종 통합 텍스트 파일 생성
  const combinedPath = path.join(OUTPUT_DIR, "meeting_with_speakers.txt");
  const fd = fs.openSync(combinedPath, "w");
  for (const seg of conversationSegments) {
    fs.writeSync(fd, `[${seg.speaker}]: ${seg.text}\n`);
  }
  fs.closeSync(fd);

  console.log(`\n✅ 고속 엔진 기반 회의록 생성 완료: ${combinedPath}`);
}

if (require.main === module) {
  runTranscription();
}

module.exports = { runTranscription };
