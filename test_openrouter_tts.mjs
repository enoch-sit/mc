import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const defaults = {
  model: "openai/gpt-4o-mini-tts-2025-12-15",
  input: "Hello! This is a text-to-speech test from OpenRouter.",
  voice: "alloy",
  responseFormat: "mp3",
  output: path.resolve("tts_test_outputs", "openrouter-test.mp3"),
  baseUrl: "https://openrouter.ai/api/v1/audio/speech",
  referer: "https://localhost",
  title: "Satwork TTS Test",
};

function parseArgs(argv) {
  const options = { ...defaults };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--model") {
      options.model = argv[++index];
    } else if (arg === "--input") {
      options.input = argv[++index];
    } else if (arg === "--voice") {
      options.voice = argv[++index];
    } else if (arg === "--response-format") {
      options.responseFormat = argv[++index];
    } else if (arg === "--output") {
      options.output = path.resolve(argv[++index]);
    } else if (arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node test_openrouter_tts.mjs [options]\n\nOptions:\n  --model <slug>\n  --input <text>\n  --voice <voice>\n  --response-format <mp3|wav|flac|opus|pcm>\n  --output <file>\n  --help`);
}

async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function readResponseBody(response) {
  const contentType = response.headers.get("content-type") || "unknown";
  const body = await response.arrayBuffer();
  return { contentType, bytes: Buffer.from(body) };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set in the environment.");
  }

  const payload = {
    model: options.model,
    input: options.input,
    voice: options.voice,
    response_format: options.responseFormat,
  };

  const response = await fetch(options.baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": defaults.referer,
      "X-OpenRouter-Title": defaults.title,
    },
    body: JSON.stringify(payload),
  });

  const { contentType, bytes } = await readResponseBody(response);
  console.log(`HTTP ${response.status} ${response.statusText}`);
  console.log(`content-type: ${contentType}`);
  console.log(`bytes: ${bytes.length}`);

  if (!response.ok) {
    const text = bytes.toString("utf8");
    throw new Error(`OpenRouter TTS request failed. Body: ${text}`);
  }

  if (contentType.includes("application/json")) {
    console.log(bytes.toString("utf8"));
    return;
  }

  await ensureDir(options.output);
  await fs.writeFile(options.output, bytes);
  console.log(`saved: ${options.output}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});