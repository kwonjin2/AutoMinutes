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
    const jsonFile = outputBase + ".json";

    // [개선] 이미 JSON 결과가 있다면 전사 과정을 건너뜁니다.
    if (fs.existsSync(jsonFile)) {
      console.log(`⏭️ ${file} 전사 결과가 이미 존재하여 건너뜁니다.`);
    } else {
      console.log(`🚀 [GPU 가속] ${file} 전사 시작 (Speaker: ${speaker})...`);
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
    }

    // 3. 임시 WAV 파일 삭제
    if (fs.existsSync(wavPath)) {
      fs.unlinkSync(wavPath);
    }

    // 4. 생성된 JSON 결과 읽기
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

  // 6. 중복 제거 및 환각어 필터링 로직
  const filteredSegments = [];
  const TIME_THRESHOLD = 2.0; // 타 화자 간 동일 문장 판단 (2초)
  const LONG_PHRASE_THRESHOLD = 60.0; // 긴 문장 반복 판단 (60초)
  const SHORT_PHRASE_THRESHOLD = 5.0; // 짧은 문장(추임새) 반복 판단 (5초)
  
  const BANNED_PHRASES = [
    "감사합니다", "MBC뉴스", "시청해주셔서감사합니다", "구독과좋아요", 
    "알람설정", "오늘영상은여기까지입니다", "채널고정", "소리가안들려요"
  ];

  for (const seg of conversationSegments) {
    const cleanCurr = seg.text.replace(/[\s.?!,]/g, "");
    
    // 1. 환각어 필터링
    if (BANNED_PHRASES.some(phrase => cleanCurr === phrase) || cleanCurr.length <= 1) {
      continue;
    }

    // 2. 중복 검사
    const isDuplicate = filteredSegments.some((prev) => {
      const timeDiff = Math.abs(prev.start - seg.start);
      const cleanPrev = prev.text.replace(/[\s.?!,]/g, "");

      // (A) 다른 화자가 비슷한 시간에 같은 말을 하는 경우 (Mic Bleed)
      if (timeDiff <= TIME_THRESHOLD) {
        return cleanPrev === cleanCurr || cleanPrev.includes(cleanCurr) || cleanCurr.includes(cleanPrev);
      }

      // (B) 동일 화자가 반복하는 경우
      if (prev.speaker === seg.speaker) {
        // 문장이 길면(10자 이상) 60초 이내 중복 시 제거 (환각 방어)
        if (cleanCurr.length >= 10 && timeDiff <= LONG_PHRASE_THRESHOLD) {
          return cleanPrev === cleanCurr || cleanPrev.includes(cleanCurr) || cleanCurr.includes(cleanPrev);
        }
        // 문장이 짧으면 5초 이내일 때만 제거 (정상적인 추임새 보호)
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

  // 7. 최종 통합 텍스트 파일 생성
  const combinedPath = path.join(OUTPUT_DIR, "meeting_with_speakers.txt");
  const fd = fs.openSync(combinedPath, "w");
  for (const seg of filteredSegments) {
    fs.writeSync(fd, `[${seg.speaker}]: ${seg.text}\n`);
  }
  fs.closeSync(fd);

  console.log(`\n✅ 고속 엔진 기반 회의록 생성 완료: ${combinedPath}`);
}

if (require.main === module) {
  runTranscription();
}

module.exports = { runTranscription };
