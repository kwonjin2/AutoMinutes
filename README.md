# 🎙️ Meeting AI Pipeline

> 온라인 회의 녹음본을 전사(STT), 자동 요약(Summary), 그리고 팀 채널(디스코드, 노션, 깃허브 위키)에 배포하는 올인원(All-in-One) 자동화 파이프라인 레포지토리입니다. (Python에서 Node.js 환경으로 새롭게 마이그레이션 되었습니다!)

🇬🇧 English README: [README.en.md](README.en.md)

---

## ✨ Features (주요 기능)
1. **회의 녹음 자동화 (`record.js`)** — 선택:
   - 외부 녹음 봇(Craig 등) 없이, **자기 소유의 Discord 봇**으로 음성 채널을 직접 녹음하고 화자별 트랙을 `recordings/` 에 바로 저장합니다.
   - `/record stop` 한 번이면 아래 전사→요약→업로드 파이프라인까지 자동 실행됩니다. (아래 "🎙️ 회의 녹음 자동화" 참고)
2. **오디오 변환 및 전사 (`transcribe.js`)**:
   - 디스코드 등에서 녹음된 다중 트랙 음성(`.flac`, `.wav`, `.mp3`)을 16kHz mono WAV 로 자동 변환합니다. (FFmpeg 사용)
   - C++ 코어 엔진인 `whisper.cpp` 모델을 사용하여 GPU 기반의 압도적인 속도로 한국어 음성 화자분리 텍스트를 생성합니다.
3. **AI 요약 생성 (`summarize.js`)**:
   - 전사된 텍스트(`meeting_with_speakers.txt`)를 Google Gemini API (Gemini 3 Flash)를 이용해 요약본 마크다운(`meeting_summary.md`)으로 생성합니다.
   - 요약 프롬프트는 `prompts/` 폴더에서 관리하며 `PROMPT_PATH` 환경변수로 교체할 수 있습니다 (아래 "프롬프트 커스터마이징" 참고).
4. **업로드 자동화 (`discord.js`, `notion.js`, `github_wiki.js`)**:
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

## 🎙️ 회의 녹음 자동화 (Discord 봇) — 선택

Craig 같은 외부 녹음 봇 없이, **자기 소유의 Discord 봇**으로 음성 채널을 직접 녹음해 화자별 트랙을 `recordings/` 에 바로 저장하고, `/record stop` 시 전사→요약→업로드 파이프라인까지 자동 실행합니다.

