# Kokoro Cheatsheet

This document is written to stand on its own.

Assume the reader has no access to any surrounding repo, scripts, or source files beyond this markdown.

Kokoro is used here for text-to-speech, not speech-to-text.

If you need transcription, word timestamps, or subtitle alignment, that is a separate toolchain. In the workflow documented here, that separate toolchain is WhisperX.

## Recommended Defaults

- TTS library: `kokoro-js`
- Model: `onnx-community/Kokoro-82M-v1.0-ONNX`
- Typical load options: `dtype: "q8"`, `device: "cpu"`
- Default production voice: `af_heart`
- Default production speed: `0.85`

These defaults are a strong starting point for educational narration and segmented vocab audio.

## What To Keep In Mind

- `device: "cpu"` is the safe default for Node scripts.
- `dtype: "q8"` is the practical default when you want smaller, faster model loading.
- `af_heart` at `0.85` is a good production baseline when clarity matters more than speed.
- Kokoro is TTS only. Do not confuse it with STT or caption extraction.

## If You Do Have A Project Around This

The original workflow behind this cheatsheet used scripts and folders such as:

- `scripts/audio/generateSingleWord.mjs`
- `scripts/audio/generateAudio.mjs`
- `scripts/pipeline/runV3Pipeline.mjs`
- `LongVideo/002/generateAudio.mjs`
- `LongVideo/003/generateAudio.mjs`
- `public/audio/<word>/`

Those paths are examples, not requirements. If your project has different file names, copy the ideas, not the exact structure.

## Minimal Kokoro Pattern

```js
import { KokoroTTS } from "kokoro-js";

const tts = await KokoroTTS.from_pretrained(
  "onnx-community/Kokoro-82M-v1.0-ONNX",
  {
    dtype: "q8",
    device: "cpu",
  }
);

const audio = await tts.generate(text, {
  voice: "af_heart",
  speed: 0.85,
});

audio.save(outputPath);
```

## Production Settings

Use these unless you have a concrete reason not to:

- Voice: `af_heart`
- Speed: `0.85`
- Device: `cpu`
- Quantization: `q8`

Historical or experimental variants also appear in the repo:

- `af_sky` in older guide examples
- `speed: 1.0` in some utility or test scripts

For production vocab videos, prefer the `af_heart` + `0.85` combination unless listening tests prove another voice is better.

## Core Workflow

### 1. Generate segmented WAVs

The most robust pattern is to generate one WAV per narration segment, for example:

- `intro.wav`
- `breakdown.wav`
- `part1.wav`
- `part2.wav`
- `part3.wav`
- `connection.wav`
- `example.wav`

Why segment the audio:

- easier regeneration when one section is wrong
- easier timing measurement
- easier subtitle alignment
- easier debugging of pronunciation problems

If your project has a helper script, a single-word regeneration command may look like this:

```powershell
node scripts/audio/generateSingleWord.mjs <word>
```

Example:

```powershell
node scripts/audio/generateSingleWord.mjs exacerbate
```

If your project has a batch or pipeline entry point, it may look like this:

```powershell
npm run generate-audio
node scripts/pipeline/runV3Pipeline.mjs <slug>
```

If you do not have project scripts, the important idea is simple:

1. create the text for each segment
2. call `tts.generate()` for each segment
3. save each WAV separately
4. measure durations
5. build timing metadata

### 2. Review `script.txt` before trusting the audio

Treat script review as mandatory QA, not optional cleanup.

If your workflow saves the generated narration text to a file such as `script.txt`, review it before rendering.

Example:

```powershell
Get-Content public/audio/<word>/script.txt
```

Check for:

- wrong part spelling
- awkward pause markers
- bad grammar
- incorrect example wording
- pronunciation hints that will sound unnatural

If your project does not generate a `script.txt`, create one. A saved text artifact makes pronunciation debugging much faster.

### 3. Measure timing after audio generation

If your project has a measurement script, the step may look like this:

```powershell
node scripts/measureAudio.mjs <word>
```

