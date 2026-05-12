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
# 모델 파일이 이미 존재하면서 비어있지 않으면 스킵.
# (이전 실행이 다운로드 중간에 끊겼을 경우 0~수 바이트짜리 파일이 남아있을 수 있어 사이즈도 확인.)
if [[ -f "${MODEL_FILE}" && "$(wc -c < "${MODEL_FILE}" 2>/dev/null || echo 0)" -gt 1048576 ]]; then
  MODEL_SIZE_HR="$(du -h "${MODEL_FILE}" 2>/dev/null | cut -f1 || echo unknown)"
  ok "모델 파일 이미 존재 (${MODEL_SIZE_HR}): ${MODEL_FILE}"
else
  if [[ -f "${MODEL_FILE}" ]]; then
    warn "기존 모델 파일이 1MB 미만 — 부분 다운로드로 판단하여 제거 후 재다운로드."
    rm -f "${MODEL_FILE}"
  fi

  # --- 다운로드 + 재시도 ---
  # 네트워크 일시 장애에 대비해 최대 3회 시도.
  # 매 실패마다 부분 다운로드 파일을 제거하여 download-ggml-model.sh 의
  # "이미 존재하므로 스킵" 로직이 손상된 파일을 유지하지 않도록 함.
  MAX_DL_ATTEMPTS=3
  dl_attempt=1
  DL_OK=0
  while (( dl_attempt <= MAX_DL_ATTEMPTS )); do
    log "모델 다운로드 시도 ${dl_attempt}/${MAX_DL_ATTEMPTS} (${MODEL})..."
    if (cd "${WHISPER_DIR}" && bash models/download-ggml-model.sh "${MODEL}"); then
      # 사이즈 sanity check: 가장 작은 tiny 모델도 39MB 라 1MB 미만이면 분명히 부분/오류 응답.
      if [[ -f "${MODEL_FILE}" && "$(wc -c < "${MODEL_FILE}" 2>/dev/null || echo 0)" -gt 1048576 ]]; then
        DL_OK=1
        break
      fi
      warn "다운로드 스크립트는 성공했지만 결과 파일이 비어있거나 1MB 미만입니다."
    else
      warn "다운로드 실패 (시도 ${dl_attempt}/${MAX_DL_ATTEMPTS})."
    fi

    # 다음 시도 전에 부분 다운로드 정리.
    if [[ -f "${MODEL_FILE}" ]]; then
      log "부분 다운로드 파일 제거: ${MODEL_FILE}"
      rm -f "${MODEL_FILE}"
    fi

    if (( dl_attempt < MAX_DL_ATTEMPTS )); then
      # 지수 백오프 (2s → 4s).
      backoff=$(( 2 * dl_attempt ))
      log "${backoff}초 대기 후 재시도..."
      sleep "${backoff}"
    fi
    dl_attempt=$(( dl_attempt + 1 ))
  done

  if (( DL_OK != 1 )); then
    fail "모델 다운로드 최종 실패 (${MAX_DL_ATTEMPTS}회 시도).
  - 네트워크/방화벽/Hugging Face 접근을 확인하세요.
  - 또는 수동으로 다운로드해서 ${MODELS_DIR}/ 에 두고 setup.sh 를 다시 실행하세요:
      cd ${WHISPER_DIR} && bash models/download-ggml-model.sh ${MODEL}
    또는 https://huggingface.co/ggerganov/whisper.cpp/tree/main 에서
    ggml-${MODEL}.bin 를 직접 받아 ${MODELS_DIR}/ggml-${MODEL}.bin 으로 저장."
  fi

  MODEL_SIZE_HR="$(du -h "${MODEL_FILE}" 2>/dev/null | cut -f1 || echo unknown)"
  ok "모델 다운로드 완료 (${MODEL_SIZE_HR}): ${MODEL_FILE}"
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
  1) npm run doctor
     ↳ 의존성 / 모델 / .env 상태를 점검합니다. 문제 없으면 ✅ 만 출력됩니다.
  2) .env 의 GEMINI_API_KEY 와 필요한 업로드 토큰을 채워 넣으세요.
     (디스코드/노션/위키 토큰은 비워두면 자동 스킵됩니다.)
  3) recordings/ 폴더에 화자별 .flac / .wav / .mp3 트랙을 넣으세요.
  4) npm run start
EOM
