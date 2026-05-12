# 🎙️ Meeting AI Pipeline

> All-in-one automation pipeline that transcribes online meeting recordings, generates AI summaries, and distributes them to team channels (Discord, Notion, GitHub Wiki). Recently migrated from Python to Node.js.

🇰🇷 한국어 README: [README.md](README.md)

---

## ✨ Features
1. **Audio conversion & transcription (`transcribe.js`)**:
   - Auto-converts multi-track recordings (`.flac`, `.wav`, `.mp3`) — e.g. from Discord — into 16kHz mono WAV using FFmpeg.
   - Uses the `whisper.cpp` C++ core engine with GPU acceleration for fast, per-speaker transcription.
2. **AI summarization (`summarize.js`)**:
   - Generates a Markdown summary (`meeting_summary.md`) from the transcribed text (`meeting_with_speakers.txt`) via Google Gemini API (Gemini 3 Flash).
   - Summary prompts live in `prompts/`; swap them via the `PROMPT_PATH` env var (see "Prompt Customization" below).
3. **Upload automation (`discord.js`, `notion.js`, `github_wiki.js`)**:
   - Distributes the summary to your team channels.
   - 🚨 Enable `TEST_MODE` to prevent mock data from hitting production channels.

---

## 💻 Prerequisites

The following tools and models must be installed locally:

1. **Node.js** (v18+ recommended)
2. **FFmpeg** (CLI required — normalizes input audio to 16kHz mono WAV)
   - macOS: `brew install ffmpeg`
3. **Whisper.cpp (built in-tree)**
   - The core binary `whisper.cpp/build/bin/whisper-cli` must be built.
   - A `whisper.cpp/models/ggml-<MODEL>.bin` weight file must exist. `<MODEL>` must match `WHISPER_MODEL` in `.env` (default `large-v3-turbo`).
   - `./setup.sh` handles both automatically.

---

## 🛠️ Installation & Setup

### ⚡ Quick Start (recommended)

```bash
./setup.sh
```

`setup.sh` automatically handles:

- **Platform auto-detection** — macOS (Apple Silicon Metal · Intel CPU), Linux (NVIDIA CUDA · CPU)
- **Prerequisite check** — warns if `git`/`ffmpeg`/`node`/`npm`/`cmake`/`make` are missing
- **whisper.cpp build** — release build with platform-appropriate cmake flags
- **Interactive model selection** — `tiny` / `base` / `small` / `medium` / `large-v3` / `large-v3-turbo` (default)
- **Model download** — via `whisper.cpp/models/download-ggml-model.sh`
- **npm install + .env init** — copies `.env.example` → `.env` and records `WHISPER_MODEL`

For non-interactive model selection: `WHISPER_MODEL=tiny ./setup.sh`.

After setup, fill in `GEMINI_API_KEY` (and any optional upload tokens) in `.env`.

### Manual Setup

If you'd rather not use `setup.sh`:

1. Install packages:
```bash
npm install
```

2. Build whisper.cpp (Apple Silicon example):
```bash
cd whisper.cpp && cmake -B build -DGGML_METAL=ON && cmake --build build --config Release -j
bash models/download-ggml-model.sh large-v3-turbo
```

3. Copy `.env.example` to `.env` and fill in tokens (leave Discord/Notion/Wiki tokens empty to auto-skip those uploads):
```bash
cp .env.example .env
```

---

## 🚀 Usage

Create a `recordings/` folder in the project root and drop per-speaker files named like `1234-UserName.flac`, then run the scripts.

Supported input extensions: `.flac` / `.wav` / `.mp3` (case-insensitive). FFmpeg normalizes them to 16kHz mono WAV inside the pipeline — original files are preserved.

> ℹ️ Mixdown files in the same folder (`meeting.flac` / `meeting.wav` / `meeting.mp3`) are auto-skipped to prevent single-speaker re-transcription. Move mixdowns elsewhere if you want only per-speaker tracks.

