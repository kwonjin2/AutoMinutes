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

## 📜 License

MIT — see [LICENSE](LICENSE).
