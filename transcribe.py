# python3 transcribe.py && python3 summarize.py
import os
import subprocess
import json

# 설정
INPUT_DIR = "recordings"
OUTPUT_DIR = "transcripts"
# 50분 이상의 긴 회의라면 'medium' 모델을 강력 추천합니다. 
# 사양이 허락한다면 "medium", CPU 부담이 크다면 "small"을 유지하세요.
WHISPER_MODEL = "small" 

def run_transcription():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    flac_files = [
        f for f in os.listdir(INPUT_DIR)
        if f.endswith(".flac") and f != "meeting.flac"
    ]

    if not flac_files:
        print("❌ recordings 폴더에 분석할 .flac 파일이 없습니다.")
        return

    conversation_segments = []

    for file in flac_files:
        input_path = os.path.join(INPUT_DIR, file)
        
        if "-" in file:
            speaker = file.split("-", 1)[-1].replace(".flac", "")
        else:
            speaker = file.replace(".flac", "")

        print(f"🔄 Transcribing {file} (Speaker: {speaker})...")

        # 2. 로컬 Whisper 실행 (환각 방지 옵션 추가)
        subprocess.run([
            "python3",
            "-m",
            "whisper",
            input_path,
            "--model", WHISPER_MODEL,
            "--language", "Korean",
            # "--device", "mps", # ⭐️ GPU(Metal Performance Shaders) 사용 강제
            "--output_dir", OUTPUT_DIR,
            "--output_format", "json",
            # --- 환각 및 무음 반복 방지 옵션 ---
            "--condition_on_previous_text", "False",  # 이전 결과에 영향받아 반복되는 현상 방지
            "--no_speech_threshold", "0.6",           # 무음 구간에서 억지로 말을 만들어내지 않도록 임계값 상향
            "--logprob_threshold", "-1.0"             # 확신이 낮은 문장은 과감히 버림
        ], check=True)

        # 3. 생성된 JSON 결과 읽기
        json_file = os.path.join(OUTPUT_DIR, file.replace(".flac", ".json"))

        if os.path.exists(json_file):
            with open(json_file, "r", encoding="utf-8") as f:
                data = json.load(f)

            for seg in data.get("segments", []):
                text = seg["text"].strip()
                # 의미 없는 한 글자 반복이나 Whisper 특유의 에러 문구 필터링 (선택 사항)
                if len(text) > 1 and "MBC 뉴스" not in text: 
                    conversation_segments.append({
                        "start": seg["start"],
                        "speaker": speaker,
                        "text": text
                    })
        else:
            print(f"⚠️ {json_file} 생성에 실패했습니다.")

    # 4. 시간순 정렬
    conversation_segments.sort(key=lambda x: x["start"])

    # 5. 최종 통합 텍스트 파일 생성
    combined_path = os.path.join(OUTPUT_DIR, "meeting_with_speakers.txt")
    with open(combined_path, "w", encoding="utf-8") as f:
        for seg in conversation_segments:
            f.write(f"[{seg['speaker']}]: {seg['text']}\n")

    print(f"\n✅ 화자 구분 회의록 생성 완료: {combined_path}")

if __name__ == "__main__":
    run_transcription()