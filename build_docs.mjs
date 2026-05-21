import fs from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(".");
const WEBAPP_DIR = path.join(ROOT, "webapp");
const DOCS_DIR = path.join(ROOT, "docs");

async function resetDocsDir() {
  await fs.rm(DOCS_DIR, { recursive: true, force: true });
  await fs.mkdir(DOCS_DIR, { recursive: true });
}

async function copyFile(relativePath) {
  await fs.copyFile(
    path.join(WEBAPP_DIR, relativePath),
    path.join(DOCS_DIR, relativePath)
  );
}

async function copyDirectory(sourceRelativePath, destinationRelativePath = sourceRelativePath) {
  await fs.cp(
    path.join(ROOT, sourceRelativePath),
    path.join(DOCS_DIR, destinationRelativePath),
    { recursive: true }
  );
}

async function writeDocsConfig() {
  const sourceConfigPath = path.join(WEBAPP_DIR, "config.js");
  const configSource = await fs.readFile(sourceConfigPath, "utf8");
  const docsAssetPaths = [
    '  assetPaths: {',
    '    data: "./data/mc_cue_index.json",',
    '    localAudio: "./audio/mc_practice_audio",',
    '    openrouterAudio: "./audio/teacher_tts_audio/openrouter",',
    '    grokAudio: "./audio/teacher_tts_audio/grok",',
    '  },',
  ].join("\n");

  const docsConfig = configSource.replace(
    /window\.MC_CUE_APP_CONFIG = \{\s*/,
    (match) => `${match}\n${docsAssetPaths}\n`
  );

  await fs.writeFile(path.join(DOCS_DIR, "config.js"), docsConfig);
}

async function main() {
  await resetDocsDir();
  await Promise.all([
    copyFile("index.html"),
    copyFile("styles.css"),
    copyFile("app.js"),
    writeDocsConfig(),
    copyDirectory(path.join("webapp", "data"), "data"),
    copyDirectory("mc_practice_audio", path.join("audio", "mc_practice_audio")),
    copyDirectory(path.join("teacher_tts_audio", "openrouter"), path.join("audio", "teacher_tts_audio", "openrouter")),
    copyDirectory(path.join("teacher_tts_audio", "grok"), path.join("audio", "teacher_tts_audio", "grok")),
  ]);
  await fs.writeFile(path.join(DOCS_DIR, ".nojekyll"), "");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});