# 🎙️ Meeting AI Pipeline

> 온라인 회의 녹음본을 전사(STT), 자동 요약(Summary), 그리고 팀 채널(디스코드, 노션, 깃허브 위키)에 배포하는 올인원(All-in-One) 자동화 파이프라인 레포지토리입니다. (Python에서 Node.js 환경으로 새롭게 마이그레이션 되었습니다!)

---

## ✨ Features (주요 기능)
1. **오디오 변환 및 전사 (`transcribe.js`)**:
   - 디스코드 등에서 녹음된 다중 트랙 음성(`.flac`, `.wav`, `.mp3`)을 16kHz mono WAV 로 자동 변환합니다. (FFmpeg 사용)
   - C++ 코어 엔진인 `whisper.cpp` 모델을 사용하여 GPU 기반의 압도적인 속도로 한국어 음성 화자분리 텍스트를 생성합니다.
2. **AI 요약 생성 (`summarize.js`)**:
   - 전사된 텍스트(`meeting_with_speakers.txt`)를 Google Gemini API (Gemini 3 Flash)를 이용해 요약본 마크다운(`meeting_summary.md`)으로 생성합니다.
   - 요약 프롬프트는 `prompts/` 폴더에서 관리하며 `PROMPT_PATH` 환경변수로 교체할 수 있습니다 (아래 "프롬프트 커스터마이징" 참고).
3. **업로드 자동화 (`discord.js`, `notion.js`, `github_wiki.js`)**:
   - 요약본을 서버로 발송합니다.
   - 🚨 `TEST_MODE` 활성화를 통해 서비스 운영망에 모의 데이터가 전송되는 것을 방어할 수 있습니다.

---

## 💻 Prerequisites (사전 준비사항)

본 프로젝트를 로컬에서 구동하기 위해 아래 프로그램과 모델이 시스템에 설치되어 있어야 합니다.

1. **Node.js** (v18 이상 권장)
2. **FFmpeg** (CLI 설치 필수, 입력 오디오를 16kHz mono WAV 로 정규화)
   - macOS: `brew install ffmpeg`
3. **Whisper.cpp (내부 빌드)**
   - 프로젝트 내부 `whisper.cpp/` 폴더 안의 `build/bin/whisper-cli` 코어 실행 파일이 빌드되어 있어야 합니다.
   - `whisper.cpp/models/ggml-large-v3-turbo.bin` 양자기반 가중치 파일이 존재해야 합니다.

---

## 🛠️ Installation & Setup (설치 및 환경변수 셋업)

1. 패키지를 설치합니다:
```bash
npm install
```

2. 루트 경로에 `.env` 파일을 생성하고 다음 값을 입력합니다 (보안 유지 필수!):
```env
# Google Gemini API Key
GEMINI_API_KEY=your_gemini_api_key_here

# Discord Webhook
DISCORD_WEBHOOK_URL=your_discord_webhook_url_here

# Notion Integration
NOTION_TOKEN=your_notion_integration_token_here
NOTION_DATABASE_ID=your_notion_database_id_here

# Github Wiki 
GITHUB_USERNAME=your_github_username_here
GITHUB_PAT=your_github_personal_access_token_here
GITHUB_REPO_NAME=your_repo_name_here

# 운영 모드 세팅 (true 시 전송하지 않고 콘솔에 모의 결괏값만 출력, 운영 시에는 주석 혹은 false)
TEST_MODE=true
```

---

## 🚀 Usage (사용 가이드)

프로젝트 폴더 안에 `recordings/` 폴더를 만들고, 화자별 분류가 끝난 `1234-UserName.flac` 형식의 파일들을 넣은 뒤 스크립트를 실행합니다.

지원하는 입력 확장자는 `.flac` / `.wav` / `.mp3` 세 가지입니다 (대소문자 무관). 파이프라인 내부에서 FFmpeg 가 16kHz mono WAV 로 자동 정규화한 뒤 whisper-cli 에 넘기므로 원본 파일은 그대로 유지됩니다.

> ℹ️ 같은 폴더에 `meeting.flac` / `meeting.wav` / `meeting.mp3` 같은 **합본(mixdown)** 파일이 있으면 자동으로 스킵됩니다 — 단일 화자로 재전사되는 것을 막기 위함입니다. 화자별 트랙만 두고 싶다면 합본 파일은 다른 폴더로 옮겨주세요.

**전체 파이프라인 일괄 실행 (가장 추천)**:
```bash
npm run start
```
위 명령어를 치면 "전사 -> 요약 -> 디스코드 배포 -> 노션 배포 -> 깃허브 위키 배포 -> 환경 정리" 가 순차적으로 진행됩니다.

**단계별 개별 실행**:
- `npm run transcribe` : 음성 전사 분리 및 텍스트 취합
- `npm run summarize` : Gemini 요약 로직 및 아카이빙 로직 실행
- `npm run discord` : 디스코드로 결과 폼 데이터 등 발송
- `npm run notion` : 노션 타임테이블 마크다운 파싱 및 블록 업로드
- `npm run wiki` : Github Wiki `.Sidebar.md` 동적 갱신 및 MD 푸시

---

## 🧩 프롬프트 커스터마이징 (Prompt Customization)

요약 프롬프트는 `prompts/` 디렉토리에서 마크다운 파일로 관리합니다.

- `prompts/default.md` — 한국어 기본 템플릿 (도메인 중립). 팀 명단 placeholder
  (`<id1>` 등)만 본인 팀 정보로 교체하면 그대로 동작합니다.
- `prompts/example.md` — 구체적인 STT 오류 사례·기술 용어 교정·성능 지표(TTFB/LCP)·
  멘토링 패턴 등 디테일이 포함된 한국어 예시. 자기 팀/도메인 컨텍스트로 내용을 바꿔
  쓰는 출발점으로 권장.

다른 파일을 쓰고 싶다면 `.env`에 `PROMPT_PATH`를 지정하세요 (저장소 루트 기준 상대 경로):

```env
# .env
PROMPT_PATH=prompts/example.md
```

설정이 없으면 `prompts/default.md`가 사용됩니다.