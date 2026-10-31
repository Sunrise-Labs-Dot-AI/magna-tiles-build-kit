# Local experimental preview

James explicitly requested all current experimental work in the app he can test. Full engineering loop remains pending independent review; this isolated local preview is authorized and unreviewed, with no production deployment or acceptance promotion.

Materialize the tested f64 native artifact, its exact profile, full-coordinate hull arrays, principal-frame gyro correction, per-tile gyro switch and 2.5e-5 collision step in this separate managed checkout. Preserve all geometry, material assumptions, forces, solid/floor guards, solver settings and durations. Give it a distinct state identity. Keep the existing stable app on port3010.

Add an experimental landing page, live catalog-tile drop with recorded 3D playback, existing measured folding comparison, and current diagnostic result downloads. Existing Design lab requests must use the experimental backend; verify the runtime actually enables gyro, receives f64 coordinates and identifies its package. Saved source reports and older folding recordings remain explicitly historical. Do not imply the unimplemented compliant seam is enabled.

Check types, focused lint, live route input rejection, all three live tile shapes, actual drop motion/finite state and one Design lab request; inspect the UI and playback. Leave the experimental app running for James.

## Integration corrections and checks

The 1/120-second reporting interval needs334 collision observations with the 2.5e-5 maximum step. Use ceil rather than round so an observation never hides two finer native steps. A focused native test verifies exactly one step per observation, f64 arrays, gyro enablement and rejection of an old state. Catalog car hulls also require Float64Array at the new backend boundary; explicitly unpatched controls retain Float32Array.

All3 live tile shapes return49 frames,64-bit input and gyro enabled, with finite motion and no solid failure. Types and focused lint pass. A 6-piece tower request returns a candid needs-repair result. The 2-wide box hits the unchanged four-minute analysis budget after245seconds; it is not accepted. Long Design lab checks now run in owned child processes to keep the web server responsive, with request cancellation and a hard outer timeout.

Final checks: TypeScript and focused lint pass. Native preview observation/state test passes. Worker smoke check returns the 6-piece result, verifies a long build runs in a separate process, serves a live drop in666ms during it, and confirms cancellation leaves zero worker children. The local experimental app remains on port3011; previous version remains on3010. Browser tile-drop playback advanced to0.8seconds, and the recorded folding slider reset both recordings to0seconds. No production deployment, new qualification label or review claim.
