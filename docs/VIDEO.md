# Full demo recording

[Download/watch the MP4](https://github.com/naveenkumarrk/org-memory-falkordb/releases/download/v0.2.0-demo/org-memory-full-demo.mp4) · [Release with subtitles and transcript](https://github.com/naveenkumarrk/org-memory-falkordb/releases/tag/v0.2.0-demo)

The full recording covers the live browser inspector and authenticated Alice/Bob CLI handoff. It includes locally generated English narration, visible step captions, a separate subtitle file, and a transcript. The displayed CLI output is captured from actual subprocesses during recording; no credentials are shown.

The scene labels explain that the data and local client profiles are synthetic, the database calls and tests are real, and the action policy is deterministic. The recording does not claim a live Claude task, two physical machines, or a signup/SSO product.

## Optional reproduction

The app/database and Alice/Bob profiles must already work; follow the README and WORKING.md. No recording tools are needed to use the application.

1. Install Playwright as an optional local tool and its Chromium/FFmpeg components (`npx playwright install chromium`). Linux may require browser system libraries. The recording helper supports `ORG_MEMORY_PLAYWRIGHT_MODULE` for an existing Playwright installation.
2. On Windows/WSL with the installed Microsoft Zira Desktop voice, run `node scripts/narrate-demo.cjs`. It synthesizes speech locally through Windows System.Speech, uses temporary files only for its own clips, and writes `.demo/narration/scenes.json`. No external speech API or credentials are used.
3. Run `node scripts/record-full-demo.mjs`. This performs real UI interactions and CLI commands, restores the public starting fixture afterwards, and saves `.demo/org-memory-full-demo.webm` plus a scene-timing manifest. Without narration clips it can still produce a captioned WebM recording.
4. With a full FFmpeg build supporting H.264/AAC available, set `ORG_MEMORY_FFMPEG` to its executable and run `python3 scripts/render-demo.py`. The helper renders `.demo/org-memory-full-demo.mp4`, `.demo/org-memory-full-demo.srt`, and `.demo/org-memory-demo-transcript.md`.

The measured recording uses a 1600×900 viewport. Before rendering, the helper aligns narration to visible caption transitions in the actual recording and rejects missing/overlapping scene alignment. This avoids drift between automation timestamps and recorded frames. Media binaries, speech waveforms, credentials, and raw recording files stay in ignored `.demo` storage; the resulting public demo is distributed as a GitHub release asset.
