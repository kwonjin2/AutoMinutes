require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Client } = require("@notionhq/client");

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = process.env.NOTION_DATABASE_ID;

// [보안] 테스트 환경 모드 (TEST_MODE=false 일때만 진짜로 전송)
const TEST_MODE =
  (process.env.TEST_MODE || "true").trim().toLowerCase() !== "false";

// Notion SDK Client 초기화 (TEST_MODE가 아닐 때만 유효함)
let notion;
if (NOTION_TOKEN && DATABASE_ID) {
  notion = new Client({ auth: NOTION_TOKEN });
}

function parseRichText(text) {
  const regex = /(\*\*.*?\*\*|`.*?`)/g;
  const parts = text.split(regex);
  const richText = [];

  for (const part of parts) {
    if (!part) continue;

    if (part.startsWith("**") && part.endsWith("**")) {
      richText.push({
        type: "text",
        text: { content: part.slice(2, -2) },
        annotations: { bold: true },
      });
    } else if (part.startsWith("`") && part.endsWith("`")) {
      richText.push({
        type: "text",
        text: { content: part.slice(1, -1) },
        annotations: { code: true },
      });
    } else {
      richText.push({ type: "text", text: { content: part } });
    }
  }
  return richText;
}

function createTimetableTable(rows) {
  const tableRows = [];
  // 헤더 추가
  tableRows.push({
    type: "table_row",
    table_row: {
      cells: [
        [{ type: "text", text: { content: "주제" } }],
        [{ type: "text", text: { content: "시간" } }],
      ],
    },
  });

  for (const row of rows) {
    const topic = row.trim().replace(/^-/, "").trim();
    if (!topic) continue;

    // 회의 시간 10분 고정
    tableRows.push({
      type: "table_row",
      table_row: {
        cells: [
          parseRichText(topic),
          [{ type: "text", text: { content: "10분" } }],
        ],
      },
    });
  }

  return {
    object: "block",
    type: "table",
    table: { table_width: 2, has_column_header: true, children: tableRows },
  };
}

async function uploadToNotion(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log(`❌ 파일을 찾을 수 없습니다: ${filePath}`);
    return;
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  const childrenBlocks = [];
  let tempListForTable = [];
  let isTableSection = false;

  for (const line of lines) {
    const stripped = line.trim();
    if (!stripped) continue;

    // 1. 타임테이블 섹션 감지
    if (stripped.includes("### 1. 회의 주제")) {
      childrenBlocks.push({
        object: "block",
        type: "heading_2",
        heading_2: {
          rich_text: [{ type: "text", text: { content: "⏰ 타임테이블" } }],
        },
      });
      isTableSection = true;
      continue;
    }

    // 2. 타임테이블 데이터 수집
    if (isTableSection) {
      if (stripped.startsWith("- ")) {
        tempListForTable.push(stripped);
        continue;
      } else {
        if (tempListForTable.length > 0) {
          childrenBlocks.push(createTimetableTable(tempListForTable));
          tempListForTable = [];
        }
        isTableSection = false;
      }
    }

    // 3. 일반 마크다운 파싱
    if (stripped === "---") {
      childrenBlocks.push({ object: "block", type: "divider", divider: {} });
    } else if (stripped.startsWith("### ")) {
      childrenBlocks.push({
        object: "block",
        type: "heading_3",
        heading_3: { rich_text: parseRichText(stripped.substring(4)) },
      });
    } else if (stripped.startsWith("- ")) {
      childrenBlocks.push({
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: parseRichText(stripped.substring(2)) },
      });
    } else {
      childrenBlocks.push({
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: parseRichText(stripped) },
      });
    }
  }

  // 루프 종료 후 남은 표 데이터 마무리
  if (isTableSection && tempListForTable.length > 0) {
    childrenBlocks.push(createTimetableTable(tempListForTable));
  }

  const today = new Date();
  const pad = (num) => String(num).padStart(2, "0");
  const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const pageTitle = `${todayStr} 회의록`;

  if (TEST_MODE) {
    console.log(
      `🚨 [TEST_MODE] 테스트 모드가 활성화되어 있습니다. 실제 Notion 데이터베이스에 접근하지 않습니다.`,
    );
    console.log(`  (생성 예정 블록 수: ${childrenBlocks.length}개)`);
    return;
  }

  if (!notion) {
    console.log("❌ NOTION_TOKEN 또는 DATABASE_ID가 .env에 존재하지 않습니다.");
    return;
  }

  try {
    await notion.pages.create({
      parent: { database_id: DATABASE_ID },
      properties: {
        이름: { title: [{ text: { content: pageTitle } }] },
        날짜: { date: { start: todayStr } },
        서기: { select: { name: "요약봇" } },
      },
      // 최대 100개 블록
      children: childrenBlocks.slice(0, 100),
    });
    console.log(
      `✅ 노션 업로드 성공! 타임테이블이 포함된 ${childrenBlocks.length}개 블록을 생성했습니다.`,
    );
  } catch (e) {
    console.error(`❌ 노션 API 오류 발생:`, e.message);
  }
}

if (require.main === module) {
  uploadToNotion(path.join(__dirname, "transcripts", "meeting_summary.md"));
}

module.exports = { uploadToNotion };
