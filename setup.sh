#!/usr/bin/env bash
# meeting-ai setup — 플랫폼 자동 감지 + whisper.cpp 빌드 + 모델 선택 + 의존성 설치
#
# 사용법:
#   ./setup.sh                # 인터랙티브 모델 선택
#   WHISPER_MODEL=tiny ./setup.sh   # 비대화형, 환경변수로 모델 지정
#
# 지원: macOS (Apple Silicon · Intel), Linux (x86_64 · arm64, CUDA 자동 감지)
# 비지원: Windows (WSL 사용 권장)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WHISPER_DIR="${REPO_ROOT}/whisper.cpp"
MODELS_DIR="${WHISPER_DIR}/models"
WHISPER_REPO="https://github.com/ggerganov/whisper.cpp.git"

# --- 색상 ---
if [[ -t 1 ]]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'; C_RED=$'\033[31m'; C_CYAN=$'\033[36m'
else
  C_RESET=""; C_BOLD=""; C_GREEN=""; C_YELLOW=""; C_RED=""; C_CYAN=""
fi
log()    { printf "%s[setup]%s %s\n" "${C_CYAN}" "${C_RESET}" "$*"; }
ok()     { printf "%s[ ok ]%s %s\n" "${C_GREEN}" "${C_RESET}" "$*"; }
warn()   { printf "%s[warn]%s %s\n" "${C_YELLOW}" "${C_RESET}" "$*" >&2; }
fail()   { printf "%s[fail]%s %s\n" "${C_RED}" "${C_RESET}" "$*" >&2; exit 1; }
hdr()    { printf "\n%s== %s ==%s\n" "${C_BOLD}" "$*" "${C_RESET}"; }

# --- 1. 플랫폼 감지 ---
hdr "1/6 플랫폼 감지"
OS="$(uname -s)"
ARCH="$(uname -m)"

case "${OS}" in
  Darwin)
    PLATFORM="mac"
    if [[ "${ARCH}" == "arm64" ]]; then
      log "macOS Apple Silicon (${ARCH}) — Metal GPU 가속 활성화"
      CMAKE_FLAGS=("-DGGML_METAL=ON")
    else
      log "macOS Intel (${ARCH}) — CPU 빌드"
      CMAKE_FLAGS=("-DGGML_METAL=OFF")
    fi
    ;;
  Linux)
    PLATFORM="linux"
    if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi >/dev/null 2>&1; then
      log "Linux ${ARCH} + NVIDIA GPU 감지 — CUDA 빌드"
      CMAKE_FLAGS=("-DGGML_CUDA=ON")
    else
      log "Linux ${ARCH} — CPU 빌드 (NVIDIA GPU 미감지)"
      CMAKE_FLAGS=()
    fi
    ;;
  *)
    fail "지원하지 않는 OS: ${OS}. Windows 는 WSL 환경에서 다시 시도하세요."
    ;;
esac

# --- 2. 사전 의존성 확인 ---
hdr "2/6 사전 의존성 확인"
MISSING=()
for cmd in git ffmpeg node npm cmake make; do
  if command -v "${cmd}" >/dev/null 2>&1; then
    ok "${cmd} 발견: $(command -v "${cmd}")"
  else
    MISSING+=("${cmd}")
  fi
