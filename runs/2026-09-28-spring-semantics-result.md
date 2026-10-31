# Compliant seam proposal: native unit gate failed

The proposed two-point spring seam is **not qualified for a finite-tile fold run**. No production file, physical tolerance, source model or acceptance label changed. The original objective remains complete verified replicas and prompt-generated builds.

## Executed result

The third archived attempt ran all 11 force cases and 13 free-body cases. It returned exit 1 with 195/247 checks passing and 52 failing. The report remains `completed:false`; no exception interrupted the physical matrix. Both earlier preflight failures are preserved separately. They occurred before any integration step: deferred mass initialization, then the wrapper's Generic readback for a Spring descriptor.

Passed observations include native force units (relative error 2.154e-8 at the finest step), inverse-mass acceleration ratio 4, signed radial damping within 1%, negligible tangential damping, finite zero-separation states, all 12 fine-step energy bounds and decreasing undamped energy discrepancy under timestep refinement. These do not qualify the failed conservation and symmetry checks.

All 12 fine-step free-pair rows failed angular-momentum conservation including spin. For the identity undamped case, peak drift was 0.0645893 against the preregistered 0.000277416 kg*in²/s limit. Five rows also failed linear-momentum limits. Several translated/rotated cases failed the original pose, velocity or impulse invariance bounds. No bounds were relaxed. An independent Python matrix calculation on the saved native query states reproduced all initial and final momentum totals to 1e-12, supporting the conclusion that the drift is not just the shared quaternion helper's arithmetic.

Primary evidence: [manifest](diagnostics/2026-09-28-spring-semantics-v3.manifest.json), [raw report](diagnostics/2026-09-28-spring-semantics-v3.json.gz), [analysis](diagnostics/2026-09-28-spring-semantics-analysis.json). Manifest archives include the exact script, config, plan and runner. Raw report SHA-256: `399d6ad3cd7cdb757f5a13a2e4e6ecc245f07451b4444d294f2088fc6dae095e`. Runtime identity stayed `b354b6edcbcddb7248137e9888e97badfcb7eb2156f742760783587be5dbcf1a`.

## Isolated cause check

`scripts/reference/probe-free-spin.ts` removes every spring, collider, external force and gravity. One finite anisotropic body with inertia (0.4,0.5,0.6), mass 1 and initial angular velocity (0.2,-0.3,0.1) drifts 0.000780829 kg*in²/s over 0.1 seconds at dt=1e-4, above the unchanged 0.000209014 limit. Refining from dt=1e-3 does not materially reduce this drift (coarse 0.000780969). An isotropic control with inertia (0.5,0.5,0.5) conserves spin within 6e-17 at both timesteps. [All four control rows](diagnostics/2026-09-28-free-spin.json) completed; diagnostic completion explicitly does not mean conservation passed.

The pinned Rapier 0.30.1 Rust source defaults `gyroscopic_forces_enabled` to false. Its solver uses `angvel_with_gyroscopic_forces` only when this flag is enabled; the current JS binding does not expose that flag. Inference: missing gyroscopic integration contributes a real free-spin conservation defect. This control does **not** prove it explains all spring drift or frame sensitivity. Do not replace anisotropic tile inertia with spherical inertia to hide it. Any experimental binding/integration change must remain isolated and rerun the original failed matrix unchanged before a finite-tile seam is attempted.

## Review and continuation boundary

Type checking and focused lint both passed on the new diagnostic files (exit 0, no output). No new independent reviewer was launched in this turn. On rereading the operating substrate, the explicit September 17 preference forbids `codex exec` reviews; prior Claude OAuth failures do not override it. The executable diagnostics, API correction and results therefore remain independently unreviewed and uncommitted. This is not permission to land them or to promote the experimental seam. No credential changes or repeated authentication attempts were made.

Next useful engineering step: isolate the gyroscopic integration switch in the existing experimental runtime build setup, keep its identity separate from b354, and compare the torque-free control plus unchanged spring matrix. Preserve the current source/release reports as evidence of their tested scope; they do not establish the broader rotation behavior just shown to fail. The missing original snail video remains a separate source-evidence gap, not a blocker for this physics investigation.
