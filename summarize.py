import os
import google.generativeai as genai
import shutil
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

# API 키 설정
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
genai.configure(api_key=GEMINI_API_KEY)

def run_summarization():
    try:
        # 1. 파일 로드
        with open("prompt.md", "r", encoding="utf-8") as f:
            system_instruction = f.read()
        with open("transcripts/meeting_with_speakers.txt", "r", encoding="utf-8") as f:
            transcript = f.read()

        print("🚀 Gemini 엔진(Gemini 3 Flash)으로 분석을 시작합니다...")
        
        # 멘티님의 기존 모델 설정 유지
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
        
        # 3. 파일 정리 (디스코드 전송 없이 바로 아카이브 및 청소 실행)
        archive_and_cleanup()

    except Exception as e:
        print(f"❌ 에러 발생: {e}")
        print("\n접근 가능한 모델 목록:")
        for m in genai.list_models():
            print(f"- {m.name}")

def archive_and_cleanup():
    """
    무거운 음성 파일과 JSON만 삭제하고, .txt 파일은 보존합니다.
    """
    now = datetime.now()
    date_str = now.strftime("%Y-%m-%d")
    timestamp = now.strftime("%H%M%S")
    
    # 보관용 폴더 생성
    archive_dir = os.path.join("archived", date_str)
    os.makedirs(archive_dir, exist_ok=True)

    # 1. 요약본(.md) 보관
    summary_src = "transcripts/meeting_summary.md"
    if os.path.exists(summary_src):
        archive_dest = os.path.join(archive_dir, f"summary_{timestamp}.md")
        shutil.copy(summary_src, archive_dest)
        print(f"📦 요약본 아카이빙 완료: {archive_dest}")

    # 2. recordings 내 .flac 삭제 (무거운 음성 파일)
    if os.path.exists("recordings"):
        for f in os.listdir("recordings"):
            if f.endswith(".flac"):
                os.remove(os.path.join("recordings", f))
                print(f"🗑️ 음성 파일 삭제 완료: {f}")

    # 3. transcripts 내 .json(중간 데이터)만 삭제
    # 멘티님의 요청대로 .txt 파일은 지우지 않고 유지합니다.
    if os.path.exists("transcripts"):
        for f in os.listdir("transcripts"):
            if f.endswith(".json"):
                os.remove(os.path.join("transcripts", f))
                print(f"🗑️ 중간 JSON 데이터 삭제 완료: {f}")

    print("✨ 작업 환경 정리 끝! (.txt 파일은 안전하게 보존되었습니다.)")

if __name__ == "__main__":
    run_summarization()