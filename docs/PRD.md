# meeting-ai — Product Requirements Document (PRD)

> v1.0 OSS 공개 기준 PRD. 원본 명세는 [`.ouroboros/seed_v1_oss.yaml`](../.ouroboros/seed_v1_oss.yaml) 이며, 본 문서는 평가/리뷰 목적으로 사람이 읽기 좋은 형태로 변환한 사본입니다.

- **버전**: v1.0 (현재 출시본 v1.0.1)
- **작성일**: 2026-05-12
- **작성자**: kwonjin2 (1인 개발)
- **상태**: Shipped — GitHub release [v1.0.1](https://github.com/kwonjin2/whisper/releases/tag/v1.0.1)

---

## 1. 개요 (Executive Summary)

**meeting-ai** 는 회의 오디오를 입력하면 화자별 텍스트 전사 → AI 요약 → 팀 채널(Discord/Notion/GitHub Wiki) 업로드까지 자동화하는 **로컬 실행 파이프라인**입니다.

- `setup.sh` 한 번 + `npm run doctor` 한 번 → 1시간 내 첫 회의록 생성.
- 클라우드/SaaS 없이 **로컬 whisper.cpp** (Apple Silicon Metal · Linux CUDA·CPU 자동 감지) 로 동작.
- 업로드 모듈은 `.env` 토큰 부재 시 자동 스킵 → "전사+요약만" 사용도 자연스럽게 가능.

## 2. 배경 / 문제 정의

회의 녹취 자동화 도구는 대부분 SaaS 형태(Otter, Fireflies 등) 이며, 다음 문제가 있습니다.

1. **데이터 주권** — 회의 음성을 외부 서버에 업로드해야 함.
2. **비용** — 시간 단위 과금 → 장시간 미팅은 부담.
3. **커스터마이즈 제약** — 요약 프롬프트·업로드 대상이 고정.

본 프로젝트는 **whisper.cpp 로컬 가속 + Gemini API + 자체 호스팅 업로드** 조합으로 위 세 문제를 동시에 해결합니다.

## 3. 목표 (Goal)

> 멀티/단일 트랙 회의 오디오를 로컬 whisper.cpp(Metal/CUDA)로 전사·요약하고, 선택적으로 Notion/Discord/Wiki에 업로드하는 파이프라인을, `setup.sh` + `npm run doctor` 한 번으로 1시간 내 셋업 가능한 OSS(MIT) v1.0으로 공개.

### 3.1 비목표 (Non-goals / Out of Scope)

- **Mode B (단일트랙 + diarization)** — 멀티트랙 입력 대비 6/7 기준 동등 또는 우수함을 데이터로 검증 후 폐기. v1.1 에서 멘토링 시나리오로 재검토 가능.
- **Docker 지원** — Apple Silicon Metal 가속이 컨테이너에서 무효화됨.
- **Windows 공식 지원** — WSL 권장. v2.0 또는 커뮤니티 PR 대상.
- **SaaS / 결제 / 멀티테넌시 / 인증** — 로컬 only 원칙 위배.
- **자체 녹음 도구** — 입력은 외부 녹음본(Craig 등)을 가정.
- **큰 코드 구조 리팩토링** — 평평한 5개 `.js` 구조 유지.

## 4. 사용자 페르소나

| 페르소나                      | 목적                       | 우선 시나리오                                            |
| ----------------------------- | -------------------------- | -------------------------------------------------------- |
| **소규모 팀 리드**            | 정기 팀 회의 회의록 자동화 | Discord 멀티트랙(Craig) 녹음 → Notion 업로드             |
| **1:1 멘토링 운영자**         | 멘토링 세션 기록 보존      | 단일 트랙 mp3 → Wiki 업로드, `prompts/mentoring.md` 활용 |
| **개인 사용자 (데이터 민감)** | 회의 내용 외부 유출 방지   | 업로드 모듈 전체 비활성, 로컬 마크다운만 사용            |

## 5. 기능 요구사항 (Functional Requirements)

### 5.1 핵심 파이프라인 (5단계)

| 단계       | 모듈             | 입력                          | 출력                                    |
| ---------- | ---------------- | ----------------------------- | --------------------------------------- |
| 1. 전사    | `transcribe.js`  | `recordings/*.flac\|wav\|mp3` | `transcripts/meeting_with_speakers.txt` |
| 2. 요약    | `summarize.js`   | 전사 텍스트 + `PROMPT_PATH`   | `meeting_summary.md`                    |
| 3. Discord | `discord.js`     | 요약 MD                       | Discord 채널 발송 (토큰 있을 때)        |
| 4. Notion  | `notion.js`      | 요약 MD                       | Notion 페이지 생성 (토큰 있을 때)       |
| 5. Wiki    | `github_wiki.js` | 요약 MD                       | GitHub Wiki 페이지 생성 (토큰 있을 때)  |

오케스트레이션: `run_all.js` → 각 단계 `execSync('npm run X')`. 실패 시 `process.exitCode = 1` 전파.

### 5.2 입력 계약

- **멀티트랙 모드**: `recordings/` 에 화자별 파일 N개 (`*-<speaker-id>.flac`). 화자 식별자 = 파일명 `split('-')[1:].join('-')`.
- **단일트랙 모드**: `recordings/` 에 단일 파일 1개. 화자 라벨 `mixed` 로 통일.
- 합본 가드: 멀티트랙 폴더 안의 `meeting.*` 합본 파일은 자동 스킵.

### 5.3 환경변수 (Public Contract)

| 변수                                      | 기본값               | 역할                           |
| ----------------------------------------- | -------------------- | ------------------------------ |
| `WHISPER_MODEL`                           | `large-v3-turbo`     | whisper.cpp 모델 선택          |
| `WHISPER_LANG`                            | `ko`                 | 전사 언어 (`auto` / ISO-639-1) |
| `PROMPT_PATH`                             | `prompts/default.md` | 요약 프롬프트 경로             |
| `GEMINI_API_KEY`                          | — (필수)             | Google Gemini API 키           |
| `NOTION_TOKEN` / `DISCORD_*` / `GITHUB_*` | — (선택)             | 부재 시 해당 업로드 자동 스킵  |

### 5.4 셋업 자동화

- `setup.sh` — 플랫폼 자동 감지 (Mac Apple Silicon Metal · Intel · Linux CUDA · CPU), 의존성 자동 설치(brew/apt), whisper.cpp 빌드, 인터랙티브 모델 다운로드(재시도 3회 + 부분 파일 복구), `npm install`, `.env` 초기화.
- `npm run doctor` — Node/FFmpeg/whisper-cli/모델/`.env` 누락을 한 번에 진단.

## 6. 비기능 요구사항 (Non-functional)

| 항목          | 요구                                                                 |
| ------------- | -------------------------------------------------------------------- |
| **성능**      | 5h 4-화자 멀티트랙 → ~10분 처리 (Apple Silicon M4 Pro 기준)          |
| **이식성**    | macOS (Apple Silicon · Intel) + Linux (CUDA · CPU) 자동 감지         |
| **온보딩**    | 처음 본 개발자가 README + setup.sh 따라 1시간 내 첫 회의록 생성 성공 |
| **라이선스**  | MIT                                                                  |
| **문서**      | 한국어 1차 README + 영어 1차 README(`README.en.md`) 동기             |
| **장애 모드** | 파이프라인 각 단계 실패는 `exit code` 비-0 으로 전파                 |

## 7. 수용 기준 (Acceptance Criteria)

| ID      | 기준                                                                 | 검증 PR / 방법                       |
| ------- | -------------------------------------------------------------------- | ------------------------------------ |
| **S1**  | 5h 4-화자 멀티트랙 회의 ~10분 이내 처리 (Mode A 회귀 없음)           | 사용자 실측                          |
| **S2**  | 단일 트랙 입력(mp3/wav/flac) 자동 감지, 멀티트랙 동등 품질           | PR #3                                |
| **S3**  | Notion/Discord/Wiki `.env` 토큰 부재 시 자동 스킵 + 로그             | PR #4                                |
| **S4**  | README + setup.sh 따라 1시간 내 첫 회의록 생성 성공                  | 사용자 실측 + PR #10/#12/#14/#16/#17 |
| **S5**  | `setup.sh` 모델 인터랙티브 선택                                      | PR #5                                |
| **S6**  | `setup.sh` Mac/Linux 자동 감지 + whisper.cpp 빌드                    | PR #5                                |
| **S7**  | `npm run doctor` 의존성 누락 정확히 보고                             | PR #6                                |
| **S8**  | `PROMPT_PATH` 외부화 + `prompts/default.md` + `prompts/mentoring.md` | PR #1, #2, #7                        |
| **S9**  | `WHISPER_LANG` env 지원                                              | PR #9                                |
| **S10** | MIT LICENSE + 영어 README                                            | PR #11, #13                          |

전체 acceptance coverage: **10 / 10 충족** (`CHANGELOG.md` 표 참조)

## 8. 도메인 모델 (Ontology)

```
MeetingPipeline
├── recordings_dir          : string                  (입력 폴더)
├── input_tracks            : array<File>            (flac/wav/mp3)
├── platform_info           : { os, arch, gpu_backend }
├── whisper_model           : string                  (ggml-*.bin)
├── whisper_lang            : string                  (ko / auto / iso)
├── conversation_segments   : array<{start, speaker, text}>
├── prompt_template_path    : string                  (PROMPT_PATH)
├── summary_markdown        : string                  (최종 회의록)
├── upload_targets          : array<"discord"|"notion"|"wiki">
└── doctor_report           : { node, ffmpeg, whisper_cli, model, env }
```

## 9. 평가 원칙 (가중치)

| 원칙          | 가중치 | 설명                                |
| ------------- | ------ | ----------------------------------- |
| 전사 정확도   | 0.25   | 한국어 인식 품질, 할루시네이션 제거 |
| 요약 완전성   | 0.25   | 결정·액션·안건·타임라인 누락 없음   |
| 셋업 단순성   | 0.20   | 1시간 내 첫 실행 성공 (S4)          |
| 회귀 방지     | 0.15   | Mode A 멀티트랙 5h→~10분 유지       |
| 플랫폼 이식성 | 0.10   | Mac+Linux 자동 감지 동작            |
| OSS 헬스      | 0.05   | MIT, .env.example, 영어 README      |

## 10. 출시 (Release Plan)

| 마일스톤        | 상태                    | 산출물                                                                                    |
| --------------- | ----------------------- | ----------------------------------------------------------------------------------------- |
| **v1.0.0**      | ✅ Shipped (2026-05-12) | setup.sh + doctor + 입력 표준화 + 업로드 토글 + 외부 prompt + MIT + 영어 README           |
| **v1.0.1**      | ✅ Shipped (2026-05-12) | 의존성 자동 설치, 모델 다운로드 재시도, README Performance/Troubleshooting/출력 샘플 보강 |
| **v1.1 (검토)** | Pending                 | Mode B 재검토(멘토링 시나리오), 추가 업로드 타겟                                          |

### 출시 차단 조건 (Exit Conditions)

- **회귀 차단**: 5h 회의 처리 시간이 15분 초과 시 release 차단.
- **범위 침범 차단**: Mode B / Docker / Windows 공식 지원 / SaaS 관련 PR 은 reject.

## 11. 메타데이터

- **모호성 점수** (Ouroboros): 0.85 → 0.25 → 0.10 (인터뷰 라운드 거치며 수렴)
- **인터뷰 세션**: `ouroboros-tutorial-then-interview-2026-05-12`
- **머지된 PR 수**: 18 (v1.0 기준)
