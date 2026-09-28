#!/usr/bin/env python3
"""Build the pinned contact runtime in a new, caller-specified directory.

Requires git, curl, npm, Node 25.6.0, Rust 1.98.1 with wasm32-unknown-unknown,
and wasm-pack 0.12.1. Nothing compiles during application installation.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile


SOURCE_SHA = "f072e6efa75f4f61a290bd0b58b61c443685ec01"
PARRY_SHA = "017be73f24c8ca8b10f9727616e5cb9af82b98488cc6d5eea468e727ffa780ca"
RECIPE = Path(__file__).resolve().parent


def run(*args, cwd=None, env=None):
    subprocess.run(args, cwd=cwd, env=env, check=True)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("work_directory", type=Path)
    parser.add_argument("--wasm-pack", default="wasm-pack")
    args = parser.parse_args()
    output = args.work_directory.resolve()
    root = Path("/tmp/magnatiles-contact-build").resolve()
    if output.exists() or root.exists():
        raise SystemExit("Work directory must not exist; rebuild never deletes an existing directory.")
    versions = {}
    for tool, expected in [("node", "v25.6.0"), ("rustc", "rustc 1.98.1"), (args.wasm_pack, "wasm-pack 0.12.1")]:
        value = subprocess.check_output([tool, "--version"], text=True).strip()
        if not (value == expected or value.startswith(expected + " ")):
            raise SystemExit(f"Wrong toolchain: expected {expected}, received {value}")
        versions[Path(tool).name] = value
    root.mkdir(parents=True)
    output.mkdir(parents=True)
    source = root / "source"
    run("git", "init", str(source))
    run("git", "-C", str(source), "fetch", "--depth=1", "https://github.com/dimforge/rapier.js.git", SOURCE_SHA)
    run("git", "-C", str(source), "checkout", "--detach", "FETCH_HEAD")
    archive = root / "parry.crate"
    run("curl", "--fail", "--location", "--output", str(archive), "https://static.crates.io/crates/parry3d/parry3d-0.25.1.crate")
    if digest(archive) != PARRY_SHA:
        raise SystemExit("Parry archive does not match the pinned digest.")
    with tarfile.open(archive) as tar:
        # The archive is checksum-verified, and still cannot escape the work root.
        for member in tar.getmembers():
            target = (root / member.name).resolve()
            if not target.is_relative_to(root) or member.issym() or member.islnk():
                raise SystemExit("Unexpected path/link in the source archive.")
        tar.extractall(root)
    parry = root / "parry"
    (root / "parry3d-0.25.1").rename(parry)
    run("git", "apply", str(RECIPE / "parry.patch"), cwd=parry)
    rust = source / "builds/rapier3d"
    rust.mkdir(parents=True, exist_ok=True)
    shutil.copy2(RECIPE / "rapier.Cargo.toml", rust / "Cargo.toml")
    shutil.copy2(RECIPE / "Cargo.lock", rust / "Cargo.lock")
    compat = source / "rapier-compat"
    shutil.copy2(RECIPE / "package-lock.json", compat / "package-lock.json")
    run("npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund", cwd=compat)
    wasm = compat / "builds/3d/wasm-build"
    env = os.environ.copy()
    # Cargo hashes path/flag inputs into crate metadata before Rust remapping.
    # Use a fixed build/cache path as well as remapping source diagnostics.
    env["CARGO_HOME"] = str(root / "cargo")
    mappings = [(str(root), "/magnatiles-build")]
    if str(root).startswith("/private/tmp/"):
        mappings.append((str(root).removeprefix("/private"), "/magnatiles-build"))
    env.pop("CARGO_ENCODED_RUSTFLAGS", None)
    env["RUSTFLAGS"] = " ".join(f"--remap-path-prefix={a}={b}" for a, b in mappings)
    env["CARGO_TARGET_DIR"] = str(root / "target")
    run(args.wasm_pack, "build", "--target", "web", "--out-dir", str(wasm), "--", "--locked", cwd=rust, env=env)

    gen = compat / "builds/3d/gen3d"
    shutil.copytree(source / "src.ts", gen)
    shutil.copytree(compat / "src3d", gen, dirs_exist_ok=True)
    for path in gen.rglob("*.ts"):
        lines, skip = [], False
        for line in path.read_text().splitlines(keepends=True):
            if "#if DIM2" in line:
                skip = True
            if not skip:
                lines.append(line)
            if skip and "#endif" in line:
                skip = False
        path.write_text("".join(lines))
    pkg = compat / "builds/3d/pkg"
    pkg.mkdir()
    for path in wasm.glob("rapier_wasm*"):
        shutil.copy2(path, pkg / path.name)
    raw = pkg / "rapier_wasm3d.js"
    raw.write_text(raw.read_text().replace("import.meta.url", '"<deleted>"'))
    for name in ["tsconfig.common.json", "tsconfig.json"]:
        shutil.copy2(compat / name, pkg.parent / name)
    shutil.copy2(compat / "tsconfig.pkg3d.json", pkg.parent / "tsconfig.pkg.json")
    shutil.copy2(RECIPE / "rollup.config.js", compat / "rollup.contact.config.js")
    run("npx", "--no-install", "rollup", "--config", "rollup.contact.config.js", "--bundleConfigAsCjs", cwd=compat)
    proof = {
        "sourceCommit": SOURCE_SHA,
        "parryArchiveSha256": PARRY_SHA,
        "patchSha256": digest(RECIPE / "parry.patch"),
        "toolchain": versions,
        "artifacts": {name: digest(pkg / name) for name in ["rapier.cjs", "rapier.mjs", "rapier_wasm3d_bg.wasm"]},
        "rustLockSha256": digest(rust / "Cargo.lock"),
        "npmLockSha256": digest(compat / "package-lock.json"),
    }
    shutil.copytree(pkg, output / "pkg")
    (output / "build-proof.json").write_text(json.dumps(proof, indent=2) + "\n")
    print(json.dumps(proof, indent=2))
    # Only this invocation's newly created, fixed build directory is removed.
    # Failed builds remain available for diagnosis and are never overwritten.
    shutil.rmtree(root)


if __name__ == "__main__":
    main()
