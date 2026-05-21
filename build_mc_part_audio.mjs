import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const audioDir = path.resolve("mc_practice_audio");
const outputDir = path.resolve("mc_part_audio");
const manifestDir = path.resolve("mc_part_audio_manifests");

const parts = [
  { name: "opening", ids: ["001", "002", "003", "004", "005", "006", "007", "008", "009", "010", "011", "012"] },
  { name: "session2-and-lunch", ids: ["013", "014", "015", "016", "017", "018", "019", "020", "021", "022", "023", "024", "025", "026", "027", "028", "029", "030", "031", "032", "033", "034", "035", "036", "037"] },
  { name: "session4-and-dinner", ids: ["038", "039", "040", "041", "042", "043", "044", "045", "046", "047", "048", "049", "050", "051", "052", "053", "054", "055"] },
  { name: "time-practice", ids: ["056", "057", "058", "059"] },
];

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function buildManifest(part) {
  const manifestPath = path.join(manifestDir, `${part.name}.txt`);
  const content = part.ids
    .map((id) => {
      const filePath = path.join(audioDir, `${id}.wav`).replaceAll("\\", "/");
      return `file '${filePath}'`;
    })
    .join("\n");

  await fs.writeFile(manifestPath, `${content}\n`, "utf8");
  return manifestPath;
}

function runFfmpeg(manifestPath, outputPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ffmpeg",
      [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        manifestPath,
        "-c",
        "copy",
        outputPath,
      ],
      { stdio: "inherit" }
    );

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`ffmpeg exited with code ${code}`));
    });
  });
}

async function main() {
  await ensureDir(outputDir);
  await ensureDir(manifestDir);

  for (const part of parts) {
    const missing = [];
    for (const id of part.ids) {
      const filePath = path.join(audioDir, `${id}.wav`);
      try {
        await fs.access(filePath);
      } catch {
        missing.push(filePath);
      }
    }

    if (missing.length > 0) {
      throw new Error(`Missing input audio for ${part.name}:\n${missing.join("\n")}`);
    }

    const manifestPath = await buildManifest(part);
    const outputPath = path.join(outputDir, `${part.name}.wav`);
    console.log(`Building ${outputPath}`);
    await runFfmpeg(manifestPath, outputPath);
  }

  console.log(`Saved ${parts.length} combined part files to ${outputDir}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});