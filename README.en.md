# 🎙️ Meeting AI Pipeline

> All-in-one automation pipeline that transcribes online meeting recordings, generates AI summaries, and distributes them to team channels (Discord, Notion, GitHub Wiki). Recently migrated from Python to Node.js.

🇰🇷 한국어 README: [README.md](README.md)

---

## ✨ Features
1. **Meeting recording (`record.js`)** — optional:
   - Records a Discord voice channel directly with **your own Discord bot** — no external recording bot (Craig, etc.) — saving per-speaker tracks straight into `recordings/`.
   - A single `/record stop` auto-runs the transcribe→summarize→upload pipeline below. (See "🎙️ Meeting recording".)
2. **Audio conversion & transcription (`transcribe.js`)**:
   - Auto-converts multi-track recordings (`.flac`, `.wav`, `.mp3`) — e.g. from Discord — into 16kHz mono WAV using FFmpeg.
   - Uses the `whisper.cpp` C++ core engine with GPU acceleration for fast, per-speaker transcription.
3. **AI summarization (`summarize.js`)**:
   - Generates a Markdown summary (`meeting_summary.md`) from the transcribed text (`meeting_with_speakers.txt`) via Google Gemini API (Gemini 3 Flash).
   - Summary prompts live in `prompts/`; swap them via the `PROMPT_PATH` env var (see "Prompt Customization" below).
4. **Upload automation (`discord.js`, `notion.js`, `github_wiki.js`)**:
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

## 🎙️ Meeting recording (Discord bot) — optional

Record a Discord voice channel directly with **your own Discord bot** — no external recording bot (Craig, etc.) — saving per-speaker tracks straight into `recordings/`, and auto-run the transcribe→summarize→upload pipeline on `/record stop`.

