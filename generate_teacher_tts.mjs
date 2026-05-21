import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const defaults = {
  provider: "grok",
  input: path.resolve("mc_practice_lines.txt"),
  outputDir: path.resolve("teacher_tts_audio"),
  openrouterModel: "x-ai/grok-voice-tts-1.0",
  openrouterVoice: "eve",
  openrouterFormat: "mp3",
  grokVoice: "eve",
  grokLanguage: "en",
  grokCodec: "mp3",
  grokSampleRate: 24000,
  grokBitRate: 128000,
  startId: null,
  endId: null,
  dryRun: false,
};

function parseArgs(argv) {
  const options = { ...defaults };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--provider") {
      options.provider = argv[++index];
    } else if (arg === "--input") {
      options.input = path.resolve(argv[++index]);
    } else if (arg === "--output-dir") {
      options.outputDir = path.resolve(argv[++index]);
    } else if (arg === "--start-id") {
      options.startId = argv[++index];
    } else if (arg === "--end-id") {
      options.endId = argv[++index];
    } else if (arg === "--openrouter-model") {
      options.openrouterModel = argv[++index];
    } else if (arg === "--openrouter-voice") {
      options.openrouterVoice = argv[++index];
    } else if (arg === "--grok-voice") {
      options.grokVoice = argv[++index];
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!["grok", "openrouter"].includes(options.provider)) {
    throw new Error("--provider must be grok or openrouter.");
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node generate_teacher_tts.mjs [options]

Options:
  --provider <grok|openrouter>    TTS provider to use
  --input <file>                  Practice lines file
  --output-dir <dir>              Base output directory
  --start-id <id>                 First line ID to generate
  --end-id <id>                   Last line ID to generate
  --openrouter-model <slug>       OpenRouter speech model
  --openrouter-voice <voice>      OpenRouter voice
  --grok-voice <voice>            xAI voice ID
  --dry-run                       Show transformed lesson text only
  --help                          Show this help message`);
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

function selectLines(lines, startId, endId) {
  return lines.filter((line) => {
    if (startId && line.id < startId) {
      return false;
    }
    if (endId && line.id > endId) {
      return false;
    }
    return true;
  });
}

function buildTeachingText(text) {
  return text;
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function readResponseBody(response) {
  const contentType = response.headers.get("content-type") || "unknown";
  const body = await response.arrayBuffer();
  return { contentType, bytes: Buffer.from(body) };
}

async function synthesizeWithOpenRouter(options, teachingText, outputPath) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set in the environment.");
  }

  const response = await fetch("https://openrouter.ai/api/v1/audio/speech", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://localhost",
      "X-OpenRouter-Title": "Satwork Teacher TTS",
    },
    body: JSON.stringify({
      model: options.openrouterModel,
      input: teachingText,
      voice: options.openrouterVoice,
      response_format: options.openrouterFormat,
    }),
  });

  const { contentType, bytes } = await readResponseBody(response);
  if (!response.ok) {
    throw new Error(`OpenRouter failed for ${path.basename(outputPath)}: ${bytes.toString("utf8")}`);
  }
  if (contentType.includes("application/json")) {
    throw new Error(`OpenRouter returned JSON for ${path.basename(outputPath)}: ${bytes.toString("utf8")}`);
  }

  await fs.writeFile(outputPath, bytes);
}

function getGrokApiKey() {
  return process.env.XAI_API_KEY || process.env.GROK_API_KEY_EMAIL || process.env.GROK_API_KEY;
}

async function synthesizeWithGrok(options, teachingText, outputPath) {
  const apiKey = getGrokApiKey();
  if (!apiKey) {
    throw new Error("No xAI API key found. Set XAI_API_KEY, GROK_API_KEY_EMAIL, or GROK_API_KEY.");
  }

  const response = await fetch("https://api.x.ai/v1/tts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: teachingText,
      voice_id: options.grokVoice,
      language: options.grokLanguage,
      output_format: {
        codec: options.grokCodec,
        sample_rate: options.grokSampleRate,
        bit_rate: options.grokBitRate,
      },
    }),
  });

  const { contentType, bytes } = await readResponseBody(response);
  if (!response.ok) {
    throw new Error(`xAI failed for ${path.basename(outputPath)}: ${bytes.toString("utf8")}`);
  }
  if (contentType.includes("application/json")) {
    throw new Error(`xAI returned JSON for ${path.basename(outputPath)}: ${bytes.toString("utf8")}`);
  }

  await fs.writeFile(outputPath, bytes);
}

async function synthesize(options, teachingText, outputPath) {
  if (options.provider === "openrouter") {
    await synthesizeWithOpenRouter(options, teachingText, outputPath);
    return;
  }

  await synthesizeWithGrok(options, teachingText, outputPath);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const rawText = await fs.readFile(options.input, "utf8");
  const lines = selectLines(parsePracticeLines(rawText), options.startId, options.endId);

  if (lines.length === 0) {
    throw new Error("No practice lines matched the selected range.");
  }

  const providerOutputDir = path.join(options.outputDir, options.provider);
  await ensureDir(providerOutputDir);

  for (const line of lines) {
    const teachingText = buildTeachingText(line.text);
    const outputPath = path.join(providerOutputDir, `${line.id}.mp3`);

    if (options.dryRun) {
      console.log(`${line.id}: ${teachingText}`);
      continue;
    }

    console.log(`Generating ${options.provider} teaching audio for ${line.id}`);
    await synthesize(options, teachingText, outputPath);
    console.log(`saved: ${outputPath}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});