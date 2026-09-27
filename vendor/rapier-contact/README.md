# Headless solid-contact runtime

This private package is a pinned f32 Rapier.js 0.19.2 wrapper with a small Parry
0.25.1 contact-normal/cache correction. Rapier Rust is 0.30.1. The JS wrapper,
joint model, physical geometry, material constants and solver settings are
unchanged. The application adapter is `lib/engine/physics-backend.ts`.

Both CommonJS and ESM imports resolve to **one CJS entry** so there is one WASM
instance. Do not import the generated package directly from application code.
The browser's separate interactive sandbox retains upstream Rapier.

The patch checks complete polyhedral separating axes before using an inconsistent
GJK/EPA normal, and validates finite witnesses before reusing cached contacts.
It appends the optional extra GJK witness only when both points lie on the finite
support surfaces and their separation agrees with the selected contact normal.
This prevents coincident origin placeholders from supplementing valid clipped contacts.
Original finite-feature clipping and impulse matching remain in place. Eligibility
is restricted to zero-border cuboids and convex polyhedra with faces of at most
four vertices; other shapes and the specialized cuboid/cuboid path are unchanged.

`provenance.json` pins the source commit, crate archive, patch, dependency locks,
toolchain and output hashes. `build/parry.patch` is the complete source change.
The source/algorithm review is `runs/reviews/polyhedral-contact-cache-review.txt`.
This package is a numerical correction, not physical calibration or source-fidelity
evidence. The continuous independent solid guard remains required.

## Rebuild

Install the exact tool versions recorded in `provenance.json`, including the Rust
`wasm32-unknown-unknown` target. Run from the repository root:

```sh
python3 vendor/rapier-contact/build/rebuild.py /tmp/rapier-proof-a
python3 vendor/rapier-contact/build/rebuild.py /tmp/rapier-proof-b
```

Each output directory must be new. Compilation uses the fixed
`/tmp/magnatiles-contact-build` directory and a fresh Cargo cache. The recipe refuses
an existing build directory, removes only its own successful build, and retains a
failed build for diagnosis. Source paths in runtime diagnostics are normalized.
Do not run two rebuilds concurrently. `--wasm-pack` can identify an explicit tool
binary. Compare both `build-proof.json` files and each packaged runtime hash.
Cargo embeds path/flag identity in crate metadata, so arbitrary compilation
directory names do not provide identical bytes even after source-path remapping.

Rebuilds fetch the exact upstream commit and checksum-verified Parry archive, apply
the committed patch, use locked dependencies, and never publish or install a
runtime into the application automatically. Application installation uses the
committed artifacts and does not compile Rust or access this recipe.

Before replacing the artifact, rerun the unchanged contact matrix, cached and
randomized geometry checks, impacts, settings/ownership/state tests, full harness
checks and fresh source construction. Regenerate evidence fingerprints; do not
reuse older reports or physical states. An upstream update must pass the same gates.