> ⚠️ **Each user must create their own bot.** A bot token is a secret and cannot be shared, and the bot instance has to run on your own machine to join voice channels (same self-hosting principle as the rest of this project). If you skip this feature, just drop recording files manually via the "Manual" option in [Usage](#-usage) below.

### 1) Create a Discord bot (one-time, ~10 min)

1. [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**.
2. Left sidebar **Bot** → **Reset Token** and copy it (it won't be shown again — Reset if lost).
3. On the same **Bot** page:
   - Turn **Privileged Gateway Intents → SERVER MEMBERS INTENT** **ON** (for speaker-name mapping), then **Save Changes**.
   - Keep **Requires OAuth2 Code Grant** **OFF** (if ON, invites fail with `Integration requires code grant`).
4. Open the invite URL below in a browser, replacing `<CLIENT_ID>` with your app's **Application ID** (top of the OAuth2 page), then pick a server and **Authorize**:
   ```
   https://discord.com/oauth2/authorize?client_id=<CLIENT_ID>&permissions=3146752&scope=bot+applications.commands
   ```
   - `permissions=3146752` = **View Channels + Connect + Speak** (minimum permissions for recording). Redirect URIs are not needed for a bot invite — ignore them.

### 2) Configure the token

Add the token to `.env` (this is **completely separate** from the upload `DISCORD_WEBHOOK_URL`):
```env
DISCORD_BOT_TOKEN=your_discord_bot_token_here
```

### 3) Record

```bash
npm run record
```
When `🟢 준비 완료` (ready) appears the bot is live (keep this terminal open during the meeting). Then in Discord:

1. **Join a voice channel**
2. `/record start` — the bot joins; a per-speaker track is created as soon as someone talks.
3. `/record stop` — the bot leaves, tracks are saved as `recordings/1-name.flac`, and **`npm run start`** (transcribe→summarize→upload) runs automatically.

> ℹ️ Starting a new recording does not delete existing audio — it is backed up to `recordings/_archive_<timestamp>/` so only this meeting's tracks are transcribed. Participants who never speak get no track.

---

## 🚀 Usage

Put your meeting audio in the `recordings/` folder, then run the scripts. There are two ways to get the audio in there:

- **Automatic**: record with the Discord bot above ([🎙️ Meeting recording](#-meeting-recording-discord-bot--optional)) — `recordings/` fills itself.
- **Manual**: drop per-speaker files named like `1234-UserName.flac` (e.g. from Craig or another recorder) directly into the folder.

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

Auto-tuning (manually overridable, [`transcribe.js:34-67`](transcribe.js)):

- **Concurrent workers** = `clamp(Math.floor((RAM_GB - 4) / 3), 1, 2)` — ~2.5 GB per instance + 4 GB OS headroom. The code **caps at 2 workers**; override with `WHISPER_CONCURRENCY` if you need more.
- **Whisper threads** =
  - Apple Silicon: `clamp(P-cores - 1, 2, 12)` (auto-detected via sysctl `hw.perflevel0.physicalcpu`)
  - Elsewhere: `clamp(logical_cores - 2, 2, 12)`
  - Override with `WHISPER_THREADS`

> ℹ️ Apple Silicon's Metal GPU is serialized, so adding more workers above 2 doesn't help — the cap is intentional. On CUDA/CPU, override with e.g. `WHISPER_CONCURRENCY=4` if you want more parallelism.

Model trade-offs (matches the `setup.sh` interactive picker):

| Model | File size | Korean quality | Recommended use |
|---|---|---|---|
| `tiny` | 39 MB | Very low (frequent hallucinations) | Quick validation (`recordings/README.md` 1-min test) |
| `base` | 142 MB | Low | When max throughput is needed |
| `small` | 466 MB | Medium | English-heavy meetings, fast processing |
| `medium` | 1.5 GB | High | Mobile / low-RAM environments |
| `large-v3-turbo` (default) | 1.5 GB | Very high, fast | **Recommended** — primary for Korean meetings |
| `large-v3` | 2.9 GB | Highest, slower | When peak quality matters |

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

### Q. (recording bot) Invite fails with `Integration requires code grant`
**A.** In the Developer Portal → **Bot** page, turn the **Requires OAuth2 Code Grant** toggle **OFF**, save, then reopen the invite URL.

### Q. (recording bot) The `/record` command doesn't show up in Discord
**A.** The bot must be running (`npm run record`) and the console must show a `커맨드 등록: <server>` (command registered) log. Guild slash commands usually appear instantly.

### Q. (recording bot) I ran `/record start` but no tracks (.flac) are created
**A.** Check that (1) **SERVER MEMBERS INTENT** is ON (Developer Portal → Bot), and (2) the command runner is **actually in a voice channel**. Participants who never speak get no track (by design).

---

## 🎬 Example Output

After `npm run start`, a summary is saved to `archived/<YYYY-MM-DD>/meeting_summary_<HHMMSS>.md`. Structure depends on `prompts/default.md` or your custom prompt.

Example output using `prompts/default.md` (anonymized):

```markdown
# 📝 Dashboard UI/UX and Release Policy Alignment

**Participants:** Alice, Bob, Carol, Dave
**Type:** FE+BE alignment meeting

---

## ⏰ Timeline

- **[00:00 ~ 12:00]** Dashboard UI improvements (ranking / progress display)
- **[12:00 ~ 25:00]** Mobile input UX (tag-input pattern change)
- **[25:00 ~ end]** Release schedule finalization + QA plan

---

## ✍🏻 Agenda

1. Dashboard visualization — progress-based background images + member-ranking layout
2. Input UI — Enter-to-submit → explicit "Add" button + modal (mobile UX)
3. Release policy — ship 5/18 + usability-testing plan

---

## 🏁 Decisions

### 1. Dashboard v2 design

- **Decision:** Alice finalizes the design by 5/14
- **Rationale/details:** Achievement-based background image switching (rainy/sunny); member ranking changes from horizontal scroll → vertical list (mobile-first)

### 2. Tag-input UX

- **Decision:** Bob ships a PR by 5/15
- **Rationale/details:** Enter-to-submit on mobile triggers accidentally; explicit "Add" button + modal pattern is clearer

---

## ✅ TODOs (technical follow-ups)

1. **[QA] Usability-testing scenarios:**
   - Carol drafts scenarios by 5/16, dry-run on 5/17
2. **[FE] Video SDK CSS customization limits:**
   - Investigate further before deciding SDK swap vs workaround

---

**Mentor commentary:** (this was a regular meeting — no mentor present)
```

Speaker names are auto-extracted from `recordings/<id>-<UserName>.flac` (the `<UserName>` part). Single-track inputs are labeled `mixed`.

---

## 📜 License

MIT — see [LICENSE](LICENSE).
