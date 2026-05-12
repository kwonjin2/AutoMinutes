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
   - `whisper.cpp/models/ggml-<MODEL>.bin` 가중치 파일이 존재해야 합니다. `<MODEL>` 은 `.env` 의 `WHISPER_MODEL` (기본 `large-v3-turbo`) 와 일치해야 합니다.
   - `./setup.sh` 가 위 두 가지를 자동으로 처리합니다.

---

## 🛠️ Installation & Setup (설치 및 환경변수 셋업)

### ⚡ Quick Start (권장)

```bash
./setup.sh
```

`setup.sh` 가 다음을 자동으로 처리합니다:

- **플랫폼 자동 감지** — macOS (Apple Silicon Metal · Intel CPU), Linux (NVIDIA CUDA · CPU)
- **사전 의존성 체크** — `git`/`ffmpeg`/`node`/`npm`/`cmake`/`make` 누락 시 안내
- **whisper.cpp 빌드** — 플랫폼에 맞는 cmake 플래그로 release 빌드
- **모델 인터랙티브 선택** — `tiny` / `base` / `small` / `medium` / `large-v3` / `large-v3-turbo` (기본)
- **모델 다운로드** — `whisper.cpp/models/download-ggml-model.sh`
- **npm install + .env 초기화** — `.env.example` → `.env` 복사, `WHISPER_MODEL` 자동 기록

비대화형으로 모델을 지정하려면 `WHISPER_MODEL=tiny ./setup.sh` 처럼 환경변수로 넘기면 됩니다.

이후 `.env` 의 `GEMINI_API_KEY` 와 (선택) 업로드 토큰을 채워 넣으면 끝.

### 수동 셋업

`setup.sh` 를 쓰지 않는 경우:

1. 패키지를 설치합니다:
```bash
npm install
```

2. whisper.cpp 를 빌드합니다 (Apple Silicon 예):
```bash
cd whisper.cpp && cmake -B build -DGGML_METAL=ON && cmake --build build --config Release -j
bash models/download-ggml-model.sh large-v3-turbo
```

3. `.env.example` 를 `.env` 로 복사하고 토큰을 채웁니다 (디스코드/노션/위키 토큰은 비워두면 자동 스킵):
```bash
cp .env.example .env
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
- `npm run doctor` : 의존성/설정 헬스 체크 (Node·FFmpeg·whisper-cli·모델·.env). 필수 누락 시 exit 1.
- `npm run transcribe` : 음성 전사 분리 및 텍스트 취합
- `npm run summarize` : Gemini 요약 로직 및 아카이빙 로직 실행
- `npm run discord` : 디스코드로 결과 폼 데이터 등 발송
- `npm run notion` : 노션 타임테이블 마크다운 파싱 및 블록 업로드
- `npm run wiki` : Github Wiki `.Sidebar.md` 동적 갱신 및 MD 푸시

> ℹ️ **선택적 업로드 채널**: `DISCORD_WEBHOOK_URL`, `NOTION_TOKEN`/`NOTION_DATABASE_ID`, `GITHUB_PAT`/`GITHUB_USERNAME`/`GITHUB_REPO_NAME` 중 비어 있는 그룹이 있으면 해당 업로드 단계는 자동으로 스킵됩니다 (에러 없이 로그만 남김). Gemini 요약까지만 쓰고 싶다면 업로드 토큰을 모두 비워두면 됩니다.

> ℹ️ **전사 언어**: 기본값은 한국어 (`-l ko`). 영어/일본어/다국어 회의는 `.env` 에 `WHISPER_LANG=auto` (whisper.cpp 자동 감지) 또는 `WHISPER_LANG=en` 처럼 ISO-639-1 코드를 지정하세요.

---

## 🧩 프롬프트 커스터마이징 (Prompt Customization)

요약 프롬프트는 `prompts/` 디렉토리에서 마크다운 파일로 관리합니다.

- `prompts/default.md` — 한국어 기본 템플릿 (도메인 중립). 팀 명단 placeholder
  (`<id1>` 등)만 본인 팀 정보로 교체하면 그대로 동작합니다.
- `prompts/mentoring.md` — 시니어/멘토가 참여하는 멘토링 회의용 예시 템플릿.
  구체적인 STT 오류 사례·기술 용어 교정·성능 지표(TTFB/LCP)·멘토 코멘트 가이드가
  포함된 한국어 예시이며, 자기 팀/도메인 컨텍스트로 내용을 바꿔 쓰는 출발점으로 권장.

본인 팀 전용 프롬프트를 쓰려면 `prompts/` 아래 새 `.md` 파일을 만들고 `.env`의
`PROMPT_PATH`를 그 경로로 지정하세요 (저장소 루트 기준 상대 경로):

```env
# .env
PROMPT_PATH=prompts/mentoring.md
```

설정이 없으면 `prompts/default.md`가 사용됩니다.