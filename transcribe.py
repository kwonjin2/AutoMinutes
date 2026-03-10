# 1. python3 transcribe.py
# 2. python3 summarize.py
import os
import subprocess
import json

# [설정] 경로를 본인의 환경에 맞게 확인하세요.
BASE_DIR = os.getcwd()
WHISPER_CLI = os.path.join(BASE_DIR, "whisper.cpp", "build", "bin", "whisper-cli")
MODEL_PATH = os.path.join(BASE_DIR, "whisper.cpp", "models", "ggml-large-v3-turbo.bin")
INPUT_DIR = "recordings"
OUTPUT_DIR = "transcripts"

def run_transcription():
    # 폴더 생성
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # 전사할 FLAC 파일 목록 추
    flac_files = [
        f for f in os.listdir(INPUT_DIR)
        if f.endswith(".flac") and f != "meeting.flac"
    ]

    if not flac_files:
        print("❌ recordings 폴더에 분석할 .flac 파일이 없습니다.")
        return

    # 실행 파일 존재 여부 확인 (멘티님이 빌드한 main/whisper-cli)
    if not os.path.exists(WHISPER_CLI):
        print(f"❌ whisper-cli 엔진을 찾을 수 없습니다: {WHISPER_CLI}")
        return

    conversation_segments = []

    for file in flac_files:
        input_path = os.path.join(INPUT_DIR, file)
        speaker = file.split("-", 1)[-1].replace(".flac", "") if "-" in file else file.replace(".flac", "")

        # 1. FFmpeg로 16kHz WAV 변환 (whisper.cpp 필수 사양)
        wav_path = input_path.replace(".flac", ".wav")
        print(f"🎵 {file} 변환 중 (FLAC -> 16kHz WAV)...")
        subprocess.run([
            "ffmpeg", "-i", input_path, 
            "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", 
            wav_path, "-y"
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        print(f"🚀 [GPU 가속] {file} 전사 시작 (Speaker: {speaker})...")

        # 2. whisper.cpp 실행 (JSON 출력 모드)
        # whisper.cpp는 결과 파일명 뒤에 자동으로 .json을 붙입니다.
        output_base = os.path.join(OUTPUT_DIR, file.replace(".flac", ""))
        
        subprocess.run([
            WHISPER_CLI,
            "-m", MODEL_PATH,
            "-f", wav_path,
            "-l", "ko",
            "--output-json",
            "--output-file", output_base
        ], check=True)

        # 3. 임시 WAV 파일 삭제
        os.remove(wav_path)

        # 4. 생성된 JSON 결과 읽기
        json_file = output_base + ".json"
        if os.path.exists(json_file):
            with open(json_file, "r", encoding="utf-8") as f:
                data = json.load(f)

            # [수정] whisper.cpp의 다양한 JSON 구조에 대응 (transcription 또는 segments)
            results = data.get("transcription") or data.get("segments") or []
            
            for trans in results:
                text = trans.get("text", "").strip()
                # [중요] 오프셋 구조 확인: 'from' 혹은 'start'
                start_ts = 0
                if "offsets" in trans:
                    start_ts = trans["offsets"]["from"] / 1000
                elif "start" in trans:
                    start_ts = trans["start"] / 1000

                if len(text) > 1 and "MBC 뉴스" not in text: 
                    conversation_segments.append({
                        "start": start_ts,
                        "speaker": speaker,
                        "text": text
                    })
            
            # [테스트 기간에는 삭제 보류] 디버깅을 위해 JSON 파일을 남겨두세요.
            # os.remove(json_file) 
        else:
            print(f"⚠️ {json_file} 생성에 실패했습니다.")

    # 5. 시간순 정렬
    conversation_segments.sort(key=lambda x: x["start"])

    # 6. 최종 통합 텍스트 파일 생성
    combined_path = os.path.join(OUTPUT_DIR, "meeting_with_speakers.txt")
    with open(combined_path, "w", encoding="utf-8") as f:
        for seg in conversation_segments:
            f.write(f"[{seg['speaker']}]: {seg['text']}\n")

    print(f"\n✅ 고속 엔진 기반 회의록 생성 완료: {combined_path}")

if __name__ == "__main__":
    run_transcription()