Even if your project uses a different command, the rule is the same: once the WAVs change, timing metadata must be recalculated.

## Pronunciation Techniques

## 1. Use `phoneticSpelling` as the first override

This is the most important pronunciation technique in this workflow.

If a root, prefix, suffix, or whole word needs controlled pronunciation, add `phoneticSpelling` in the source data and let the audio scripts use it.

Pattern used by the scripts:

```js
const spelledOut = part.phoneticSpelling ||
  part.text.split('').map(ch => letterNameMap[ch] || ch).join(', ');
```

Meaning:

- if `phoneticSpelling` exists, it wins
- otherwise the script falls back to spelling each character

Examples:

- `A, T, E` for suffixes like `ATE`
- `Ah-SERB` for roots like `ACERB`

Practical rule:

- do not fight bad pronunciation only in prompt text
- store the corrected pronunciation as data so regeneration stays consistent

## 2. Use commas for letter-by-letter reading

If you want Kokoro to read letters separately, use comma-separated letters.

Good:

- `A, T, E`
- `L, O, Q, U, A, C, I, O, U, S`

Why:

- commas push Kokoro toward letter names instead of reading the chunk as a normal word

## 3. Use hyphenated syllables when letter spelling sounds unnatural

For some roots, spelling every letter is worse than giving Kokoro a pronounceable syllable pattern.

Example:

- `Ah-SERB`

Use this when:

- the root should sound like a real spoken fragment, not a list of letters
- letter-by-letter output sounds robotic or misleading

## 4. Special-case the letter `A`

This workflow repeatedly needed a workaround for the letter `A`.

Problem:

- Kokoro may pronounce standalone `A` like the article `a`
- that gives an `uh` sound instead of the letter name

Fallback fix used in the scripts:

```js
const letterNameMap = { 'A': 'Ay' };
```

This helps when the script must spell letters individually.

Important nuance:

- `Ay` is useful as a fallback for letter-name pronunciation
- it is not always the correct spoken sound for the morphology you want
- for cases like `ATE`, use an explicit `phoneticSpelling` override such as `A, T, E`

## 5. Test multiple variants when one root sounds wrong

When one root sounds wrong, generate several alternatives and pick by ear.

If your project has a comparison script, it may look like this:

```powershell
node scripts/audio/testAcerbPronunciation.mjs
```

The important part is not the script name. The important part is the method: create several candidate spellings, export all of them, then listen.

Useful candidate patterns:

- `Ay, C, E, R, B`
- `Ah, C, E, R, B`
- `Ae, C, E, R, B`
- `A-SERB`
- `Ah-SERB`
- `Uh-SERB`

Practical rule:

- if a root sounds wrong, generate 4 to 8 variants and choose by ear
- then store the winner as `phoneticSpelling`

## 6. Keep pronunciation control in the data layer

Do not hard-code fragile pronunciation fixes inside one-off render code unless you are doing a temporary experiment.

Preferred flow:

1. fix pronunciation metadata in word data or DB
2. re-export if needed
3. regenerate audio
4. re-measure timing
5. re-render

This makes the fix repeatable across future regenerations.

## Pause And Script-Writing Tricks

Use punctuation as a lightweight prosody system.

Common conventions:

- `.` or normal sentence punctuation for natural flow
- `..` for a short extra pause
- `...` or `....` for a stronger break
- more dots in hook or connection lines when a slower dramatic explanation is desired

Examples from repo patterns:

- `The suffix, A, T, E.. from Latin.. means ...`
- `For example.. <sentence>..`
- connection lines often get more pauses than intro or example lines

Practical rule:

- start conservative
- use extra dots only where pacing matters
- always verify by listening, not by reading the text alone

Do not assume more dots always sounds better. Overusing them can make narration feel artificial.

## Silence Padding Tricks

Do not rely only on Kokoro's raw output. In most video workflows, adding silence padding makes the final result easier to animate and time.

Common padding values in current scripts:

- start padding: `0.15s`
- standard end padding: `0.35s`
- longer end padding for dramatic sections: `0.55s` or `0.65s`

