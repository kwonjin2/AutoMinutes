require("dotenv").config();
const fs = require("fs");
const path = require("path");
const FormData = require("form-data");
const axios = require("axios");

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// [보안] 테스트 환경에서는 데이터를 쏘지 않게 TEST_MODE 설정
// 실제 서버에 쏘고 싶다면 환경 변수(TEST_MODE=false)로 주입해주세요.
const TEST_MODE = process.env.TEST_MODE !== "false";

async function testSendFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log(`❌ 파일을 찾을 수 없습니다: ${filePath}`);
    process.exitCode = 1;
    return;
  }

  if (!DISCORD_WEBHOOK_URL) {
    console.log(
      "⏭️  DISCORD_WEBHOOK_URL 미설정 → 디스코드 업로드를 스킵합니다.",
    );
    return;
  }

  console.log(`📡 디스코드로 전송 시도 중: ${filePath}`);
  
  // 당일 날짜 기반 동적 제목 생성 (예: 2026-03-19 회의록)
  const today = new Date();
  const pad = (num) => String(num).padStart(2, '0');
  const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const header = `📋 ${todayStr} 회의록`;

  if (TEST_MODE) {
    console.log(
      "🚨 [TEST_MODE] 테스트 모드가 활성화되어 있습니다. 실제 디스코드로 전송하지 않습니다.",
    );
    console.log(`  (가상 전송 제목: ${header})`);
    return;
  }

  try {
    const formData = new FormData();
    formData.append("content", header);
    formData.append("file", fs.createReadStream(filePath));

    const res = await axios.post(DISCORD_WEBHOOK_URL, formData, {
      headers: formData.getHeaders(),
    });

    if (res.status === 200 || res.status === 204) {
      console.log("✅ 디스코드 파일 전송 성공!");
    } else {
      console.log(`⚠️ 전송 실패 (상태 코드): ${res.status}`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.log(`❌ 테스트 중 오류 발생:`, error.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  const targetFile = path.join(__dirname, "transcripts", "meeting_summary.md");
  testSendFile(targetFile);
}

module.exports = { testSendFile };
