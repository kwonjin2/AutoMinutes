#!/usr/bin/env bash
# meeting-ai setup — 플랫폼 자동 감지 + 의존성 자동 설치 + whisper.cpp 빌드 + 모델 선택
#
# 사용법:
#   ./setup.sh                       # 인터랙티브 모델 선택 + 누락 의존성 자동 설치
#   WHISPER_MODEL=tiny ./setup.sh    # 비대화형, 환경변수로 모델 지정
#   SKIP_AUTO_INSTALL=1 ./setup.sh   # 의존성 자동 설치 비활성화 (수동 설치 시)
#
# 지원: macOS (Apple Silicon · Intel, Homebrew), Linux (Debian/Ubuntu, apt-get)
# 비지원: Windows (WSL 사용 권장), Linux 비-apt 배포판 (수동 설치 가이드 제공)

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

# --- 2. 사전 의존성 확인 + 자동 설치 ---
hdr "2/6 사전 의존성 확인"

# 명령어 → 패키지 이름 매핑.
# Mac(brew) 와 Linux(apt) 의 패키지명이 다르므로 분리 관리.
mac_pkg_for() {
  case "$1" in
    git)         echo "git" ;;
    ffmpeg)      echo "ffmpeg" ;;
    node|npm)    echo "node" ;;        # brew node 는 npm 동봉
    cmake)       echo "cmake" ;;
    make)        echo "" ;;            # Xcode CLT (별도 처리)
    *)           echo "" ;;
  esac
}

apt_pkg_for() {
  case "$1" in
    git)         echo "git" ;;
    ffmpeg)      echo "ffmpeg" ;;
    node)        echo "nodejs" ;;
    npm)         echo "npm" ;;
    cmake)       echo "cmake" ;;
    make)        echo "build-essential" ;;
    *)           echo "" ;;
  esac
}

