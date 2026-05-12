# `recordings/` — pipeline input folder

Drop audio files here. `transcribe.js` picks up everything in this directory
that ends in `.flac`, `.wav`, or `.mp3` (case-insensitive) and feeds it to
`whisper-cli`.

## Two input modes

| Mode | What goes in here | Speaker label |
|---|---|---|
| **Multi-track** (recommended) | One file per speaker, named `<id>-<UserName>.<ext>` (e.g. `1234-Alice.flac`) — typical Discord/Craig per-speaker export | The portion after the first `-` (so `1234-Alice.flac` → `Alice`) |
| **Single-track** | Exactly one file named anything except `meeting.*` | The literal label `mixed` (no diarization) |

> ⚠ Files named `meeting.flac` / `meeting.wav` / `meeting.mp3` are **deliberately
> skipped**. They're treated as multi-track mixdowns that would otherwise be
> re-transcribed as a single speaker. Rename to `single.wav` (or anything else)
> if you want it processed as a single-track input.

## Quick validation (≈ 1 minute)

The fastest way to confirm the full pipeline works end-to-end:

```bash
# 1) Record ~30s of yourself talking on your phone → e.g. voice.m4a
# 2) Convert and place under recordings/ (single-track mode):
ffmpeg -i voice.m4a recordings/single.wav

# 3) Use the smallest model so the first run is fast (~1–2 min total):
WHISPER_MODEL=tiny npm run start
```

Result: `archived/<timestamp>/meeting_summary.md` contains a Gemini-generated
summary. The transcript quality from `tiny` will be poor — that's expected.
Once the pipeline is verified, switch back to `large-v3-turbo` for real
meetings.

## Converting other formats

`whisper.cpp` ingests anything FFmpeg can decode, but `transcribe.js` only
scans `.flac` / `.wav` / `.mp3` to avoid surprises. Convert other formats first:

```bash
# .m4a → .wav (most phone recorders default to .m4a)
ffmpeg -i input.m4a recordings/single.wav

# .ogg / .opus / .webm → .wav
ffmpeg -i input.ogg recordings/single.wav

# Trim long silence (helps reduce whisper hallucinations on idle stretches)
ffmpeg -i raw.wav -af "silenceremove=stop_periods=-1:stop_duration=1:stop_threshold=-30dB" \
  recordings/single.wav
```

For multi-track Discord exports (Craig bot), the files arrive already as
`<id>-<UserName>.flac` — drop them in as-is.

## What ends up where

- `recordings/<your-files>` — input (untouched by the pipeline; FFmpeg writes a
  temp 16kHz mono WAV under the system tmpdir)
- `transcripts/<basename>.json` — per-file whisper output (cached; rerunning
  skips files that already have a JSON here — delete to force re-transcription)
- `transcripts/meeting_with_speakers.txt` — merged, deduplicated transcript
- `archived/<YYYY-MM-DD_HHMM>/meeting_summary.md` — final Gemini summary

Anything in this folder other than `README.md` is gitignored.
