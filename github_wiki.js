require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// 환경 변수 읽기
const TOKEN = process.env.GITHUB_PAT;
const USER = process.env.GITHUB_USERNAME;
const REPO = process.env.GITHUB_REPO_NAME;

// [보안] 테스트 환경 모드
const TEST_MODE = process.env.TEST_MODE !== "false";

const WIKI_TEMP_DIR = "team_wiki_tmp";

function updateSidebar(wikiDir, pageNameNoExt) {
  const sidebarPath = path.join(wikiDir, "_Sidebar.md");
  const newLink = `- [[${pageNameNoExt}]]`;

  let content = "";
  if (fs.existsSync(sidebarPath)) {
    content = fs.readFileSync(sidebarPath, "utf-8");
  }

  // 중복 링크 체크
  if (content.includes(newLink)) {
    console.log(`ℹ️ 사이드바에 이미 '${pageNameNoExt}' 링크가 존재합니다.`);
    return;
  }

  // 1. 모든 줄바꿈을 단일화하고 앞뒤 공백 제거 (청소 작업)
  // filter(Boolean)으로 빈 줄을 일단 다 제거해서 '밀착' 상태로 만듭니다.
  let lines = content
    .split("\n")
    .map((l) => l.trim())
    .filter((line) => line !== "");

  // 2. 삽입 위치 찾기
  const summaryTag = "<summary>📅 회의록</summary>";
  const insertIndex = lines.findIndex((line) => line.includes(summaryTag));

  if (insertIndex !== -1) {
    /**
     * 핵심 로직:
     * - summaryTag 다음에 '빈 줄("")' 하나 넣고
     * - 그 다음에 '새 링크(newLink)'를 넣음
     * - 그 뒤에는 필터링된 기존 리스트들이 자동으로 붙음
     */
    lines.splice(insertIndex + 1, 0, "", newLink);
  } else {
    // 구조가 아예 없을 때 초기 생성
    lines = [
      "### 🛠️ 기술 스택",
      "- [[Frontend]]",
      "- [[Backend]]",
      "",
      "<details>",
      "<summary>📅 회의록</summary>",
      "",
      newLink,
      "</details>",
    ];
  }

  // 3. 최종 저장
  fs.writeFileSync(sidebarPath, lines.join("\n"), "utf-8");
  console.log("📝 사이드바(_Sidebar.md) 리스트 밀착 업데이트 완료");
}

function updateTeamWiki(summaryMdPath) {
  if (!fs.existsSync(summaryMdPath)) {
    console.log(`❌ 요약본 파일을 찾을 수 없습니다: ${summaryMdPath}`);
    process.exitCode = 1;
    return;
  }

  if (!TOKEN || !USER || !REPO) {
    console.log(
      "⏭️  GITHUB_PAT / GITHUB_USERNAME / GITHUB_REPO_NAME 중 하나 이상 미설정 → GitHub Wiki 업로드를 스킵합니다.",
    );
    return;
  }

  if (TEST_MODE) {
    console.log(
      `🚨 [TEST_MODE] 테스트 모드가 활성화되어 있습니다. 실제 Github Wiki 저장소에서 clone / push하지 않습니다.`,
    );
    return;
  }

  const teamWikiUrl = `https://${TOKEN}@github.com/${USER}/${REPO}.wiki.git`;

  if (!fs.existsSync(WIKI_TEMP_DIR)) {
    console.log("📂 팀 위키 클론 중...");
    execSync(`git clone ${teamWikiUrl} ${WIKI_TEMP_DIR}`, {
      stdio: "inherit",
    });
  } else {
    console.log("🔄 팀 위키 최신화 중...");
    execSync(`git -C ${WIKI_TEMP_DIR} pull`, { stdio: "inherit" });
  }

  const today = new Date();
  const pad = (num) => String(num).padStart(2, "0");
  const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

  const wikiPageName = `${todayStr}-회의록`;
  const wikiFileName = `${wikiPageName}.md`;
  const destPath = path.join(WIKI_TEMP_DIR, wikiFileName);

  fs.copyFileSync(summaryMdPath, destPath);

  // 사이드바 업데이트
  updateSidebar(WIKI_TEMP_DIR, wikiPageName);

  // Git Push
  console.log("🚀 팀 위키로 푸시 중...");
  try {
    execSync(`git -C ${WIKI_TEMP_DIR} add .`, { stdio: "inherit" });

    // 변경 사항 체크
    const status = execSync(`git -C ${WIKI_TEMP_DIR} status --porcelain`, {
      encoding: "utf8",
    });
    if (!status) {
      console.log("✨ 변경 사항이 없어 푸시를 건너뜁니다.");
      return;
    }

    execSync(
      `git -C ${WIKI_TEMP_DIR} commit -m "docs: ${todayStr} 회의록 자동 업데이트"`,
      { stdio: "inherit" },
    );
    execSync(`git -C ${WIKI_TEMP_DIR} push`, { stdio: "inherit" });
    console.log(`✅ Wiki 업데이트 완료: ${wikiFileName}`);
  } catch (e) {
    console.error(`⚠️ 에러 발생:`, e.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  updateTeamWiki(path.join(__dirname, "transcripts", "meeting_summary.md"));
}

module.exports = { updateTeamWiki };