Sections that often get longer padding:

- `intro`
- `connection`
- `introHook`

Why this exists:

- gives text animations a cleaner entrance
- prevents abrupt audio cutoffs
- makes frame-based timing easier to manage in Remotion

Dependencies for this part of the workflow:

- `ffmpeg`
- `ffprobe`

If those are missing, Kokoro may still generate audio, but the full timing workflow will be incomplete.

## Output And Folder Conventions

One practical output layout is:

```text
public/audio/<word>/
  intro.wav
  breakdown.wav
  part1.wav
  part2.wav
  part3.wav
  connection.wav
  example.wav
  script.txt
  timing.json
```

For v2 words:

```text
public/audio/<word>-v2/
```

For pronunciation experiments:

```text
public/audio/exacerbate-pronunciation-tests/
```

## Environment Notes

## Kokoro environment

Kokoro here is assumed to run in Node.js.

You usually just need:

- `npm install`
- Node available in the shell
- internet on first run so the model can download

There is no need for a dedicated conda environment for Kokoro itself in this workflow.

## WhisperX conda environment

If you see a conda environment in the surrounding workflow, that usually belongs to WhisperX, not Kokoro.

Example command:

```powershell
conda run -n whisperx whisperx <wav> --model large-v2 --output_format json --output_dir <dir> --language en
```

So if you are thinking of:

- word timestamps
- precise captions
- speech-to-text

that is the WhisperX sidecar workflow, not the Kokoro TTS layer.

## Troubleshooting Shortlist

## `Unsupported device: wasm`

Use:

```js
device: "cpu"
```

Do not use `wasm` as the default for Node-based Kokoro scripts unless you have a specific reason and have tested it.

## The audio sounds wrong only after render

Cause:

- you skipped `script.txt` review
- or you trusted default spelling for a tricky root

Fix:

1. inspect `script.txt`
2. update `phoneticSpelling`
3. regenerate the single word
4. re-measure timing
5. render again

If possible, listen to raw WAVs before rendering full video. That is cheaper than discovering the issue after a long render.

## The letter `A` sounds like `uh`

Fix options, in order:

1. add explicit `phoneticSpelling`
2. if you truly need a letter name fallback, map `A` to `Ay`
3. if it is a root, try a syllabic override like `Ah-SERB`

## Timing is off after new audio

Fix:

1. regenerate WAVs
2. rerun timing measurement
3. rerun WhisperX timestamps if that video uses precise subtitles

## Best Practices

- Prefer `af_heart` at `0.85` for production vocab videos.
- Prefer data-layer fixes over hard-coded one-off script hacks.
- Use `phoneticSpelling` before inventing new logic.
- Treat `script.txt` review as mandatory QA.
- Use pronunciation test variants when a root is stubborn.
- Remember that WhisperX is the conda-based transcription layer, not Kokoro.

## Standalone Decision Rules

If you only remember five things from this document, remember these:

1. Kokoro is for TTS. Use something else for STT.
2. Default to `af_heart`, `0.85`, `q8`, `cpu`.
3. Fix tricky pronunciation with `phoneticSpelling`, not with wishful thinking.
4. Save segmented WAVs, not one giant narration file, unless you have a strong reason.
5. Every audio change should trigger new timing measurement, and maybe new transcription timestamps.

## Fast Reference

### Generate one word

Example project command:

```powershell
node scripts/audio/generateSingleWord.mjs <word>
```

### Run v3 pipeline

Example project command:

```powershell
node scripts/pipeline/runV3Pipeline.mjs <slug>
```

### Test a tricky pronunciation

Example project command:

```powershell
node scripts/audio/testAcerbPronunciation.mjs
```

### Measure timing

Example project command:

```powershell
node scripts/measureAudio.mjs <word>
```

### Preview before render

Example project command:

```powershell
npm run remotion
```

### WhisperX timestamps

Example project command:

```powershell
node scripts/whisperx/generateWordTimestamps.mjs <word> v2 --model large-v2
```