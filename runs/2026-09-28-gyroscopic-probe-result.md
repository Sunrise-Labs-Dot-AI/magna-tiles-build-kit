# Native connection checks pass in an isolated corrected configuration

The experimental f64 runtime with gyroscopic integration, a corrected principal-inertia transform, and free-pair timestep2.5e-5 passes all247 unit checks plus all6 free-spin controls. **No finite-tile seam, source replica or real magnetic calibration is qualified.** Production b354 and published1178de6 are unchanged. This turn made progress by identifying and testing three distinct numerical/rotation issues, rather than accepting a failed spring model or relaxing its physical limits.

## What changed the result

| Native configuration | Free-pair timestep | Passing original checks | Peak angular-momentum drift |
|---|---:|---:|---:|
| f32, gyro off | 1e-4 | 195/247 | 0.0730656 |
| f32, gyro on | 1e-4 | 198/247 | 0.0321024 |
| f64, gyro off | 1e-4 | 235/247 | 0.0646022 |
| f64, gyro on | 1e-4 | 241/247 | 0.000489690 |
| f64, gyro on | 5e-5 | 247/247 | 0.000244834 |
| f64, gyro on | 2.5e-5 | 247/247 | 0.000122414 |

Drift is in kg*in²/s; the preregistered bound remains approximately0.000277416. All original force, damping, energy, momentum, order and coordinate-invariance limits were retained. The finer configurations are alternatives, not passes for the original1e-4 configuration. The full matrices use12,111,24,111 and48,111 native `world.step()` calls respectively, excluding their separate free-spin controls. These are small unit-world execution counts, not a whole-build performance claim.

The new f32 binary with its gyro flag off exactly reproduces every saved baseline force/free row and verdict. All11 force cases and the conservative coarse row remain exactly unchanged across the f64 timestep refinements. [Six-configuration comparison](diagnostics/2026-09-28-gyroscopic-comparison.json) records the checks, step counts, drift and raw report hashes. Each configuration has its own archived runner, inputs, logs and reports; failed configurations remain failed.

The constant-velocity oracle independently isolates f32 accumulation error. With no springs, contacts or external force, translating the same world to(3,-2,5) produces0.00456670in error over0.1s atdt1e-4, and0.0327740in atdt1e-5. All six corresponding f64 cases stay below8e-11in. This supports using greater numerical precision for the experiment. It does not excuse collision defects or certify a full f64 application backend.

## Principal-inertia correction

The original native gyro function omits the body's local principal-inertia frame. A counter-rotated body with the same initial world inertia and angular velocity therefore behaves differently: spin drifts0.000854784 atdt1e-4, versus1.267e-8 for the identity representation. The isolated native patch uses body rotation times local principal-inertia frame when transforming angular velocity into and out of the diagonal-inertia coordinates. It leaves the existing capped gyro integration algorithm intact.

After this correction, the two representations agree in final world angular velocity to1.75e-15 or better at both tested timesteps, and both meet the original conservation bound. All247 spring checks still pass at2.5e-5, and all11 force cases remain exactly unchanged. [Final manifest](diagnostics/2026-09-28-gyroscopic-principal-frame.manifest.json), [native patch](diagnostics/2026-09-28-gyroscopic-principal-frame.native.patch), and [representation comparison](diagnostics/2026-09-28-gyroscopic-principal-frame-comparison.json) contain the evidence. The earlier rotated-inertia failures are preserved separately.

Final experimental CJS SHA-256: `bd257411df16050f6ab6f005990693d4b9d71ebe7aa22a572a8dfbe8bed4d74b`. Final WASM SHA-256: `45c1c252af5bc0e4f51ab2cf4dcb3716870c261b028db7b5344451d2a9006438`. Native patch SHA-256: `ce23b9668ed9928edf4c18e81de0a9157163625678ed5511cda870039943d97e`. It uses the existing production Parry contact patch, pinned Rapier0.30.1/Parry0.25.1 and a separately hashed precision wrapper. No installed registry source or production artifact was edited.

Historical build-proof `scope` text says getter/setter only, but its explicit `precision`, `principalFrameFix` and patch hashes correctly identify the additional changes. The current recipe corrects that descriptive text; this post-run metadata-only edit does not change the archived tested recipe or runtime.

## Boundary and next step

Independent plan/code/results review remains pending. The saved September17 preference forbids Codex review jobs; previous Claude sign-in failures remain unresolved. The user has a pending choice to restore Claude or permit project-specific Codex reviews. No review subprocess, credential change, commit, push, merge or production promotion occurred this turn.

Before any runtime adoption, test the corrected configuration on actual finite tile solids with exact mass/inertia, matching of immutable magnet points, finite break force/distance, no reattachment after a break, and physical collision guards. Then start from freshly earned strip joins, fold in both directions with only the endpoint panels gripped, earn the closing edge and release to rest. The higher-precision wrapper also needs the previously specified full-coordinate contact and ownership/state checks; the old f64 contact failure cannot be dismissed by these no-contact unit tests. Full source fidelity, complete assembly and passive car turning remain separate unmet requirements.
