# meeting-ai — 프로젝트 가이드라인

> 본 문서는 이 레포지토리에서 작업하는 AI 어시스턴트(주로 Claude Code) 와 인간 기여자가 따라야 할 규칙·관례를 정의합니다. 룰 변경은 PR 로.

---

## 0. 프로젝트 개요

- **무엇**: 회의 오디오 → 전사(STT) → AI 요약 → 팀 채널(Discord/Notion/GitHub Wiki) 업로드 자동화 파이프라인.
- **현재 버전**: v1.0.1 (출시 완료, 2026-05-12)
- **활성 시드**: [`.ouroboros/seed_v1_oss.yaml`](.ouroboros/seed_v1_oss.yaml) — 모든 작업은 이 시드의 scope·constraints·acceptance criteria 를 따른다.
- **참조 문서**: [README.md](README.md), [docs/PRD.md](docs/PRD.md), [docs/AI-WORKFLOW.md](docs/AI-WORKFLOW.md), [CHANGELOG.md](CHANGELOG.md)

---

## 1. 코드 구조 제약 (변경 금지)

- **평평한 5개 `.js` 모듈 유지**. 신규 디렉토리·추상화 도입 금지.
  - `transcribe.js` · `summarize.js` · `discord.js` · `notion.js` · `github_wiki.js`
- **오케스트레이션은 `run_all.js` 단일 진입점**.
- **큰 구조 리팩토링은 시드 out-of-scope**. 필요하면 별도 시드로 새로 시작.
- 파이프라인 각 단계의 실패는 반드시 `process.exitCode = 1` 로 전파한다 (커밋 `d7dc92a` 패턴 유지).

---

## 2. 언어 정책

- **1차 시민은 한국어**: 응답·문서·기본 프롬프트·CLI 출력·커밋 메시지·코드 주석.
- **영어는 i18n 트랙으로 분리**: `README.en.md`, `prompts/*.en.md` 같은 별도 파일.
- 한 파일에 한/영을 섞지 않는다 (본 CLAUDE.md 본문 포함).
- 시드 acceptance ID·기술 식별자(`S1`~`S10` 등) 는 영문 유지.

---

## 3. Git 워크플로우 (필수)

### 3.1 브랜치 규칙

- **`main` 직접 커밋·푸시 절대 금지**. 모든 변경은 feature 브랜치 + PR.
- 브랜치 네이밍: `<type>/<slug>` (kebab-case)
  - `feat/<slug>` — 새 기능
  - `fix/<slug>` — 버그 수정
  - `docs/<slug>` — 문서만 (코드 무변경)
  - `chore/<slug>` — 리팩토링·빌드·의존성·릴리스
- **1 논리 변경 = 1 브랜치 = 1 PR**.
- 커밋 메시지 접두사는 Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `perf:` 등).

### 3.2 PR 생성

- `gh pr create --title "..." --body "$(cat <<'EOF' ... EOF)"` (HEREDOC 으로 본문 전달).
- 제목: 70자 이내, Conventional Commits 접두사 사용.
- 본문 필수 섹션: `## Summary` (1~3 bullet), `## Test plan` (체크리스트).

### 3.3 머지 정책 — QA-PASS 기반 자동 머지

PR 생성 직후 `/ouroboros:qa` (또는 동급 코드 리뷰 판단) 를 PR diff 에 실행한다.

| 결과 | 액션 |
| --- | --- |
| `verdict = pass` (score ≥ 0.80) | **자동 squash merge**: `gh pr merge --squash --delete-branch` |
| `verdict = revise` | 지적 사항을 자체 수정 후 재검증 (반복 루프) |
| `verdict = fail` | 사용자에게 surface, 명시적 승인 대기 |
| **고위험 변경** | PASS 여도 자동 머지 금지, 사용자 명시적 승인 대기 |

**"고위험 변경" 정의**: 외부 시스템 영향(API·webhook 호출), DB·파일 마이그레이션, 보안·인증·권한, 토큰/시크릿 취급, shell exec, 의존성 메이저 업그레이드.

머지 후: `git checkout main && git pull` 로 동기화.

### 3.4 머지 금지 시그널

다음 중 하나라도 PR diff 에 있으면 자동 머지를 멈추고 surface:

- `.env` 또는 토큰 관련 파일 변경
- `setup.sh` · `whisper.cpp/` · 빌드 스크립트의 비-trivial 변경
- main 브랜치 보호 정책 변경

---

## 4. 검증·테스트 정책

### 4.1 업로드 모듈 smoke test 금지 (사고 사례 기반)

- `discord.js` · `notion.js` · `github_wiki.js` 를 **`.env` 파일이 있는 cwd 에서 직접 `require` + 호출하지 말 것**.
- 이유: `dotenv` 가 실 토큰을 주입해 운영 시스템에 모의 데이터가 발송될 수 있음 (과거 발송 직전까지 간 사고 경험).
- 검증할 때는 **guard 로직(토큰 부재 자동 스킵) 만 격리 환경에서** 확인.

### 4.2 외부 시스템 영향 변경