# 중복 제거하면서 패키지 목록 출력 (한 줄당 한 패키지).
unique_pkgs() {
  local -a out=()
  local pkg existing seen
  for pkg in "$@"; do
    [[ -z "${pkg}" ]] && continue
    seen=0
    for existing in "${out[@]:-}"; do
      if [[ "${existing}" == "${pkg}" ]]; then seen=1; break; fi
    done
    [[ "${seen}" == "0" ]] && out+=("${pkg}")
  done
  if [[ ${#out[@]} -gt 0 ]]; then
    printf "%s\n" "${out[@]}"
  fi
}

REQUIRED_CMDS=(git ffmpeg node npm cmake make)
MISSING=()
for cmd in "${REQUIRED_CMDS[@]}"; do
  if command -v "${cmd}" >/dev/null 2>&1; then
    ok "${cmd} 발견: $(command -v "${cmd}")"
  else
    MISSING+=("${cmd}")
  fi
done

if [[ ${#MISSING[@]} -gt 0 ]]; then
  warn "누락된 도구: ${MISSING[*]}"

  if [[ "${SKIP_AUTO_INSTALL:-0}" == "1" ]]; then
    if [[ "${PLATFORM}" == "mac" ]]; then
      warn "수동 설치 예: brew install ffmpeg cmake node"
      [[ " ${MISSING[*]} " == *" make "* ]] && warn "  + Xcode CLT: xcode-select --install"
    else
      warn "수동 설치 예: sudo apt install -y ffmpeg cmake build-essential nodejs npm"
    fi
    fail "SKIP_AUTO_INSTALL=1 지정됨 — 자동 설치 건너뜀. 위 명령으로 설치 후 재실행하세요."
  fi

  # --- 자동 설치 시도 ---
  hdr "2.1 누락 의존성 자동 설치"

  if [[ "${PLATFORM}" == "mac" ]]; then
    # Homebrew 필수.
    if ! command -v brew >/dev/null 2>&1; then
      warn "Homebrew(brew) 명령을 찾지 못했습니다."
      warn "  설치: /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
      warn "  또는 https://brew.sh 참조"
      fail "Homebrew 설치 후 ./setup.sh 를 다시 실행하세요. (또는 SKIP_AUTO_INSTALL=1 로 수동 설치)"
    fi

    # Xcode CLT (make 가 누락된 경우 별도 안내 — brew 로 설치 불가).
    if [[ " ${MISSING[*]} " == *" make "* ]]; then
      warn "make 누락 → Xcode Command Line Tools 가 설치되어 있지 않습니다."
      warn "  설치: xcode-select --install (GUI 설치창이 뜹니다)"
      warn "  설치 완료 후 ./setup.sh 를 다시 실행하세요."
      fail "Xcode CLT 는 brew 로 설치할 수 없습니다. 위 명령으로 먼저 설치하세요."
    fi

    # brew 패키지로 매핑 + 중복 제거.
    BREW_PKGS_RAW=()
    for cmd in "${MISSING[@]}"; do
      pkg="$(mac_pkg_for "${cmd}")"
      [[ -n "${pkg}" ]] && BREW_PKGS_RAW+=("${pkg}")
    done
    BREW_PKGS=()
    if [[ ${#BREW_PKGS_RAW[@]} -gt 0 ]]; then
      mapfile -t BREW_PKGS < <(unique_pkgs "${BREW_PKGS_RAW[@]}")
    fi

    if [[ ${#BREW_PKGS[@]} -gt 0 ]]; then
      log "brew install ${BREW_PKGS[*]}"
      if ! brew install "${BREW_PKGS[@]}"; then
        warn "brew install 실패. 위 출력 로그를 확인하세요."
        warn "수동 설치: brew install ${BREW_PKGS[*]}"
        fail "Homebrew 패키지 설치 실패 — 네트워크/권한 문제일 수 있습니다."
      fi
      ok "brew 패키지 설치 완료."
    fi

  else
    # Linux: apt 전용 (다른 배포판은 별도 가이드).
    if ! command -v apt-get >/dev/null 2>&1; then
      warn "apt-get 명령을 찾지 못했습니다 — Debian/Ubuntu 외 배포판으로 보입니다."
      if command -v dnf  >/dev/null 2>&1; then
        warn "  Fedora/RHEL 예: sudo dnf install -y ffmpeg cmake gcc-c++ make nodejs npm git"
      elif command -v pacman >/dev/null 2>&1; then
        warn "  Arch 예: sudo pacman -S --needed ffmpeg cmake base-devel nodejs npm git"
      elif command -v zypper >/dev/null 2>&1; then
        warn "  openSUSE 예: sudo zypper install ffmpeg cmake gcc-c++ make nodejs npm git"
      else
        warn "  배포판 패키지 매니저로 다음을 설치: ffmpeg cmake build-essential(혹은 동급) nodejs npm git"
      fi
      fail "apt-get 미감지 — 자동 설치 불가. 위 가이드대로 수동 설치 후 재실행하세요."
    fi

    # apt 패키지로 매핑 + 중복 제거.
    APT_PKGS_RAW=()
    for cmd in "${MISSING[@]}"; do
      pkg="$(apt_pkg_for "${cmd}")"
      [[ -n "${pkg}" ]] && APT_PKGS_RAW+=("${pkg}")
    done
    APT_PKGS=()
    if [[ ${#APT_PKGS_RAW[@]} -gt 0 ]]; then
      mapfile -t APT_PKGS < <(unique_pkgs "${APT_PKGS_RAW[@]}")
    fi

    # sudo 필요 여부 결정 (root 면 생략).
    SUDO=""
    if [[ "${EUID}" -ne 0 ]]; then
      if ! command -v sudo >/dev/null 2>&1; then
        warn "sudo 가 없으며 root 가 아닙니다."
        warn "  root 로 다시 실행하거나, 다음을 root 권한으로 설치하세요:"
        warn "    apt-get update && apt-get install -y ${APT_PKGS[*]:-}"
        fail "sudo 미설치 + 비-root — 자동 설치 불가."
      fi
      SUDO="sudo"
    fi

    if [[ ${#APT_PKGS[@]} -gt 0 ]]; then
      log "${SUDO:+${SUDO} }apt-get update"
      if ! ${SUDO} apt-get update; then
        warn "apt-get update 실패. 네트워크/권한 또는 sources.list 문제일 수 있습니다."
        fail "apt 메타데이터 갱신 실패 — 위 로그를 확인하세요."
      fi
      log "${SUDO:+${SUDO} }apt-get install -y ${APT_PKGS[*]}"
      if ! ${SUDO} apt-get install -y "${APT_PKGS[@]}"; then
        warn "apt-get install 실패. 위 출력 로그를 확인하세요."
        warn "수동 설치: ${SUDO:+${SUDO} }apt-get install -y ${APT_PKGS[*]}"
        fail "apt 패키지 설치 실패 — 패키지명/네트워크/권한을 확인하세요."
      fi
      ok "apt 패키지 설치 완료."
    fi
  fi

  # --- 재검증 ---
  log "설치 후 재검증..."
  hash -r 2>/dev/null || true
  STILL_MISSING=()
  for cmd in "${MISSING[@]}"; do
    if command -v "${cmd}" >/dev/null 2>&1; then
      ok "${cmd} 설치 확인: $(command -v "${cmd}")"
    else
      STILL_MISSING+=("${cmd}")
    fi
  done
  if [[ ${#STILL_MISSING[@]} -gt 0 ]]; then
    warn "자동 설치 후에도 여전히 누락: ${STILL_MISSING[*]}"
    warn "PATH 갱신이 필요할 수 있습니다 (새 셸을 열거나 'hash -r' 후 재시도)."
    if [[ "${PLATFORM}" == "mac" ]]; then
      warn "Apple Silicon brew 경로 누락 시: eval \"\$(/opt/homebrew/bin/brew shellenv)\""
    fi
    fail "필수 도구 설치를 완료하지 못했습니다. 위 안내를 확인하세요."
  fi
  ok "모든 필수 도구 설치 확인."
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
