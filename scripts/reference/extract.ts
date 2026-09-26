/** Source preflight and frame extraction. Does not download or redistribute media. */
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import sources from "../../verification/replication/sources.json";
const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
async function main() {
  const frames = [];
  for (const source of sources.sources) {
    const actual = hash(await readFile(source.localPath));
    if (actual !== source.sha256)
      throw new Error(
        `Source bytes changed: ${source.id}. Review and deliberately re-pin this source; no silent replacement.`,
      );
    const dir = `public/reference-frames/replication/${source.id}`;
    await mkdir(dir, { recursive: true });
    for (const frame of source.frames) {
      if (frame.seconds < 0 || frame.seconds >= source.duration)
        throw new Error(`Frame outside source: ${frame.id}`);
      const path = `${dir}/${frame.id}.png`;
      const result = spawnSync(
        "ffmpeg",
        [
          "-v",
          "error",
          "-ss",
          String(frame.seconds),
          "-i",
          source.localPath,
          "-frames:v",
          "1",
          "-threads",
          "1",
          "-y",
          path,
        ],
        { encoding: "utf8" },
      );
      if (result.status !== 0 || (await stat(path)).size === 0)
        throw new Error(result.stderr || `Missing frame ${frame.id}`);
      frames.push({
        id: frame.id,
        sourceId: source.id,
        sourceSha256: actual,
        seconds: frame.seconds,
        stage: frame.stage,
        partition: frame.use,
        path,
        sha256: hash(await readFile(path)),
      });
    }
  }
  await writeFile(
    "verification/replication/frame-manifest.json",
    JSON.stringify(
      {
        schema: 1,
        extractor:
          "ffmpeg accurate -ss before -i; PNG RGB output; timestamps are presentation seconds",
        frames,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `Verified two source hashes and extracted ${frames.length} frames locally.`,
  );
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