- 외부 API 호출·shell exec 가 포함된 코드 변경은 PR diff 단계에서 §3.3 의 "고위험 변경" 으로 분류.
- QA PASS 받아도 자동 머지하지 말고 사용자 승인 대기.

### 4.3 빠른 회귀 검증

- 5h 회의 전체 회귀 대신 `recordings/` 의 ~1분 짧은 샘플로 우선 검증 (가이드: [`recordings/README.md`](recordings/README.md)).
- `npm run doctor` 로 의존성 누락을 사전 차단.

---

## 5. 큰 결정 앞에서

- **"그게 정말 필요한가?" 를 데이터로 먼저 측정**하고 결정한다 (Mode B 폐기 사례: 멀티트랙 vs 단일트랙 6+1 기준 비교 후 폐기).
- 직관·추측 기반의 큰 구조 변경 금지. 작은 검증 PR 로 가설을 먼저 확인.
- 의심스러운 follow-up 은 곧바로 고치지 말고 **별도 PR 후보로 분리** → §6.2 또는 GitHub Issue 에 누적.

---

## 6. 현재 상태 & 미해결 follow-up

### 6.1 v1.0 시드 acceptance — 10/10 충족 (완료)

PR ↔ AC 매핑은 [CHANGELOG.md](CHANGELOG.md) 또는 [docs/PRD.md §7](docs/PRD.md) 참조.

### 6.2 시드 외 follow-up 후보 (QA 식별)

| 브랜치명 | 내용 | 출처 |
| --- | --- | --- |
| `chore/secure-env-perm` | `setup.sh` 에 `cp .env.example .env` 직후 `chmod 600 .env` 추가 | PR #5 QA |
| `chore/secure-git-exec` | `github_wiki.js` git clone 의 PAT 인자 노출을 `spawnSync` + `GIT_ASKPASS` 로 | PR #4 QA |
| `feat/doctor-deep` | `doctor.js --deep` 옵션 (whisper-cli/ffmpeg 실제 실행 검증, 모델 사이즈 sanity) | PR #6 QA |
| `feat/doctor-windows-guard` | `doctor.js` Windows 명시 차단 | PR #6 QA |
| `feat/setup-pkgmgr-detect` | `setup.sh` Linux 패키지 매니저 자동 감지 (apt/dnf/pacman) | PR #5 QA |
| `feat/setup-clean-build` | `setup.sh` 재빌드 시 `build/` 캐시 클린 옵션 | PR #5 QA |

S1 (5h 4-화자 ~10분 회귀) 은 사용자 실측 항목.

---

## 7. Ouroboros (선택적 도구)

`Ouroboros` 는 이 프로젝트에서 **v1.0 OSS 공개 준비 phase(1.5일) 에서만 사용된** 워크플로우 보조 도구입니다. 본체 파이프라인은 Claude Code 단독으로 만들어졌습니다 ([docs/AI-WORKFLOW.md](docs/AI-WORKFLOW.md) 참조).

새 작업에서 Ouroboros 가 어울리는 경우:

- 모호한 요구를 시드로 좁힐 때 → `/ooo interview` + `/ooo seed`
- PR diff 자동 리뷰 → `/ouroboros:qa`
- 시드 acceptance vs 현재 상태 드리프트 측정 → `/ooo status`

> 아래 `ooo:START` ~ `ooo:END` 블록은 Ouroboros 가 자동 관리합니다. 수동 편집 시 다음 sync 에 덮어쓰일 수 있으므로 직접 수정하지 말 것.

<!-- ooo:START -->
<!-- ooo:VERSION:0.36.0 -->
# Ouroboros — Specification-First AI Development

> Before telling AI what to build, define what should be built.
> As Socrates asked 2,500 years ago — "What do you truly know?"
> Ouroboros turns that question into an evolutionary AI workflow engine.

Most AI coding fails at the input, not the output. Ouroboros fixes this by
**exposing hidden assumptions before any code is written**.

1. **Socratic Clarity** — Question until ambiguity ≤ 0.2
2. **Ontological Precision** — Solve the root problem, not symptoms
3. **Evolutionary Loops** — Each evaluation cycle feeds back into better specs

```
Interview → Seed → Execute → Evaluate
    ↑                           ↓
    └─── Evolutionary Loop ─────┘
```

## ooo Commands

Each command loads its agent/MCP on-demand. Details in each skill file.

| Command | Loads |
|---------|-------|
| `ooo` | — |
| `ooo interview` | `ouroboros:socratic-interviewer` |
| `ooo seed` | `ouroboros:seed-architect` |
| `ooo run` | MCP required |
| `ooo evolve` | MCP: `evolve_step` |
| `ooo evaluate` | `ouroboros:evaluator` |
| `ooo unstuck` | `ouroboros:{persona}` |
| `ooo status` | MCP: `session_status` |
| `ooo setup` | — |
| `ooo help` | — |

## Agents

Loaded on-demand — not preloaded.

**Core**: socratic-interviewer, ontologist, seed-architect, evaluator,
wonder, reflect, advocate, contrarian, judge
**Support**: hacker, simplifier, researcher, architect
<!-- ooo:END -->
