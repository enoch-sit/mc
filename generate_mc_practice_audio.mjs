import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const defaults = {
  input: path.resolve("mc_practice_lines.txt"),
  outdir: path.resolve("mc_practice_audio"),
  voice: "af_heart",
  speed: 0.85,
  dryRun: false,
};

function parseArgs(argv) {
  const options = { ...defaults };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--input") {
      options.input = path.resolve(argv[index + 1]);
      index += 1;
    } else if (arg === "--outdir") {
      options.outdir = path.resolve(argv[index + 1]);
      index += 1;
    } else if (arg === "--voice") {
      options.voice = argv[index + 1];
      index += 1;
    } else if (arg === "--speed") {
      options.speed = Number(argv[index + 1]);
      index += 1;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(options.speed) || options.speed <= 0) {
    throw new Error("--speed must be a positive number.");
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node generate_mc_practice_audio.mjs [options]

Options:
  --input <file>    Practice lines file. Default: mc_practice_lines.txt
  --outdir <dir>    Output folder for WAV files. Default: mc_practice_audio
  --voice <name>    Kokoro voice. Default: af_heart
  --speed <value>   Playback speed. Default: 0.85
  --dry-run         Validate and print the lines without generating audio
  --help            Show this help message`);
}

function parsePracticeLines(rawText) {
  return rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const separatorIndex = line.indexOf("|");

      if (separatorIndex === -1) {
        throw new Error(`Invalid line format: ${line}`);
      }

      const id = line.slice(0, separatorIndex).trim();
      const text = line.slice(separatorIndex + 1).trim();

      if (!id || !text) {
        throw new Error(`Invalid line format: ${line}`);
      }

      return { id, text };
    });
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function generateAudio(options, lines) {
  const { KokoroTTS } = await import("kokoro-js");
  const tts = await KokoroTTS.from_pretrained(
    "onnx-community/Kokoro-82M-v1.0-ONNX",
    {
      dtype: "q8",
      device: "cpu",
    }
  );

  await ensureDir(options.outdir);

  for (const line of lines) {
    const outputPath = path.join(options.outdir, `${line.id}.wav`);
    console.log(`Generating ${path.basename(outputPath)}: ${line.text}`);

    const audio = await tts.generate(line.text, {
      voice: options.voice,
      speed: options.speed,
    });

    audio.save(outputPath);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const rawText = await fs.readFile(options.input, "utf8");
  const lines = parsePracticeLines(rawText);

  if (options.dryRun) {
    console.log(`Loaded ${lines.length} practice lines from ${options.input}`);
    for (const line of lines) {
      console.log(`${line.id}: ${line.text}`);
    }
    return;
  }

  await generateAudio(options, lines);
  console.log(`Saved ${lines.length} WAV files to ${options.outdir}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});