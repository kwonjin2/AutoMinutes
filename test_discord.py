import os
import requests
from dotenv import load_dotenv

load_dotenv()

# .env에서 웹훅 주소 가져오기
DISCORD_WEBHOOK_URL = os.getenv("DISCORD_WEBHOOK_URL")

def test_send_file(file_path):
    """
    이미 생성된 파일을 디스코드에 전송하는 기능만 수행합니다.
    """
    if not os.path.exists(file_path):
        print(f"❌ 파일을 찾을 수 없습니다: {file_path}")
        return

    print(f"📡 디스코드로 전송 시도 중: {file_path}")
    
    header = "🧪 **디스코드 파일 전송 테스트"
    
    try:
        with open(file_path, "rb") as f:
            # POST 요청으로 파일 업로드
            res = requests.post(
                DISCORD_WEBHOOK_URL,
                data={"content": header},
                files={"file": (os.path.basename(file_path), f)}
            )
        
        if res.status_code in [200, 204]:
            print("✅ 디스코드 파일 전송 성공!")
        else:
            print(f"⚠️ 전송 실패 (상태 코드): {res.status_code}")
            print(f"응답 내용: {res.text}")

    except Exception as e:
        print(f"❌ 테스트 중 오류 발생: {e}")

if __name__ == "__main__":
    # 아카이빙 폴더나 transcripts 폴더에 있는 파일 경로를 지정하세요.
    target_file = "transcripts/meeting_summary.md" 
    test_send_file(target_file)