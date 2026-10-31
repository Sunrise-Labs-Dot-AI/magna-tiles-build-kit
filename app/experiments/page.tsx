"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TileViewer } from "@/app/components/TileViewer";
import type { DropResult, DropShape } from "@/lib/experiments/tile-drop";
import "./experiments.css";

export default function ExperimentsPage() {
  const [shape, setShape] = useState<DropShape>("equilateral-triangle");
  const [result, setResult] = useState<DropResult | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [frame, setFrame] = useState(0), [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing || !result) return;
    let cursor = frame;
    const timer = setInterval(() => {
      cursor += 1;
      setFrame(Math.min(cursor, result.frames.length - 1));
      if (cursor >= result.frames.length - 1) { clearInterval(timer); setPlaying(false); }
    }, 80);
    return () => clearInterval(timer);
    // Capture the chosen start frame when playback begins; sliders stop playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, result]);
  async function run() {
    if (busy) return;
    setBusy(true); setError(""); setPlaying(false);
    try {
      const response = await fetch("/api/experiments/tile-drop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shape }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The experiment could not run.");
      setResult(data); setFrame(0);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The experiment could not run."); }
    finally { setBusy(false); }
  }
  return <main className="experiment-shell">
    <header className="experiment-heading">
      <p className="experiment-eyebrow">MAGNETIC TILE BUILDER / EXPERIMENTS</p>
      <h1>Try the work in progress.</h1>
      <p>The latest tile physics is active in this app. Explore it with a small live test, build from a prompt, or replay the folding experiments. Full build checks are slower and may reach the four-minute analysis limit.</p>
      <nav><Link href="/design">Build with experimental physics →</Link><Link href="/references">Jet & ramp reconstructions →</Link><a href="http://127.0.0.1:3010/design">Open previous version</a></nav>
    </header>
    <section className="experiment-section" aria-labelledby="drop-heading">
      <div><p className="experiment-eyebrow">01 / LIVE PHYSICS</p><h2 id="drop-heading">Drop a tile</h2>
        <p>A real run of the experimental engine. Choose a shape, then inspect its recorded fall and contact with the table.</p>
        <div className="experiment-controls"><label>Tile shape <select value={shape} disabled={busy} onChange={e => setShape(e.target.value as DropShape)}>
          <option value="small-square">Square</option><option value="equilateral-triangle">Equilateral triangle</option><option value="right-triangle">Right triangle</option>
        </select></label><button onClick={run} disabled={busy}>{busy ? "Running…" : "Run tile drop"}</button></div>
        {error && <p role="alert">{error}</p>}
        {result && <div className="experiment-result" role="status"><strong>{result.invalidState || result.solidFailures.length ? "This run hit a physics failure" : "Recorded 0.8 seconds of motion"}</strong>
          <p>{result.solidFailures.join(" ") || "Inspect the motion below. A successful drop does not verify a whole build."}</p>
          <small>{result.precisionBits}-bit coordinates · rotation correction {result.gyroscopicForces ? "on" : "off"} · maximum step {result.maxStepSeconds * 1000000} μs</small>
        </div>}
      </div>
      <div><div className="experiment-canvas"><TileViewer build={result?.frames[frame]?.build ?? null} visibleStep={Infinity} framingTiles={result?.frames.flatMap(f => f.build.tiles)} /></div>
        {result && <div className="experiment-playback"><button onClick={() => { if (frame === result.frames.length - 1) setFrame(0); setPlaying(!playing); }}>{playing ? "Pause" : "Replay slowly"}</button>
          <label>Simulation time <input aria-label="Tile drop time" type="range" min={0} max={result.frames.length - 1} value={frame} onChange={e => { setPlaying(false); setFrame(Number(e.target.value)); }} /></label>
          <output>{result.frames[frame].seconds.toFixed(3)} s</output></div>}
      </div>
    </section>
    <section className="experiment-fold"><p className="experiment-eyebrow">02 / RECORDED FOLDING</p><h2>Where the hinge work has reached</h2>
      <p>Compare the original hinge with the tested surface-pivot idea. These are recordings from the earlier engine. The pivot succeeds in one direction; a connection that folds reliably both ways is still in development.</p>
      <iframe src="/experiments/measured-folding.html" title="Recorded folding comparison" />
    </section>
    <section className="experiment-evidence"><p className="experiment-eyebrow">03 / CURRENT EVIDENCE</p><h2>What’s enabled, and what’s still an experiment</h2>
      <ul><li>Higher-precision coordinates and the corrected tile-rotation calculation are active in new Design lab runs.</li>
        <li>The spring prototype passed 247 unit checks; its replacement for tile joins has not been implemented. Builds still use the existing hinges.</li>
        <li>All 198 tile-contact scenarios passed. The broader experimental suite still has one failing test in its historical regression helper.</li>
        <li>The reference workshop contains saved jet and ramp evidence from the previous engine. Those reports have not been rerun with this experimental version.</li>
      </ul>
      <p><a href="/experiments/spring-and-rotation.json" download>Spring and rotation results</a> · <a href="/experiments/tile-contacts.json" download>Tile-contact results</a> · <a href="/experiments/fold-release.json" download>Captured fold and release results</a></p>
      <p>Independent review and complete-build verification are still pending.</p>
    </section>
  </main>;
}