**Run the full pipeline (recommended)**:
```bash
npm run start
```
This runs "transcribe → summarize → discord → notion → wiki → cleanup" sequentially.

**Run individual steps**:
- `npm run doctor` — health check for dependencies/config (Node·FFmpeg·whisper-cli·model·.env). Exits 1 on missing required items.
- `npm run transcribe` — per-speaker transcription + merge
- `npm run summarize` — Gemini summarization + archival
- `npm run discord` — post results to Discord
- `npm run notion` — parse timetable Markdown and upload Notion blocks
- `npm run wiki` — dynamically update GitHub Wiki `.Sidebar.md` and push MD

> ℹ️ **Optional upload channels**: each upload step is auto-skipped (with a log line, no error) if its env group is blank — `DISCORD_WEBHOOK_URL`, `NOTION_TOKEN`/`NOTION_DATABASE_ID`, or `GITHUB_PAT`/`GITHUB_USERNAME`/`GITHUB_REPO_NAME`. Leave all upload tokens empty if you only want Gemini summaries.

> ℹ️ **Transcription language**: defaults to Korean (`-l ko`). For English/Japanese/multilingual meetings, set `WHISPER_LANG=auto` (whisper.cpp auto-detection) or an ISO-639-1 code like `WHISPER_LANG=en` in `.env`.

---

## 🧩 Prompt Customization

Summary prompts are stored as Markdown files under `prompts/`.

- `prompts/default.md` — Korean default template (domain-neutral). Replace team-roster placeholders (`<id1>`, etc.) with your team members and you're good.
- `prompts/mentoring.md` — example template for meetings that include senior engineers/mentors. Includes STT error examples, technical term corrections, performance metrics (TTFB/LCP), and mentor-commentary guidance in Korean. A good starting point — adapt to your team/domain context.

To use a team-specific prompt, create a new `.md` under `prompts/` and point `.env`'s `PROMPT_PATH` to it (path is relative to the repo root):

```env
# .env
PROMPT_PATH=prompts/mentoring.md
```

If unset, `prompts/default.md` is used.

---

## ⚡ Performance

Processing time for a 5-hour, 4-speaker multi-track meeting (FLAC input):

| Environment | Model | Time | Peak RAM |
|---|---|---|---|
| Apple Silicon (M3 Pro, Metal) | `large-v3-turbo` | **~10 min** | 8 GB |
| Apple Silicon (M3 Pro, Metal) | `medium` | ~6 min | 5 GB |
| Linux + NVIDIA CUDA (RTX 4070) | `large-v3-turbo` | ~7 min | 6 GB |
| Linux CPU (8-core) | `large-v3-turbo` | ~45 min | 6 GB |

Auto-tuning (manually overridable):

- **Concurrent workers** = `Math.floor((RAM_GB - 4) / 3)` — ~2.5 GB per instance + 4 GB OS headroom. Override with `WHISPER_CONCURRENCY`.
- **Whisper threads** = on Apple Silicon, the P-core count (sysctl auto-detect); elsewhere `min(logical_cores - 2, 12)`. Override with `WHISPER_THREADS`.

> ℹ️ Apple Silicon's Metal GPU is serialized, so raising concurrency above 2 doesn't help much. On CUDA/CPU, 4–6 workers scale well as long as RAM allows.

Model trade-offs:

| Model | File size | Korean quality | Recommended use |
|---|---|---|---|
| `tiny` | 39 MB | Low (frequent hallucinations) | Quick validation (`recordings/README.md` 1-min test) |
| `small` | 466 MB | Medium | English-heavy meetings, fast processing |
| `medium` | 1.5 GB | High | Mobile / low-RAM |
| `large-v3-turbo` (default) | 1.6 GB | Very high, fast | **Recommended** — primary for Korean meetings |
| `large-v3` | 3.1 GB | Highest, slower | When peak quality matters |

---

## 🛠️ Troubleshooting / FAQ

