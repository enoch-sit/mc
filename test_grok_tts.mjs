import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const defaults = {
  text: "Hello! Welcome to the xAI text-to-speech API test.",
  voiceId: "eve",
  language: "en",
  codec: "mp3",
  sampleRate: 24000,
  bitRate: 128000,
  output: path.resolve("tts_test_outputs", "grok-test.mp3"),
  baseUrl: "https://api.x.ai/v1/tts",
};

function parseArgs(argv) {
  const options = { ...defaults };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--text") {
      options.text = argv[++index];
    } else if (arg === "--voice") {
      options.voiceId = argv[++index];
    } else if (arg === "--language") {
      options.language = argv[++index];
    } else if (arg === "--codec") {
      options.codec = argv[++index];
    } else if (arg === "--sample-rate") {
      options.sampleRate = Number(argv[++index]);
    } else if (arg === "--bit-rate") {
      options.bitRate = Number(argv[++index]);
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
  console.log(`Usage: node test_grok_tts.mjs [options]\n\nOptions:\n  --text <text>\n  --voice <voice-id>\n  --language <code>\n  --codec <mp3|wav|pcm|mulaw|alaw>\n  --sample-rate <number>\n  --bit-rate <number>\n  --output <file>\n  --help`);
}

async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function readResponseBody(response) {
  const contentType = response.headers.get("content-type") || "unknown";
  const body = await response.arrayBuffer();
  return { contentType, bytes: Buffer.from(body) };
}

function getApiKey() {
  return process.env.XAI_API_KEY || process.env.GROK_API_KEY_EMAIL || process.env.GROK_API_KEY;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const apiKey = getApiKey();

  if (!apiKey) {
    throw new Error("No xAI API key found. Set XAI_API_KEY, GROK_API_KEY_EMAIL, or GROK_API_KEY in the environment.");
  }

  const payload = {
    text: options.text,
    voice_id: options.voiceId,
    language: options.language,
    output_format: {
      codec: options.codec,
      sample_rate: options.sampleRate,
      ...(options.codec === "mp3" ? { bit_rate: options.bitRate } : {}),
    },
  };

  const response = await fetch(options.baseUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const { contentType, bytes } = await readResponseBody(response);
  console.log(`HTTP ${response.status} ${response.statusText}`);
  console.log(`content-type: ${contentType}`);
  console.log(`bytes: ${bytes.length}`);

  if (!response.ok) {
    const text = bytes.toString("utf8");
    throw new Error(`xAI TTS request failed. Body: ${text}`);
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