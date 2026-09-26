import { mkdir, writeFile } from "node:fs/promises";
import { replicas } from "../../lib/replication/models";
import { evaluateReferenceCandidate } from "../../lib/harness/reference";
import { stageBuild } from "../../lib/replication/geometry";
import { projectPoint } from "../../lib/replication/projection";
import { tileWorldVertices } from "../../lib/magnetic-tiles/magnet-geometry";
import type { Observation } from "../../lib/replication/types";
import data from "../../verification/replication/observations.json";
import { artifactHashes } from "../../lib/replication/provenance";
const escape = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
async function main() {
  await mkdir("public/reference-replicas", { recursive: true });
  await mkdir("public/reference-frames/replication", { recursive: true });
  const summaries = [],
    comparisons = [];
  const artifacts = ["verification/replication/results.json"];
  for (const replica of replicas()) {
    const observations = data.observations as Observation[];
    const report = await evaluateReferenceCandidate(
      replica.build,
      replica,
      observations,
      {
        deadline: Date.now() + 240000,
      },
    );
    await writeFile(
      `public/reference-replicas/${replica.id}.json`,
      JSON.stringify({ replica, report }, null, 2) + "\n",
    );
    artifacts.push(`public/reference-replicas/${replica.id}.json`);
    for (const projection of report.projections) {
      if (!projection.camera) continue;
      const o = observations.find((o) => o.id === projection.id)!,
        stage = replica.stages.find((s) => s.id === o.stageId)!,
        build = stageBuild(replica, stage);
      const polygons = build.tiles
        .map(
          (t) =>
            `<polygon points="${tileWorldVertices(t)
              .map((p) =>
                projectPoint(p, projection.camera!)
                  .map((n) => n.toFixed(2))
                  .join(","),
              )
              .join(
                " ",
              )}" fill="${t.color}" fill-opacity=".25" stroke="${t.color}" stroke-width="2"/>`,
        )
        .join("");
      const residuals = projection.residuals
        .map(
          (r) =>
            `<line x1="${r.observed[0]}" y1="${r.observed[1]}" x2="${r.projected[0]}" y2="${r.projected[1]}" stroke="${r.use === "check" ? "#ed3548" : "#243d66"}" stroke-width="2"/><circle cx="${r.observed[0]}" cy="${r.observed[1]}" r="5" fill="none" stroke="#172c45" stroke-width="2"><title>${escape(r.id)}: ${r.errorPx.toFixed(2)} px</title></circle>`,
        )
        .join("");
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${o.width} ${o.height}">${polygons}${residuals}</svg>`;
      await writeFile(`public/reference-replicas/${o.id}.svg`, svg);
      artifacts.push(`public/reference-replicas/${o.id}.svg`);
      const src = `/reference-frames/replication/${replica.sourceId}/${projection.frameId}.png`;
      comparisons.push(
        `<section><h2>${escape(replica.title)} / ${escape(o.frameId)}</h2><p>${escape(projection.status)}: scored RMS ${projection.rmsPx?.toFixed(2)} px; maximum ${projection.maxPx?.toFixed(2)} px. ${escape(projection.detail)}</p><div class="compare"><img src="${src}"/><div class="overlay">${svg}</div></div><p>Circles: annotated source corners. Blue lines: camera anchors. Red lines: independent checks. Creator footage is local only.</p></section>`,
      );
    }
    const summary = {
      id: replica.id,
      pieces: replica.build.tiles.length,
      checks: report.checks,
      replication: report.replication,
      fingerprint: report.fingerprint,
      stages: report.stages,
      releaseTrials: report.releases.map(({ settledProjections, ...r }) => ({
        ...r,
        settledProjectionStatuses: settledProjections.map((p) => ({
          id: p.id,
          status: p.status,
          rmsPx: p.rmsPx,
        })),
      })),
    };
    summaries.push(summary);
    console.log(
      `${replica.id}: ${replica.build.tiles.length} pieces; ${Object.entries(
        report.checks,
      )
        .map(([k, c]) => `${k}=${c.status}`)
        .join(", ")}`,
    );
  }
  const missingSource = {
    id: "snail",
    pieces: null,
    checks: {
      source: {
        status: "unverified",
        detail: "Exact 3D source missing; no substitute model authored.",
      },
    },
    replication: "not-verified",
  };
  await writeFile(
    "verification/replication/results.json",
    JSON.stringify(
      {
        schema: 1,
        scope:
          "Source, shape, physics, assembly and function remain separate. Artifact generation success is not replica acceptance.",
        summaries: [...summaries, missingSource],
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(
    "public/reference-frames/replication/comparison.html",
    `<!doctype html><meta charset="utf-8"><title>Local source comparisons</title><style>body{font:16px system-ui;margin:32px;color:#172c45}section{max-width:1200px;margin:48px auto}.compare{position:relative}.compare img{display:block;width:100%}.overlay{position:absolute;inset:0}.overlay svg{width:100%;height:100%}</style><h1>Source versus rigid-tile render</h1><p>Locally extracted creator frames with fixed source annotations. No final replica passes the full criteria in this report.</p>${comparisons.join("")}`,
  );
  await writeFile(
    "verification/replication/artifact-manifest.json",
    JSON.stringify(await artifactHashes(artifacts), null, 2) + "\n",
  );
  console.log(
    "Models, numbered instructions and independent evidence written. No full replica has been verified.",
  );
  if (!process.argv.includes("--report-only")) process.exitCode = 1;
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
