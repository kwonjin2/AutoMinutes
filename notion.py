import os
import re
import requests
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

NOTION_TOKEN = os.getenv("NOTION_TOKEN")
DATABASE_ID = os.getenv("NOTION_DATABASE_ID")

def parse_rich_text(text):
    """**굵게** 및 `코드` 형식을 노션 Rich Text 배열로 변환"""
    parts = re.split(r'(\*\*.*?\*\*|`.*?`)', text)
    rich_text = []
    for part in parts:
        if part.startswith('**') and part.endswith('**'):
            rich_text.append({"type": "text", "text": {"content": part[2:-2]}, "annotations": {"bold": True}})
        elif part.startswith('`') and part.endswith('`'):
            rich_text.append({"type": "text", "text": {"content": part[1:-1]}, "annotations": {"code": True}})
        elif part:
            rich_text.append({"type": "text", "text": {"content": part}})
    return rich_text

def create_timetable_table(rows):
    """타임테이블용 리스트를 [주제 | 시간] 형태의 단순 표 블록으로 변환"""
    table_rows = []
    
    # 헤더 추가
    table_rows.append({
        "type": "table_row",
        "table_row": {
            "cells": [[{"type": "text", "text": {"content": "주제"}}], [{"type": "text", "text": {"content": "시간"}}]]
        }
    })

    for row in rows:
        topic = row.strip().lstrip('-').strip()
        if not topic: continue
        
        # 멘티님 요청: 회의 시간 10분 고정
        table_rows.append({
            "type": "table_row",
            "table_row": {
                "cells": [
                    parse_rich_text(topic),
                    [{"type": "text", "text": {"content": "10분"}}]
                ]
            }
        })
    
    return {
        "object": "block",
        "type": "table",
        "table": {
            "table_width": 2,
            "has_column_header": True,
            "children": table_rows
        }
    }

def upload_to_notion(file_path):
    if not os.path.exists(file_path):
        print(f"❌ 파일을 찾을 수 없습니다: {file_path}")
        return

    with open(file_path, "r", encoding="utf-8") as f:
        lines = f.readlines()

    headers = {
        "Authorization": f"Bearer {NOTION_TOKEN}",
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28"
    }

    children_blocks = []
    temp_list_for_table = []
    is_table_section = False

    for line in lines:
        stripped = line.strip()
        if not stripped: continue

        # 1. 타임테이블 섹션 감지
        if "### 1. 회의 주제" in stripped:
            children_blocks.append({"object": "block", "type": "heading_2", "heading_2": {"rich_text": [{"text": {"content": "⏰ 타임테이블"}}]}})
            is_table_section = True
            continue
        
        # 2. 타임테이블 데이터 수집
        if is_table_section:
            if stripped.startswith("- "):
                temp_list_for_table.append(stripped)
                continue
            else:
                if temp_list_for_table:
                    children_blocks.append(create_timetable_table(temp_list_for_table))
                    temp_list_for_table = []
                is_table_section = False

        # 3. 일반 마크다운 파싱 (구분선, 제목, 리스트)
        if stripped == "---":
            children_blocks.append({"object": "block", "type": "divider", "divider": {}})
        elif stripped.startswith("### "):
            children_blocks.append({"object": "block", "type": "heading_3", "heading_3": {"rich_text": parse_rich_text(stripped[4:])}})
        elif stripped.startswith("- "):
            children_blocks.append({"object": "block", "type": "bulleted_list_item", "bulleted_list_item": {"rich_text": parse_rich_text(stripped[2:])}})
        else:
            children_blocks.append({"object": "block", "type": "paragraph", "paragraph": {"rich_text": parse_rich_text(stripped)}})

    # 4. 루프 종료 후 남은 표 데이터 마무리
    if is_table_section and temp_list_for_table:
        children_blocks.append(create_timetable_table(temp_list_for_table))

    # 업로드 실행
    today = datetime.now().strftime("%Y-%m-%d")
    page_title = f"14회차 프론트엔드 회의록"

    data = {
        "parent": {"database_id": DATABASE_ID},
        "properties": {
            "이름": {"title": [{"text": {"content": page_title}}]},
            "날짜": {"date": {"start": today}},
            "서기": {"select": {"name": "요약봇"}}
        },
        "children": children_blocks[:100]
    }

    response = requests.post("https://api.notion.com/v1/pages", headers=headers, json=data)

    if response.status_code == 200:
        print(f"✅ 노션 업로드 성공! 타임테이블이 포함된 {len(children_blocks)}개 블록을 생성했습니다.")
    else:
        print(f"❌ 오류 발생: {response.status_code}\n{response.text}")

if __name__ == "__main__":
    upload_to_notion("transcripts/meeting_summary.md")