> ⚠️ **봇은 각 사용자가 직접 만들어야 합니다.** 봇 토큰은 비밀값이라 공유할 수 없고, 봇 인스턴스는 본인 PC 에서 직접 띄워야 음성 채널에 들어갑니다 (이 프로젝트의 셀프 호스팅 원칙과 동일). 이 기능을 안 쓰면 아래 [Usage](#-usage-사용-가이드) 의 "수동" 방식으로 녹음 파일만 넣어도 됩니다.

### 1) Discord 봇 만들기 (최초 1회, ~10분)

1. [Discord Developer Portal](https://discord.com/developers/applications) → **New Application** 생성.
2. 좌측 **Bot** → **Reset Token** 으로 토큰 발급 후 복사 (이 화면을 벗어나면 다시 안 보이니, 잃어버리면 다시 Reset).
3. 같은 **Bot** 페이지에서:
   - **Privileged Gateway Intents → SERVER MEMBERS INTENT** 를 **ON** (화자 이름 매핑용) 한 뒤 **Save Changes**.
   - **Requires OAuth2 Code Grant** 는 **OFF** (켜져 있으면 초대 시 `Integration requires code grant` 에러).
4. 아래 초대 URL 의 `<CLIENT_ID>` 를 본인 앱의 **Application ID**(OAuth2 페이지 상단) 로 바꿔 브라우저에서 열고, 봇을 넣을 서버를 선택해 **승인**:
   ```
   https://discord.com/oauth2/authorize?client_id=<CLIENT_ID>&permissions=3146752&scope=bot+applications.commands
   ```
   - `permissions=3146752` = **채널 보기 + 연결 + 말하기** (녹음에 필요한 최소 권한). 리디렉션 URI 는 봇 초대에 필요 없으니 무시하세요.

### 2) 토큰 설정

`.env` 에 발급받은 토큰을 추가합니다 (업로드용 `DISCORD_WEBHOOK_URL` 과는 **완전히 별개**):
```env
DISCORD_BOT_TOKEN=your_discord_bot_token_here
```

### 3) 녹음 실행

```bash
npm run record
```
`🟢 준비 완료` 가 뜨면 봇이 살아있는 것입니다 (이 터미널은 회의 동안 켜둡니다). 이후 Discord 에서:

1. **음성 채널 입장**
2. `/record start` — 봇이 입장하고, 말하는 사람부터 화자별 트랙이 자동 생성됩니다.
3. `/record stop` — 봇이 나가고, `recordings/` 에 `1-이름.flac` 형식으로 저장된 뒤 **자동으로 `npm run start`** (전사→요약→업로드) 가 실행됩니다.

> ℹ️ 새 녹음을 시작하면 `recordings/` 의 기존 오디오는 삭제되지 않고 `recordings/_archive_<시각>/` 로 백업된 뒤, 이번 회의 트랙만 전사됩니다. 한 번도 말하지 않은 참가자는 트랙이 생성되지 않습니다.

---

## 🚀 Usage (사용 가이드)

회의 오디오를 `recordings/` 폴더에 둔 뒤 스크립트를 실행합니다. 오디오를 얻는 방법은 두 가지입니다:

- **자동**: 위 [🎙️ 회의 녹음 자동화](#-회의-녹음-자동화-discord-봇--선택) 의 Discord 봇으로 녹음하면 `recordings/` 가 자동으로 채워집니다.
- **수동**: Craig 등 다른 녹음기로 받은 화자별 `1234-UserName.flac` 형식의 파일을 직접 넣습니다.

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

---

## ⚡ 성능 (Performance)

5시간 분량 4-화자 멀티트랙 회의 (FLAC 입력) 기준 처리 시간:

| 환경 | 모델 | 처리 시간 | RAM 사용 |
|---|---|---|---|
| Apple Silicon (M4 Pro, Metal) | `large-v3-turbo` | **~10분** | 8GB peak |
| Apple Silicon (M4 Pro, Metal) | `medium` | ~6분 | 5GB peak |
| Linux + NVIDIA CUDA (RTX 4070) | `large-v3-turbo` | ~7분 | 6GB peak |
| Linux CPU (8-core) | `large-v3-turbo` | ~45분 | 6GB peak |

자동 튜닝 (수동 override 가능, [`transcribe.js:34-67`](transcribe.js)):

- **동시 워커 수** = `clamp(Math.floor((RAM_GB - 4) / 3), 1, 2)` — 인스턴스당 ~2.5GB 가정 + OS 여유 4GB. 코드상 **최대 2 로 clamp** 되며, 더 늘리고 싶으면 `WHISPER_CONCURRENCY` 환경변수로 override.
- **whisper 스레드 수** =
  - Apple Silicon: `clamp(P-core수 - 1, 2, 12)` (sysctl `hw.perflevel0.physicalcpu` 자동 감지)
  - 그 외: `clamp(논리코어 - 2, 2, 12)`
  - `WHISPER_THREADS` 로 override 가능

> ℹ️ Apple Silicon 의 Metal GPU 는 직렬화되므로 동시 워커를 2 이상으로 늘려도 큰 이득이 없어 코드에서 의도적으로 2 로 제한합니다. CUDA / CPU 환경에서 더 많은 워커가 필요하면 `WHISPER_CONCURRENCY=4` 처럼 명시적 override.

모델 크기별 트레이드오프 (setup.sh 의 인터랙티브 선택지와 일치):

| 모델 | 파일 크기 | 한국어 품질 | 권장 용도 |
|---|---|---|---|
| `tiny` | 39MB | 매우 낮음 (할루시네이션 많음) | 빠른 검증 (`recordings/README.md` 의 1분 테스트) |
| `base` | 142MB | 낮음 | 매우 빠른 처리 필요 시 |
| `small` | 466MB | 중간 | 영어 위주 회의, 빠른 처리 |
| `medium` | 1.5GB | 높음 | 모바일/저사양 환경 |
| `large-v3-turbo` (기본) | 1.5GB | 매우 높음, 빠름 | **권장** — 한국어 회의 1차 |
| `large-v3` | 2.9GB | 가장 높음, 느림 | 최대 품질 필요 시 |

---

## 🛠️ 트러블슈팅 (Troubleshooting / FAQ)

### Q. `setup.sh` 가 `cmake` 또는 `make` 못 찾는다고 멈춰요
**A.** macOS 는 Xcode Command Line Tools 가 필요합니다 — `xcode-select --install` 로 GUI 설치창 띄우고 완료 후 `./setup.sh` 재실행. Linux 는 `setup.sh` 가 `apt-get install build-essential` 을 자동 시도합니다 (sudo 필요). `SKIP_AUTO_INSTALL=1 ./setup.sh` 로 자동 설치 끄고 수동 가능.

### Q. 모델 다운로드가 중간에 끊겼어요
**A.** `setup.sh` 가 최대 3회 자동 재시도합니다 (지수 백오프 2s/4s). 1MB 미만 부분 파일은 자동 제거 후 재다운로드. 3회 모두 실패하면 수동 다운로드 가이드가 출력됩니다 (huggingface 직접 받아서 `whisper.cpp/models/ggml-<MODEL>.bin` 으로 저장).

### Q. `npm run start` 실행 시 `❌ recordings 폴더에 분석할 오디오 파일이 없습니다` 나와요
**A.** `recordings/` 에 `.flac` / `.wav` / `.mp3` 파일이 있는지 확인. `meeting.flac` / `meeting.wav` / `meeting.mp3` 는 **의도적으로 스킵**됩니다 (멀티트랙 합본 가드). 파일명을 `single.wav` 등으로 변경하세요 — 자세한 사항은 `recordings/README.md`.

### Q. Apple Silicon 인데 Metal 가속이 안 되는 것 같아요
**A.** `whisper.cpp/build/` 폴더 삭제 후 `./setup.sh` 재실행. cmake 가 `-DGGML_METAL=ON` 플래그로 다시 빌드합니다. 빌드 로그에서 `BLAS = 1 | METAL = 1` 출력이 보이면 정상.

### Q. `GEMINI_API_KEY 환경변수가 설정되지 않았습니다` 에러
**A.** `npm run doctor` 가 어떤 환경변수가 누락됐는지 알려줍니다. [Google AI Studio](https://ai.google.dev) 에서 무료 API 키 발급 → `.env` 에 `GEMINI_API_KEY=AIzaSy...` 추가.

### Q. 한국어가 아닌 회의를 전사하고 싶어요
**A.** `.env` 에 `WHISPER_LANG=auto` (자동 감지) 또는 `WHISPER_LANG=en` (영어 강제) 추가. ISO-639-1 코드면 모두 동작 (en/ja/zh/es 등).

### Q. 디스코드/노션/위키 업로드 없이 요약만 쓰고 싶어요
**A.** `.env` 의 `DISCORD_WEBHOOK_URL`, `NOTION_TOKEN`, `GITHUB_PAT` 그룹을 모두 비워두면 자동 스킵됩니다 (로그만 남음). Gemini 요약은 `archived/<timestamp>/meeting_summary.md` 에 저장됩니다.

### Q. 전사 결과가 이상해요 (할루시네이션, 반복 텍스트)
**A.** 입력 오디오의 무음 구간이 길거나 SNR 이 낮을 때 발생. FFmpeg 로 무음 구간 제거 후 재시도: `ffmpeg -i raw.wav -af "silenceremove=stop_periods=-1:stop_duration=1:stop_threshold=-30dB" recordings/single.wav`. 또는 더 큰 모델 (`large-v3`) 사용.

### Q. (녹음 봇) 봇 초대 시 `Integration requires code grant` 에러가 떠요
**A.** Developer Portal → **Bot** 페이지의 **Requires OAuth2 Code Grant** 토글을 **OFF** 로 바꿔 저장한 뒤 초대 URL 을 다시 여세요.

### Q. (녹음 봇) `/record` 커맨드가 Discord 에 안 보여요
**A.** `npm run record` 로 봇이 켜져 있어야 하고, 콘솔에 `커맨드 등록: <서버명>` 로그가 떠야 합니다. 길드 슬래시 커맨드는 보통 즉시 반영됩니다.

### Q. (녹음 봇) `/record start` 했는데 트랙(.flac)이 안 생겨요
**A.** (1) Developer Portal → Bot → **SERVER MEMBERS INTENT** 가 ON 인지, (2) 명령 실행자가 **음성 채널에 입장한 상태**인지 확인하세요. 한 번도 말하지 않은 참가자는 트랙이 생성되지 않습니다(의도된 동작).

---

## 🎬 출력 샘플 (Example Output)

`npm run start` 실행 후 `archived/<YYYY-MM-DD>/meeting_summary_<HHMMSS>.md` 형식으로 저장됩니다. 구조는 `prompts/default.md` 또는 본인이 지정한 프롬프트에 따라 결정됩니다.

`prompts/default.md` 기준 출력 예시 (익명화):

```markdown
# 📝 대시보드 UI/UX 및 릴리즈 정책 조율 회의

**참여자:** Alice, Bob, Carol, Dave
**회의 성격:** FE+BE 협의 회의

---

## ⏰ 타임 테이블

- **[00:00 ~ 12:00]** 대시보드 UI 개선 논의 (랭킹/달성률 표시)
- **[12:00 ~ 25:00]** 모바일 입력 UX 개선 (태그 입력 방식 변경)
- **[25:00 ~ 종료]** 릴리즈 일정 확정 및 QA 계획

---

## ✍🏻 회의 안건

1. 대시보드 시각화 — 달성률 배경 이미지 처리 + 멤버 랭킹 레이아웃
2. 입력 UI — 엔터 방식 → 추가 버튼 + 모달 (모바일 사용성 개선)
3. 릴리즈 정책 — 5/18 출시 + 사용성 테스트 일정 수립

---

## 🏁 결정 사항

### 1. 대시보드 v2 디자인

- **결정:** Alice 가 5/14 까지 시안 확정
- **사유/세부:** 달성률에 따른 배경 이미지 (우천/화창) 자동 전환, 멤버 랭킹은 가로 스크롤 → 세로 리스트로 변경 (모바일 우선)

### 2. 태그 입력 UX

- **결정:** Bob 이 5/15 까지 PR
- **사유/세부:** 엔터 트리거가 모바일 키보드에서 의도치 않게 발생 → 명시적 "추가" 버튼 + 모달 패턴

---

## ✅ TODO 제안 (기술 검토 및 설계 고민)

1. **[QA] 사용성 테스트 시나리오:**
   - Carol 이 5/16 까지 시나리오 작성, 5/17 dry-run
2. **[FE] 비디오 SDK CSS 커스텀 한계 조사:**
   - 추가 조사 후 SDK 교체 or 워크어라운드 결정

---

**멘토 코멘트:** (이번 회의는 일반 회의 — 멘토 미참여)
```

화자 이름은 `recordings/<id>-<UserName>.flac` 의 `<UserName>` 부분에서 자동 추출됩니다. 단일 트랙 입력은 `mixed` 라는 단일 라벨로 처리됩니다.

---

## 📚 프로젝트 문서 (Project Documents)

이 프로젝트가 어떻게 만들어졌는지 궁금하다면:

- **[docs/PRD.md](docs/PRD.md)** — v1.0 OSS 공개 기준 제품 요구사항 정의서. 목표·비목표·수용 기준(S1~S10)·도메인 모델·평가 원칙.
- **[docs/AI-WORKFLOW.md](docs/AI-WORKFLOW.md)** — AI 코딩 툴(Claude Code · Ouroboros) 활용 회고. Phase A (Claude Code 단독으로 파이프라인 구축) → Phase B (Ouroboros 보조로 1.5일 만에 OSS 공개 준비) 의 2단계 구조.

---

## 📜 라이선스 (License)

MIT 라이선스 — 자세한 내용은 [LICENSE](LICENSE) 파일 참고.
