# AI 코딩 툴 활용 회고 — meeting-ai

> 1인 개발자가 AI 코딩 툴(Claude Code · Ouroboros) 로 meeting-ai 를 어떻게 만들었는가에 대한 기록.

이 프로젝트는 **두 단계** 로 만들어졌습니다.

- **Phase A — Claude Code 단독**: 실제로 동작하는 회의록 파이프라인 자체를 구축한 단계. 본 프로젝트의 본체. (commit `f14b21e` ~ `cd9b4be`)
- **Phase B — Ouroboros 보조 (1.5일)**: 이미 정상 동작하던 파이프라인을 *"다른 사람도 불편 없이 쓸 수 있도록"* OSS 로 공개 준비한 단계. (PR #1 ~ #18, 2026-05-11 ~ 2026-05-12)

즉, Ouroboros 는 **본체를 만든 도구가 아니라, 공개 준비 phase 의 부가 도구** 입니다. 본체는 Claude Code 단독으로 만들어졌습니다.

---

## 1. 사용한 도구

| 도구                                   | 역할                                                                                                                            | 사용 범위           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| **Claude Code** (Opus 4.7, 1M context) | 모든 코드 작성·리뷰·문서화·git 작업의 진입점. 터미널에서 직접 실행. **본 프로젝트의 본체(파이프라인) 구축은 이 도구 단독으로.** | Phase A + Phase B   |
| **Ouroboros** (Claude Code 플러그인)   | "코드 짜기 전 명세를 짜는" 워크플로우 엔진. Socratic Interview → Seed → Execute → Evaluate 루프.                                | **Phase B 한정**    |
| **Auto Memory**                        | `~/.claude/projects/.../memory/` 의 파일 기반 메모리. 세션이 끊겨도 사용자 선호·프로젝트 결정이 다음 대화로 이어짐.              | Phase A·B 모두 활용 |
| **`CLAUDE.md`**                        | 프로젝트 루트의 가이드라인. 브랜치 네이밍, "QA PASS 시 자동 머지" 같은 정책을 명시 → AI 가 매번 다시 묻지 않음.                  | Phase B 에서 추가   |

## 2. 두 단계 구조

```
                ┌───────────────────────────────────────────────┐
                │  Phase A — Claude Code 단독                   │
                │  "회의록 자동화 파이프라인 자체를 구축"       │
                │                                               │
                │  · Python → Node.js 마이그레이션              │
                │  · whisper.cpp 도입 + Metal 가속              │
                │  · 5단계 파이프라인 (transcribe → summarize   │
                │    → discord → notion → wiki)                 │
                │  · 할루시네이션 필터, exit code 전파          │
                │  · 전사 속도 2배 개선 (20분 → 10분 @ 5h)      │
                │                                               │
                │  → 결과: 본인이 잘 쓰던 동작하는 파이프라인   │
                └───────────────────────────────────────────────┘
                                    │
                                    ▼
                ┌───────────────────────────────────────────────┐
                │  Phase B — Ouroboros 보조 (1.5일)             │
                │  "다른 사람도 쓸 수 있게 OSS 로 공개 준비"    │
                │                                               │
                │  · Socratic Interview → Seed v1.0             │
                │  · setup.sh / doctor / env 외부화             │
                │  · 업로드 토큰 부재 자동 스킵                 │
                │  · MIT 라이선스 + 영어 README                 │
                │  · QA-PASS 기반 자동 머지 정책                │
                │                                               │
                │  → 결과: v1.0.1 OSS 릴리스, PR 18개 머지      │
                └───────────────────────────────────────────────┘
```

---

## 3. Phase A — Claude Code 단독으로 파이프라인 구축

이 단계에서는 Ouroboros 없이 Claude Code 만 썼습니다. 목표는 **"내가 쓸 수 있는 회의록 자동화 도구"** — 외부 사용자 고려 없이 작동성 자체에 집중.

### 3.1 주요 마일스톤 (커밋 추적)

| 커밋        | 내용                                                                  |
| ----------- | --------------------------------------------------------------------- |
| `f14b21e`   | Initial commit                                                        |
| `d2f8254`   | 초기 Whisper + Gemini 분석 스크립트 (Python)                          |
| `ff4ef28`   | whisper.cpp 로 리팩토링 (Python whisper → C++ 코어, Metal 가속)       |
| `a3fe64e`   | Node.js 환경으로 마이그레이션 (Python → JS)                           |
| `eefc65c`   | Notion / GitHub Wiki 업로드 모듈 추가                                 |
| `46fb52f`   | 할루시네이션 방지 로직 (`BANNED_PHRASES` + 시간 윈도우 중복 제거)     |
| `d7dc92a`   | 파이프라인 각 단계 실패가 `exit code` 에 반영되도록 수정              |
| `cd9b4be`   | **전사 속도 약 2배 개선** (20분 → 10분 @ 5h 오디오, Apple Silicon)    |

### 3.2 Phase A 에서 Claude Code 의 역할

- **언어/스택 마이그레이션 의사결정 보조** — Python whisper 의 한계(속도) → whisper.cpp 도입, Python 오케스트레이션 → Node.js 마이그레이션을 함께 결정·실행.
- **성능 튜닝** — concurrency·threads 자동 계산 공식(`Math.floor((totalGB - 4) / 3)`, Apple Silicon P-core 우선) 도출.
- **할루시네이션 패턴 식별** — Whisper 가 한국어 회의에서 반복 출력하는 정형 문구를 잡아내고 `BANNED_PHRASES` 로 필터링.
- **각 모듈 분리** — `transcribe.js` / `summarize.js` / `discord.js` / `notion.js` / `github_wiki.js` 평평한 5개 파일 구조.

이 단계에서는 PR 분리·자동 머지 정책 같은 외부 협업 장치는 없었습니다. 혼자 쓰는 도구라 main 에 직접 커밋도 자유로웠음.

---

## 4. Phase B — Ouroboros 로 OSS 공개 준비 (1.5일)

이미 정상 동작하던 도구를 외부 사용자에게 노출하려면 다른 문제들이 생깁니다.

- 내 환경(Mac M3 Pro) 외 다른 환경에서 빌드가 될까?
- 본인 팀 ID 가 박힌 prompt 가 코드에 하드코딩돼 있음.
- 업로드 모듈에 토큰이 없으면 그냥 죽음.
- 라이선스도 없음.

이 문제들은 *"명세를 먼저 짜고 → AC 단위로 쪼개서 → 정책적으로 머지"* 하는 워크플로우와 잘 맞는다고 판단해서, **Phase B 에 한해서만** Ouroboros 를 끌어들였습니다.

### 4.1 Phase B 내부 워크플로우

```
            ┌─────────────────────────────────────┐
            │  B-1. Socratic Interview            │   Ouroboros 가 모호성 0.85 → 0.10 까지
            │  (/ooo interview)                   │   질문으로 좁힘
            └─────────────────────────────────────┘
                              │
                              ▼
            ┌─────────────────────────────────────┐
            │  B-2. Seed v1.0 작성                │   goal / constraints / AC(S1~S10)
            │  (.ouroboros/seed_v1_oss.yaml)      │   여기서부터 "단일 진실원(SSoT)"
            └─────────────────────────────────────┘
                              │
                              ▼
            ┌─────────────────────────────────────┐
            │  B-3. PR 단위 실행                  │   AC 1개 = PR 1개. 평평한 18개 PR.
            │  (feat/fix/chore/docs 브랜치)       │
            └─────────────────────────────────────┘
                              │
                              ▼
            ┌─────────────────────────────────────┐
            │  B-4. QA-PASS 자동 머지             │   /ouroboros:qa → score ≥ 0.80 →
            │  (/ouroboros:qa → gh pr merge)      │   squash merge. revise/fail 시 자체 수정.
            └─────────────────────────────────────┘
                              │
                              ▼
            ┌─────────────────────────────────────┐
            │  B-5. Release                       │   CHANGELOG + GitHub release v1.0.1
            │  (chore/release-v1)                 │
            └─────────────────────────────────────┘
```

### 4.2 B-1 Socratic Interview

처음 의도는 *"지금 도구를 OSS 로 공개하고 싶다"* — 매우 모호. Ouroboros 의 `/ooo interview` 가 결정되지 않은 가정을 강제 노출:

- **Q**: 단일 트랙 + diarization (Mode B) 도 OSS 에 포함? → **A**: 데이터로 검증 후 결정 → Phase B-2 에서 폐기 결정.
- **Q**: Windows 도 공식 지원? → **A**: No. WSL 권장.
- **Q**: 셋업 목표 시간? → **A**: 1시간.
- **Q**: 업로드 모듈이 없는 사용자는? → **A**: 토큰 부재 시 자동 스킵.

**모호성 점수**: 0.85 → 0.25 → 0.10 (3 라운드).

### 4.3 B-2 Seed v1.0

인터뷰 결과를 [`.ouroboros/seed_v1_oss.yaml`](../.ouroboros/seed_v1_oss.yaml) 한 파일로 응축. Phase B 동안의 단일 진실원.

가장 비싼 결정: **Mode B (단일트랙 + diarization) 폐기**.

- 멀티트랙 vs 단일트랙 6+1 기준 비교 → **6/7 기준 동등 또는 우수**.
- 2주 추가 작업 + Python/pyannote/HF 토큰 영구 의존성 비용 절약.
- 큰 결정 앞에서 *"그게 정말 필요한가?"* 를 데이터로 측정한 후 결정 (`feedback_verify_before_build.md` 메모리에 적재).

### 4.4 B-3 AC ↔ PR 1:1 매핑

| PR                      | AC      | 내용                                                                 |
| ----------------------- | ------- | -------------------------------------------------------------------- |
| #1, #2, #7              | S8      | `PROMPT_PATH` 외부화 + `prompts/default.md` + `prompts/mentoring.md` |
| #3                      | S2      | 단일 트랙 입력 지원 + `meeting.*` 합본 가드                          |
| #4                      | S3      | 업로드 토큰 부재 자동 스킵                                           |
| #5                      | S5, S6  | `setup.sh` + 플랫폼 자동 감지 + 모델 인터랙티브                      |
| #6                      | S7      | `npm run doctor`                                                     |
| #9                      | S9      | `WHISPER_LANG` env                                                   |
| #10, #12, #14, #16, #17 | S4      | 의존성 자동 설치, 모델 재시도, doctor 핸드오프, README 보강          |
| #11, #13                | S10     | MIT + 영어 README                                                    |
| #15, #18                | release | CHANGELOG                                                            |

**브랜치 규칙** (CLAUDE.md 에 명시 — Phase B 에서 도입):

- `feat/` · `fix/` · `chore/` · `docs/` 접두사 + kebab-case
- **main 직접 커밋 금지**. 모든 변경은 PR.
- 머지 전략: **squash merge** (선형 히스토리 유지).

### 4.5 B-4 QA-PASS 자동 머지 정책

PR 생성 직후 `/ouroboros:qa` 로 PR diff 평가:

- `verdict = pass` (score ≥ 0.80) → **자동 squash merge**.
- `verdict = revise` → AI 가 지적 사항 자체 수정 후 재검증.
- `verdict = fail` 또는 **고위험 변경** (외부 시스템·마이그레이션·보안) → 사용자에게 surface, 명시적 승인 대기.

정책은 메모리(`feedback_wait_for_merge_approval.md`)에 저장돼 매 PR 마다 사용자가 다시 지시할 필요 없음.

### 4.6 B-5 Release

`v1.0.0` → `v1.0.1` 두 차례. `CHANGELOG.md` 는 Keep-a-Changelog 형식 + Seed AC ↔ PR 추적 표 포함.

---

## 5. AI 가 의사결정에 기여한 사례 (Phase B)

### 5.1 사고 회피 — 토큰 노출

PR #5 QA 단계에서 AI 가 식별:

> `setup.sh` 의 `cp .env.example .env` 직후 `chmod 600 .env` 추가 필요.

직접 수정하지 않고 follow-up (`chore/secure-env-perm`) 으로 분리해 현재 PR 스코프를 보존.

### 5.2 사고 회피 — 업로드 모듈 smoke test 사고

초기에 AI 가 업로드 모듈 통합 검증을 위해 `.env` 가 있는 cwd 에서 `discord.js` 등을 직접 require + 호출하려 했음. dotenv 가 토큰을 주입 → **실 운영 시스템에 모의 데이터 발송 직전** 까지 감.

→ 메모리(`feedback_dotenv_smoke_test_disaster.md`): "업로드 모듈은 .env 있는 cwd 에서 직접 호출하지 말 것. guard 로직만 격리 검증."

### 5.3 follow-up 식별

각 PR QA 가 *지금 고치지 말고 별도 PR 로 분리해야 할 항목* 을 자동 식별 → `CLAUDE.md` 의 "Next Action" 섹션에 누적. 인간이 우선순위만 결정.

---

## 6. 메트릭

### 6.1 Phase A (Claude Code 단독)

| 항목                | 값                                                      |
| ------------------- | ------------------------------------------------------- |
| 산출물              | 동작하는 회의록 파이프라인 (5개 `.js` 모듈)             |
| 핵심 성과           | 전사 속도 2배 개선 (20분 → 10분 @ 5h 오디오)            |
| 스택 변화           | Python → Node.js, OpenAI whisper → whisper.cpp (Metal) |

### 6.2 Phase B (Ouroboros 보조, 1.5일)

| 항목                | 값                                                      |
| ------------------- | ------------------------------------------------------- |
| 머지된 PR 수        | 18                                                      |
| Acceptance Coverage | 10 / 10 (S1~S10)                                        |
| 모호성 점수 변화    | 0.85 → 0.10                                             |
| 산출물              | OSS 공개 준비물 (setup.sh, doctor, MIT, 영어 README 등) |
| 최종 릴리스         | v1.0.1                                                  |

---

## 7. 회고

### 7.1 잘 작동한 것

- **Phase 를 도구로 분리한 것**. 작동성 자체는 Claude Code 단독 빠른 반복으로, 외부 공개는 Ouroboros 의 명세-우선 프로세스로 — 도구를 작업 성격에 맞춰 분리하니 둘 다 효율이 좋았음.
- **Phase B 에서 명세를 코드보다 먼저 굳히기**. Seed YAML 이 단일 진실원이 되니 PR 스코프 다툼이 사라짐. AC 외 변경은 "이건 v1.1" 로 자동 reject.
- **메모리로 정책 누적**. 매 세션마다 같은 지시("한국어 우선", "QA PASS 자동 머지")를 반복할 필요 없음.
- **AC 1개 = PR 1개**. 머지 후 회귀 발생 시 어느 PR 인지 즉시 추적 가능.
- **데이터로 큰 결정 검증**. Mode B 폐기는 직관이 아니라 6/7 기준 수치로 결정 → 후회 없음.

### 7.2 한계

- **AI 가 실측 데이터를 만들 수는 없음**. S1(5h 회의 ~10분), S4(1시간 내 셋업) 은 사용자가 직접 실행해서 확인.
- **AI 가 외부 시스템에 사고 칠 수 있음**. Smoke test 사고처럼 dotenv + 실 토큰 환경에서는 격리 검증 정책을 사람이 미리 세워야 함.
- **AI 의 자기 회고는 약함**. follow-up 누적은 잘 하지만, "이 정책 자체가 틀렸을 수 있다" 같은 메타 회고는 인간이 트리거해야 발생.
- **Ouroboros 가 모든 작업에 맞는 건 아님**. Phase A 같은 "혼자 쓰는 도구를 빠르게 동작시키기" 단계에서는 Socratic Interview 가 오히려 마찰. 도구는 phase 에 따라 선별 적용해야 함.

### 7.3 다음 프로젝트에 가져갈 패턴

1. **도구를 phase 별로 선별 적용**. 빠른 프로토타이핑 ↔ 외부 공개 준비는 다른 도구셋이 어울림.
2. **첫 30분은 인터뷰 (외부 공개·협업 phase 한정)**. 모호성 점수가 0.3 미만이 될 때까지 코드 한 줄도 쓰지 않음.
3. **Seed = PRD = SSoT**. 별도 PRD 문서를 사람이 다시 쓰는 건 낭비. Seed 를 PRD 로 직접 사용.
4. **AC ↔ PR 1:1**. 머지 가능한 최소 단위로 쪼개기.
5. **QA 자동 머지 + 고위험 surface**. 단순 변경은 AI 자율, 위험한 변경은 인간 게이트.
6. **메모리로 정책 영구화**. 두 번 같은 지시를 했다면 즉시 메모리에 적재.

---

## 부록 — 재현 가능한 명령 예시 (Phase B 워크플로우)

```bash
# 1. 인터뷰 (모호성 좁히기)
/ooo interview

# 2. 시드 생성
/ooo seed

# 3. AC 단위로 PR 작업 (예: S2 단일 트랙 지원)
git checkout -b feat/input-format-contract
# ... AI 가 transcribe.js 수정 + 테스트 ...
gh pr create --title "feat(transcribe): .wav/.mp3 입력 지원" --body "Refs S2"

# 4. QA → 자동 머지
/ouroboros:qa  # verdict=pass → AI가 gh pr merge --squash --delete-branch 실행

# 5. 진행 상황 점검 (드리프트 측정)
/ooo status
```