### Q. `setup.sh` fails saying it can't find `cmake` or `make`
**A.** On macOS you need Xcode Command Line Tools — run `xcode-select --install` (a GUI installer pops up), then re-run `./setup.sh`. On Linux, `setup.sh` will try `apt-get install build-essential` automatically (requires sudo). Use `SKIP_AUTO_INSTALL=1 ./setup.sh` to disable auto-install and install manually.

### Q. Model download was interrupted
**A.** `setup.sh` retries up to 3 times (exponential backoff 2s/4s). Partial files under 1 MB are automatically deleted and re-downloaded. After 3 failures, manual download guidance is printed (download from huggingface directly and save as `whisper.cpp/models/ggml-<MODEL>.bin`).

### Q. `npm run start` complains: `❌ recordings 폴더에 분석할 오디오 파일이 없습니다`
**A.** Make sure `recordings/` has `.flac` / `.wav` / `.mp3` files. Files named `meeting.flac` / `meeting.wav` / `meeting.mp3` are **deliberately skipped** (multi-track mixdown guard). Rename to e.g. `single.wav` — see `recordings/README.md` for details.

### Q. I'm on Apple Silicon but Metal acceleration doesn't seem to work
**A.** Delete `whisper.cpp/build/` and re-run `./setup.sh`. cmake will rebuild with `-DGGML_METAL=ON`. Confirm by checking the build log for `BLAS = 1 | METAL = 1`.

### Q. `GEMINI_API_KEY 환경변수가 설정되지 않았습니다` error
**A.** Run `npm run doctor` — it tells you exactly which env vars are missing. Get a free API key at [Google AI Studio](https://ai.google.dev) and add `GEMINI_API_KEY=AIzaSy...` to `.env`.

### Q. I want to transcribe non-Korean meetings
**A.** Add `WHISPER_LANG=auto` (auto-detection) or `WHISPER_LANG=en` (force English) to `.env`. Any ISO-639-1 code works (en/ja/zh/es/etc).

### Q. I want summaries only, without Discord/Notion/Wiki uploads
**A.** Leave the `DISCORD_WEBHOOK_URL`, `NOTION_TOKEN`, and `GITHUB_PAT` groups blank in `.env` — those steps auto-skip with a log line. The Gemini summary is saved to `archived/<timestamp>/meeting_summary.md`.

### Q. Transcripts look wrong (hallucinations, repeated text)
**A.** This usually happens when input audio has long silent stretches or low SNR. Remove silence with FFmpeg and retry: `ffmpeg -i raw.wav -af "silenceremove=stop_periods=-1:stop_duration=1:stop_threshold=-30dB" recordings/single.wav`. Or use a larger model (`large-v3`).

---

## 🎬 Example Output

After `npm run start`, a summary is saved to `archived/<YYYY-MM-DD>/meeting_summary_<HHMMSS>.md`. Structure depends on `prompts/default.md` or your custom prompt.

Default-template example (anonymized):

```markdown
# 📝 [Meeting Title]

**Participants:** Alice, Bob, Carol, Dave
**Type:** Feature policy alignment meeting

## ⏰ Timeline
- **[00:00 ~ 12:00]** Dashboard UI improvements (ranking / progress display)
- **[12:00 ~ 25:00]** Mobile input UX (tag-input pattern change)
- **[25:00 ~ end]** Release schedule finalization + QA plan

## ✍🏻 Agenda
1. Dashboard visualization — progress-based backgrounds + member ranking layout
2. Input UI — Enter-to-submit → "Add" button + modal
3. Release policy — ship 5/18, usability-testing plan

## 🎯 Decisions
- [Alice] Dashboard v2 design finalized by 5/14
- [Bob] Tag-input component PR by 5/15
- [Carol] QA scenarios drafted by 5/16

## ⚠️ Open Issues
- Video SDK's CSS customization limits — needs investigation
```

Speaker names are auto-extracted from `recordings/<id>-<UserName>.flac` (the `<UserName>` part). Single-track inputs are labeled `mixed`.

---

## 📜 License

MIT — see [LICENSE](LICENSE).
