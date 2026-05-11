require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// API 키 설정
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

async function runSummarization() {
  try {
    const promptPath = path.join(__dirname, "prompt.md");
    const transcriptPath = path.join(
      __dirname,
      "transcripts",
      "meeting_with_speakers.txt",
    );

    // 1. 파일 로드
    let systemInstruction = "";
    if (fs.existsSync(promptPath)) {
      systemInstruction = fs.readFileSync(promptPath, "utf-8");
    } else {
      console.log("⚠️ prompt.md 파일을 찾을 수 없습니다. (비어서 진행)");
    }

    if (!fs.existsSync(transcriptPath)) {
      console.log(
        `❌ ${transcriptPath} 파일이 존재하지 않습니다. 먼저 transcribe를 진행해주세요.`,
      );
      process.exitCode = 1;
      return;
    }

    const transcript = fs.readFileSync(transcriptPath, "utf-8");

    console.log("🚀 Gemini 엔진(Gemini 3 Flash)으로 분석을 시작합니다...");

    // 멘티님의 기존 모델 설정 유지
    const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

    const prompt = `${systemInstruction}\n\n### 회의록 원본 ###\n${transcript}`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const summaryResult = response.text();

    console.log("\n✅ 분석 완료!");

    // 2. 결과 저장
    const summaryPath = path.join(
      __dirname,
      "transcripts",
      "meeting_summary.md",
    );
    fs.writeFileSync(summaryPath, summaryResult, "utf-8");

    // 3. 파일 정리 (디스코드 전송 없이 바로 아카이브 및 청소 실행)
    archiveAndCleanup();
  } catch (e) {
    console.error(`❌ 에러 발생:`, e);
    process.exitCode = 1;
  }
}

function archiveAndCleanup() {
  /**
   * 무거운 음성 파일과 JSON만 삭제하고, .txt 파일은 보존합니다.
   */
  const now = new Date();

  // YYYY-MM-DD
  const pad = (num) => String(num).padStart(2, "0");
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  // HHMMSS
  const timestamp = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

  // 보관용 폴더 생성
  const archiveDir = path.join(__dirname, "archived", dateStr);
  if (!fs.existsSync(archiveDir)) {
    fs.mkdirSync(archiveDir, { recursive: true });
  }

  // 1. 요약본(.md) 보관
  const summarySrc = path.join(__dirname, "transcripts", "meeting_summary.md");
  if (fs.existsSync(summarySrc)) {
    const archiveDest = path.join(archiveDir, `summary_${timestamp}.md`);
    fs.copyFileSync(summarySrc, archiveDest);
    console.log(`📦 요약본 아카이빙 완료: ${archiveDest}`);
  }

  // 2. recordings 내 .flac 삭제 (무거운 음성 파일)
  const recordingsDir = path.join(__dirname, "recordings");
  if (fs.existsSync(recordingsDir)) {
    const files = fs.readdirSync(recordingsDir);
    for (const file of files) {
      if (file.endsWith(".flac")) {
        fs.unlinkSync(path.join(recordingsDir, file));
        console.log(`🗑️ 음성 파일 삭제 완료: ${file}`);
      }
    }
  }

  // 3. transcripts 내 .json(중간 데이터)만 삭제
  // 멘티님의 요청대로 .txt 파일은 지우지 않고 유지합니다.
  const transcriptsDir = path.join(__dirname, "transcripts");
  if (fs.existsSync(transcriptsDir)) {
    const files = fs.readdirSync(transcriptsDir);
    for (const file of files) {
      if (file.endsWith(".json")) {
        fs.unlinkSync(path.join(transcriptsDir, file));
        console.log(`🗑️ 중간 JSON 데이터 삭제 완료: ${file}`);
      }
    }
  }

  console.log("✨ 작업 환경 정리 끝! (.txt 파일은 안전하게 보존되었습니다.)");
}

if (require.main === module) {
  runSummarization();
}

module.exports = { runSummarization };