done
if [[ ${#MISSING[@]} -gt 0 ]]; then
  warn "누락된 도구: ${MISSING[*]}"
  if [[ "${PLATFORM}" == "mac" ]]; then
    warn "macOS 설치 예: brew install ${MISSING[*]}"
  else
    warn "Debian/Ubuntu 설치 예: sudo apt install -y ${MISSING[*]}"
  fi
  fail "필요한 CLI 도구를 먼저 설치한 뒤 다시 실행하세요."
fi

# --- 3. whisper.cpp 준비 (벤더링 또는 클론) ---
hdr "3/6 whisper.cpp 준비"
if [[ -d "${WHISPER_DIR}/.git" ]]; then
  log "whisper.cpp 가 git 서브트리/리포로 이미 존재합니다 — 클론 건너뜀."
elif [[ -d "${WHISPER_DIR}" && -f "${WHISPER_DIR}/CMakeLists.txt" ]]; then
  log "whisper.cpp 가 vendored 상태로 존재합니다 — 클론 건너뜀."
else
  log "whisper.cpp 클론 중..."
  git clone --depth=1 "${WHISPER_REPO}" "${WHISPER_DIR}"
fi

# --- 4. whisper.cpp 빌드 ---
hdr "4/6 whisper.cpp 빌드"
WHISPER_CLI="${WHISPER_DIR}/build/bin/whisper-cli"
if [[ -x "${WHISPER_CLI}" ]]; then
  log "기존 빌드 발견: ${WHISPER_CLI}"
  read -rp "재빌드할까요? [y/N] " REBUILD
  REBUILD="${REBUILD:-N}"
else
  REBUILD="Y"
fi
if [[ "${REBUILD}" =~ ^[Yy]$ ]]; then
  log "cmake 구성 (${CMAKE_FLAGS[*]:-CPU only})"
  (cd "${WHISPER_DIR}" && cmake -B build "${CMAKE_FLAGS[@]}")
  log "빌드 (release, -j)"
  (cd "${WHISPER_DIR}" && cmake --build build --config Release -j)
  ok "빌드 완료: ${WHISPER_CLI}"
else
  ok "기존 빌드 유지."
fi

# --- 5. 모델 선택 + 다운로드 ---
hdr "5/6 Whisper 모델 선택"
declare -a MODEL_CHOICES=(
  "tiny|39MB|매우 빠름·정확도 낮음 (테스트용)"
  "base|142MB|빠름·정확도 중하"
  "small|466MB|중간 속도·정확도 중"
  "medium|1.5GB|느림·정확도 상"
  "large-v3|2.9GB|매우 느림·최고 정확도"
  "large-v3-turbo|1.5GB|large 동급 정확도·medium 속도 (권장)"
)
MODEL="${WHISPER_MODEL:-}"
if [[ -z "${MODEL}" ]]; then
  printf "%s%-18s %-7s %s%s\n" "${C_BOLD}" "이름" "크기" "특성" "${C_RESET}"
  i=1
  for entry in "${MODEL_CHOICES[@]}"; do
    IFS='|' read -r name size desc <<< "${entry}"
    printf "  %d) %-18s %-7s %s\n" "${i}" "${name}" "${size}" "${desc}"
    i=$((i+1))
  done
  printf "선택 [1-%d, 기본 6=large-v3-turbo]: " "${#MODEL_CHOICES[@]}"
  read -r CHOICE
  CHOICE="${CHOICE:-6}"
  if ! [[ "${CHOICE}" =~ ^[0-9]+$ ]] || (( CHOICE < 1 || CHOICE > ${#MODEL_CHOICES[@]} )); then
    fail "잘못된 선택: ${CHOICE}"
  fi
  IFS='|' read -r MODEL _ _ <<< "${MODEL_CHOICES[$((CHOICE-1))]}"
fi
log "선택된 모델: ${MODEL}"

MODEL_FILE="${MODELS_DIR}/ggml-${MODEL}.bin"
if [[ -f "${MODEL_FILE}" ]]; then
  ok "모델 파일 이미 존재: ${MODEL_FILE}"
else
  log "모델 다운로드 중 (${MODEL})..."
  (cd "${WHISPER_DIR}" && bash models/download-ggml-model.sh "${MODEL}")
fi

# --- 6. npm install + .env ---
hdr "6/6 Node 의존성 + .env"
(cd "${REPO_ROOT}" && npm install)

ENV_FILE="${REPO_ROOT}/.env"
ENV_EXAMPLE="${REPO_ROOT}/.env.example"
if [[ ! -f "${ENV_FILE}" ]]; then
  if [[ -f "${ENV_EXAMPLE}" ]]; then
    cp "${ENV_EXAMPLE}" "${ENV_FILE}"
    ok ".env 생성 (.env.example 복사). 필요한 토큰을 채워 넣으세요."
  else
    warn ".env.example 가 없어 .env 를 생성하지 못했습니다."
  fi
fi

# WHISPER_MODEL 을 .env 에 기록 (transcribe.js 가 읽음).
if [[ -f "${ENV_FILE}" ]]; then
  if grep -qE '^[[:space:]]*WHISPER_MODEL=' "${ENV_FILE}"; then
    # 기존 값 교체 (대소문자 구분, 주석은 보존)
    tmpfile="$(mktemp)"
    awk -v m="${MODEL}" '
      /^[[:space:]]*WHISPER_MODEL=/ { print "WHISPER_MODEL=" m; next }
      { print }
    ' "${ENV_FILE}" > "${tmpfile}"
    mv "${tmpfile}" "${ENV_FILE}"
  else
    printf "\n# whisper.cpp 모델 이름 (setup.sh 가 자동 기록)\nWHISPER_MODEL=%s\n" "${MODEL}" >> "${ENV_FILE}"
  fi
  ok "WHISPER_MODEL=${MODEL} 를 .env 에 기록."
fi

hdr "✅ Setup 완료"
cat <<EOM
다음 단계:
  1) .env 의 GEMINI_API_KEY 와 필요한 업로드 토큰을 채워 넣으세요.
     (디스코드/노션/위키 토큰은 비워두면 자동 스킵됩니다.)
  2) recordings/ 폴더에 화자별 .flac / .wav / .mp3 트랙을 넣으세요.
  3) npm run start
EOM
