# Changelog

본 프로젝트의 모든 주요 변경사항을 기록합니다.

형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/) 를 따르며, 본 프로젝트는 [Semantic Versioning](https://semver.org/lang/ko/) 을 준수합니다.

## [1.0.0] — 2026-05-12

**meeting-ai v1.0** — OSS(MIT) 초기 공개 릴리스. 시드 `seed_v1_oss.yaml` 의 v1.0 acceptance criteria 충족.

### Added (신규)
- **`setup.sh`** — Mac(Apple Silicon Metal)/Linux(CUDA·CPU) 자동 감지 + whisper.cpp 빌드 + 인터랙티브 모델 선택 + npm install + `.env` 초기화 일괄 처리 (#5)
- **`npm run doctor`** — Node/FFmpeg/whisper-cli/모델/`.env` 의존성 헬스 체크. 필수 누락 시 exit 1 (#6)
- **`PROMPT_PATH` env** — 요약 프롬프트 외부화. `prompts/default.md` (한국어 도메인 중립), `prompts/mentoring.md` (멘토링 회의 예시) 제공 (#1, #2, #7)
- **`WHISPER_MODEL` env** — `.env` 로 whisper.cpp 모델 변경 가능 (tiny/base/small/medium/large-v3/large-v3-turbo) (#5)
- **`WHISPER_LANG` env** — 전사 언어 환경변수. 기본 `ko`, `auto` 또는 ISO-639-1 코드 지정 가능 (#9)
- **단일 트랙 입력 지원** — `.flac`/`.wav`/`.mp3` 자동 감지. 같은 폴더의 `meeting.*` 합본 파일은 자동 스킵 (#3)
- **`LICENSE`** — MIT 라이선스 (#11)
- **`README.en.md`** — 영어 README. README.md (한국어 1차) ↔ README.en.md 상호 링크 (#13)

### Changed (변경)
- 업로드 모듈 (`discord.js`/`notion.js`/`github_wiki.js`) — `.env` 토큰 부재 시 자동 스킵 + 로그 (#4)
- `package.json` — `"license": "ISC"` → `"MIT"` (#11)
- `.env.example` — 모든 주석 영문 1차로 통일 (OSS 발견성) (#13)

### Performance (성능)
- 전사 파이프라인 속도 약 2배 개선 (20분 → 10분 @ 5h 오디오, Apple Silicon M3 Pro 기준, `cd9b4be`)

### Constraints (제약 — 의도된 비범위)
- 로컬 실행 only (SaaS/클라우드 인프라 없음)
- 평평한 5개 `.js` 구조 유지 (대규모 리팩토링 없음)
- Mode B (단일트랙 + diarization) 폐기 — 멀티트랙 대비 동등 또는 우수 (6/7 기준) 검증 후 결정. v1.1 에서 재검토 가능
- Docker 미지원 (Apple Silicon Metal 가속 무효화 이슈)
- Windows 공식 미지원 (WSL 권장)

### Seed Acceptance Coverage

| AC | 항목 | PR |
|---|---|---|
| S1 | 5h 4-화자 ~10분 회귀 | 사용자 실측 (Mode A 회귀 없음 확인) |
| S2 | 단일 트랙 입력 자동 감지 | #3 |
| S3 | 업로드 토큰 부재 자동 스킵 | #4 |
| S4 | 1시간 내 첫 회의록 셋업 | 사용자 실측 |
| S5 | setup.sh 모델 인터랙티브 | #5 |
| S6 | setup.sh 플랫폼 자동 감지 | #5 |
| S7 | npm run doctor 의존성 헬스 체크 | #6 |
| S8 | PROMPT_PATH 외부화 + 예시 | #1, #2, #7 |
| S9 | WHISPER_LANG env | #9 |
| S10 | MIT + 영어 README | #11, #13 |

[1.0.0]: https://github.com/kwonjin2/whisper/releases/tag/v1.0.0
