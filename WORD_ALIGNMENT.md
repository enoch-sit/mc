# Word Alignment Pipeline

This workspace now supports two levels of word highlighting in `mc_practice_ui.html`:

1. Estimated timing in the browser when no timestamp data exists.
2. Real word timing from WhisperX forced alignment when timestamp data has been generated.

## When to use React

Do not move to React yet just for playback, highlighting, and a small amount of state.
The current static page is still the right shape for this workflow because:

- the app is single-page and file-based
- there is no routing, server state, or component reuse pressure yet
- local `file:///` use is simpler without a build step

Move to React only if you want several of these at once:

- multiple pages sharing a common state model
- editable transcripts with live state sync
- waveform views, search, filters, and bookmarks
- provider dashboards, generation queues, and job history
- packaging as a real deployable app instead of a local practice page

## Install

Create a Python virtual environment and install WhisperX:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements-word-alignment.txt
```

If WhisperX install fails on CPU-only Windows, install PyTorch first from the official CPU wheel instructions, then rerun the requirements install.

## Generate timestamps

For Grok audio:

```powershell
python generate_word_timestamps.py --provider grok --device cpu --language en
```

For OpenRouter audio:

```powershell
python generate_word_timestamps.py --provider openrouter --device cpu --language en
```

For local Kokoro WAV files:

```powershell
python generate_word_timestamps.py --provider local --device cpu --language en
```

For a smaller range while testing:

```powershell
python generate_word_timestamps.py --provider grok --device cpu --language en --start-id 001 --end-id 003
```

## Output

The script writes:

- `word_timestamps/<provider>/<id>.json` per line
- `word_timestamps/word_timestamps_data.json` combined bundle
- `word_timestamps/word_timestamps_data.js` browser-ready bundle loaded by the page

Once the JS bundle exists, `mc_practice_ui.html` automatically prefers real timestamps over estimated timings.
