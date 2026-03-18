import os
import subprocess
import shutil
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

# 1. 환경 변수 읽기
TOKEN = os.getenv("GITHUB_PAT")
USER = os.getenv("GITHUB_USERNAME") 
REPO = os.getenv("GITHUB_REPO_NAME") 

# 2. URL 조립
TEAM_WIKI_URL = f"https://{TOKEN}@github.com/{USER}/{REPO}.wiki.git"
WIKI_TEMP_DIR = "team_wiki_tmp"

def update_sidebar(wiki_dir, page_name_no_ext):
    """
    _Sidebar.md의 <details> 내부에 새 회의록 링크를 촘촘하게 추가합니다.
    """
    sidebar_path = os.path.join(wiki_dir, "_Sidebar.md")
    new_link = f"- [[{page_name_no_ext}]]"
    
    lines = []
    if os.path.exists(sidebar_path):
        with open(sidebar_path, "r", encoding="utf-8") as f:
            lines = f.readlines()
    
    # 중복 링크 체크
    if any(new_link in line for line in lines):
        print(f"ℹ️ 사이드바에 이미 '{page_name_no_ext}' 링크가 존재합니다.")
        return

    # 삽입 위치 찾기 (<summary>📅 회의록</summary> 바로 다음 줄)
    insert_index = -1
    for i, line in enumerate(lines):
        if "<summary>📅 회의록</summary>" in line:
            insert_index = i + 1
            break
    
    if insert_index != -1:
        # 상단 공백은 마크다운 문법 유지를 위해 필요하지만, 아래는 바로 붙여서 삽입
        # \n- [[링크]] 형식을 사용하여 기존 리스트와 밀착시킵니다.
        lines.insert(insert_index, "\n" + new_link)
    else:
        # 파일이 없거나 태그가 없는 경우 초기 구조 생성
        lines = [
            "### 🛠️ 기술 스택\n",
            "- [[Frontend]]\n",
            "- [[Backend]]\n\n",
            "<details>\n",
            "<summary>📅 회의록</summary>\n",
            f"\n{new_link}\n", # 첫 생성 시에도 문법 보호를 위해 줄바꿈 포함
            "\n</details>\n"
        ]

    with open(sidebar_path, "w", encoding="utf-8") as f:
        f.writelines(lines)
    print("📝 사이드바(_Sidebar.md) 리스트 밀착 업데이트 완료")

def update_team_wiki(summary_md_path):
    if not os.path.exists(summary_md_path):
        print(f"❌ 요약본 파일을 찾을 수 없습니다: {summary_md_path}")
        return

    if not os.path.exists(WIKI_TEMP_DIR):
        print("📂 팀 위키 클론 중...")
        subprocess.run(["git", "clone", TEAM_WIKI_URL, WIKI_TEMP_DIR], check=True)
    else:
        print("🔄 팀 위키 최신화 중...")
        subprocess.run(["git", "-C", WIKI_TEMP_DIR, "pull"], check=True)

    # 2. 파일 이름 결정 (날짜-회의록 형식 권장)
    today = datetime.now().strftime("%Y-%m-%d")
    # 실제 파일명을 '2026-03-16-회의록' 형태로 자동 생성
    wiki_page_name = f"{today}-회의록" 
    wiki_file_name = f"{wiki_page_name}.md"
    dest_path = os.path.join(WIKI_TEMP_DIR, wiki_file_name)
    
    shutil.copy(summary_md_path, dest_path)

    # 3. 사이드바 업데이트
    update_sidebar(WIKI_TEMP_DIR, wiki_page_name)

    # 4. Git Push
    print("🚀 팀 위키로 푸시 중...")
    try:
        subprocess.run(["git", "-C", WIKI_TEMP_DIR, "add", "."], check=True)
        status = subprocess.run(["git", "-C", WIKI_TEMP_DIR, "status", "--porcelain"], capture_output=True, text=True).stdout
        if not status:
            print("✨ 변경 사항이 없어 푸시를 건너뜁니다.")
            return

        subprocess.run(["git", "-C", WIKI_TEMP_DIR, "commit", "-m", f"docs: {today} 회의록 자동 업데이트"], check=True)
        subprocess.run(["git", "-C", WIKI_TEMP_DIR, "push"], check=True)
        print(f"✅ Wiki 업데이트 완료: {wiki_file_name}")
    except subprocess.CalledProcessError as e:
        print(f"⚠️ 에러 발생: {e}")

if __name__ == "__main__":
    # summarize.py가 생성한 최종 결과물 경로를 넣어주세요
    update_team_wiki("transcripts/meeting_summary.md")