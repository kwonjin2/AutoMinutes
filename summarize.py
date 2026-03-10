import os
import requests
import google.generativeai as genai
import shutil
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

# API 키 및 웹훅 설정
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
DISCORD_WEBHOOK_URL = os.getenv("DISCORD_WEBHOOK_URL")

genai.configure(api_key=GEMINI_API_KEY)

def run_summarization():
    try:
        # 1. 파일 로드
        with open("prompt.md", "r", encoding="utf-8") as f:
            system_instruction = f.read()
        with open("transcripts/meeting_with_speakers.txt", "r", encoding="utf-8") as f:
            transcript = f.read()

        print("🚀 Gemini 엔진(Gemini 3 Flash)으로 분석을 시작합니다...")
        
        model = genai.GenerativeModel('models/gemini-3-flash-preview')
        
        response = model.generate_content(
            f"{system_instruction}\n\n### 회의록 원본 ###\n{transcript}"
        )
        
        summary_result = response.text
        print("\n✅ 분석 완료!")

        # 2. 결과 저장
        summary_path = "transcripts/meeting_summary.md"
        with open(summary_path, "w", encoding="utf-8") as f:
            f.write(summary_result)
        
        # 3. 디스코드 전송 (파일 방식) 및 성공 시 파일 정리
        is_success = send_to_discord_as_file(summary_path)
        
        if is_success:
            archive_and_cleanup()

    except Exception as e:
        print(f"❌ 에러 발생: {e}")
        print("\n접근 가능한 모델 목록:")
        for m in genai.list_models():
            print(f"- {m.name}")

def send_to_discord_as_file(file_path):
    """
    텍스트 대신 .md 파일을 디스크드에 업로드합니다.
    """
    header = "📋 **오늘의 프로젝트 회의 요약 (Mentor AI)**"
    
    try:
        with open(file_path, "rb") as f:
            # 파일을 files 인자에 담아 POST 요청을 보냅니다.
            res = requests.post(
                DISCORD_WEBHOOK_URL,
                data={"content": header},
                files={"file": (os.path.basename(file_path), f)}
            )
        
        if res.status_code in [200, 204]:
            print("🔔 디스코드 파일 전송 성공!")
            return True
        else:
            print(f"⚠️ 전송 실패: {res.status_code}")
            return False
    except Exception as e:
        print(f"❌ 전송 중 오류 발생: {e}")
        return False

def archive_and_cleanup():
    """
    용량이 큰 음성 파일은 삭제하고, 요약본만 날짜별로 보관합니다.
    """
    now = datetime.now()
    date_str = now.strftime("%Y-%m-%d")
    timestamp = now.strftime("%H%M%S")
    
    # 보관용 폴더 생성
    archive_dir = os.path.join("archived", date_str)
    os.makedirs(archive_dir, exist_ok=True)

    # 1. 요약본 보관
    summary_src = "transcripts/meeting_summary.md"
    if os.path.exists(summary_src):
        archive_dest = os.path.join(archive_dir, f"summary_{timestamp}.md")
        shutil.copy(summary_src, archive_dest)
        print(f"📦 요약본 아카이빙 완료: {archive_dest}")

    # 2. recordings 내 .flac 삭제
    for f in os.listdir("recordings"):
        if f.endswith(".flac"):
            os.remove(os.path.join("recordings", f))
            print(f"🗑️ 음성 파일 삭제 완료: {f}")

    # 3. transcripts 내 중간 파일 삭제
    for f in os.listdir("transcripts"):
        if f != "meeting_summary.md":
            os.remove(os.path.join("transcripts", f))
            print(f"🗑️ 중간 데이터 삭제 완료: {f}")

    print("✨ 작업 환경 정리 끝!")

if __name__ == "__main__":
    run_summarization()