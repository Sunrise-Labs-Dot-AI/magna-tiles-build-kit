"""Build an isolated binding for Rapier's existing gyro switch; never replace vendor artifacts."""
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import re
import tomllib

PRECISION = os.environ.get('MAGNATILES_GYRO_PRECISION', 'f32')
assert PRECISION in ('f32', 'f64')
FRAME_FIX = os.environ.get('MAGNATILES_GYRO_FRAME_FIX') == '1'
assert not FRAME_FIX or PRECISION == 'f64'
ROOT = Path('/tmp/magnatiles-gyroscopic-probe' + ('-f64' if PRECISION == 'f64' else '') + ('-principal-frame' if FRAME_FIX else ''))
BASE = Path('/tmp/magnatiles-contact-repro-1/source')
TOOLS = Path('/tmp/magnatiles-rust-tools')
RECIPE = Path('vendor/rapier-contact/build').resolve()
COMMIT = 'f072e6efa75f4f61a290bd0b58b61c443685ec01'


def run(*args, cwd=None, env=None):
    subprocess.run(args, cwd=cwd, env=env, check=True)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    if ROOT.exists():
        raise SystemExit('Preserve previous build: output directory already exists')
    assert subprocess.check_output(['git', '-C', str(BASE), 'rev-parse', 'HEAD'], text=True).strip() == COMMIT
    ROOT.mkdir()
    source = ROOT / 'source'
    source.mkdir()
    archive = subprocess.check_output(['git', '-C', str(BASE), 'archive', COMMIT])
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        tar.extractall(source, filter='data')
    parry_archive = BASE.parent / 'parry.crate'
    parry_name = 'parry3d-0.25.1'
    if PRECISION == 'f64':
        parry_archive, = (TOOLS / 'cargo/registry/cache').glob('*/parry3d-f64-0.25.1.crate')
        parry_name = 'parry3d-f64-0.25.1'
    assert sha(parry_archive) == ('37165b1c4e8969f9013d6c21825fb80529aba893d455386d3ce78c9593babf8e'
        if PRECISION == 'f64' else '017be73f24c8ca8b10f9727616e5cb9af82b98488cc6d5eea468e727ffa780ca')
    with tarfile.open(parry_archive) as tar:
        tar.extractall(ROOT, filter='data')
    (ROOT / parry_name).rename(ROOT / 'parry')
    run('git', 'apply', str(RECIPE / 'parry.patch'), cwd=ROOT / 'parry')
    if PRECISION == 'f64':
        precision_patch = Path('scripts/reference/gyroscopic-f64-wrapper.patch').resolve()
        assert sha(precision_patch) == '69bb4befb7248f1c02f42537e9c6840ca8cb58fc4f119d320e855e4eba5e4337'
        run('git', 'apply', str(precision_patch), cwd=source)

    rust_path = source / 'src/dynamics/rigid_body.rs'
    ts_path = source / 'src.ts/dynamics/rigid_body.ts'
    original_rust, original_ts = rust_path.read_text(), ts_path.read_text()
    rust_needle = '    pub fn rbAdditionalSolverIterations('
    ts_needle = '    public additionalSolverIterations():'
    assert original_rust.count(rust_needle) == 1 and original_ts.count(ts_needle) == 1
    rust_path.write_text(original_rust.replace(rust_needle, '''    pub fn rbGyroscopicForcesEnabled(&self, handle: FlatHandle) -> bool {
        self.map(handle, |rb| rb.gyroscopic_forces_enabled())
    }

    pub fn rbEnableGyroscopicForces(&mut self, handle: FlatHandle, enabled: bool) {
        self.map_mut(handle, |rb| rb.enable_gyroscopic_forces(enabled))
    }

''' + rust_needle))
    ts_path.write_text(original_ts.replace(ts_needle, '''    public gyroscopicForcesEnabled(): boolean {
        return this.rawSet.rbGyroscopicForcesEnabled(this.handle);
    }

    public enableGyroscopicForces(enabled: boolean): void {
        this.rawSet.rbEnableGyroscopicForces(this.handle, enabled);
    }

''' + ts_needle))
    import difflib
    patch = ''.join(difflib.unified_diff(original_rust.splitlines(True), rust_path.read_text().splitlines(True),
        fromfile='a/src/dynamics/rigid_body.rs', tofile='b/src/dynamics/rigid_body.rs'))
    patch += ''.join(difflib.unified_diff(original_ts.splitlines(True), ts_path.read_text().splitlines(True),
        fromfile='a/src.ts/dynamics/rigid_body.ts', tofile='b/src.ts/dynamics/rigid_body.ts'))
    (ROOT / 'gyroscopic-binding.patch').write_text(patch)

    rust = source / 'builds/rapier3d'
    rust.mkdir(parents=True, exist_ok=True)
    shutil.copy2(RECIPE / 'rapier.Cargo.toml', rust / 'Cargo.toml')
    shutil.copy2(RECIPE / 'Cargo.lock', rust / 'Cargo.lock')
    if PRECISION == 'f64':
        manifest = (rust / 'Cargo.toml').read_text().replace('rapier3d = { version', 'rapier3d = { package = "rapier3d-f64", version')
        manifest = manifest.replace('parry3d = "', 'parry3d-f64 = "').replace('parry3d={path=', 'parry3d-f64={path=')
        (rust / 'Cargo.toml').write_text(manifest)
        lock = Path('scripts/reference/gyroscopic-f64.Cargo.lock')
        assert sha(lock) == '0d77ee17924036480e0f9d123a45a16442bd7a6b676cf7972bbf9bb0ebf77710'
        shutil.copy2(lock, rust / 'Cargo.lock')
    if FRAME_FIX:
        package = next(p for p in tomllib.loads((rust / 'Cargo.lock').read_text())['package'] if p['name'] == 'rapier3d-f64')
        native_archive, = (TOOLS / 'cargo/registry/cache').glob('*/rapier3d-f64-0.30.1.crate')
        assert sha(native_archive) == package['checksum']
        with tarfile.open(native_archive) as tar:
            tar.extractall(ROOT, filter='data')
        (ROOT / 'rapier3d-f64-0.30.1').rename(ROOT / 'rapier')
        path = ROOT / 'rapier/src/dynamics/rigid_body.rs'
        original = path.read_text()
        old = '        let w = self.pos.position.inverse_transform_vector(self.angvel());'
        new = '''        let principal_rotation = self.pos.position.rotation
            * self.mprops.local_mprops.principal_inertia_local_frame;
        let w = principal_rotation.inverse_transform_vector(self.angvel());'''
        old_return = '            self.pos.position * (ii.component_mul(&capped_momentum))'
        assert original.count(old) == 1 and original.count(old_return) == 1
        changed = original.replace(old, new).replace(old_return, '            principal_rotation * (ii.component_mul(&capped_momentum))')
        path.write_text(changed)
        (ROOT / 'principal-frame.patch').write_text(''.join(difflib.unified_diff(original.splitlines(True), changed.splitlines(True),
            fromfile='a/src/dynamics/rigid_body.rs', tofile='b/src/dynamics/rigid_body.rs')))
        manifest = (rust / 'Cargo.toml').read_text() + '\nrapier3d-f64={path="../../../rapier"}\n'
        (rust / 'Cargo.toml').write_text(manifest)
        locked = (rust / 'Cargo.lock').read_text()
        pattern = r'(\[\[package\]\]\nname = "rapier3d-f64"\nversion = "0\.30\.1"\n)source = "[^"\n]+"\nchecksum = "[^"\n]+"\n'
        locked, replacements = re.subn(pattern, r'\1', locked)
        assert replacements == 1
        (rust / 'Cargo.lock').write_text(locked)
    compat = source / 'rapier-compat'
    shutil.copy2(RECIPE / 'package-lock.json', compat / 'package-lock.json')
    assert sha(compat / 'package-lock.json') == sha(BASE / 'rapier-compat/package-lock.json')
    (compat / 'node_modules').symlink_to(BASE / 'rapier-compat/node_modules', target_is_directory=True)
    env = os.environ.copy()
    env.update(CARGO_HOME=str(TOOLS / 'cargo'), RUSTUP_HOME=str(TOOLS / 'rustup'),
        CARGO_TARGET_DIR=str(ROOT / 'target'), RUSTFLAGS=f'--remap-path-prefix={ROOT}=/magnatiles-gyro-probe')
    env['PATH'] = str(TOOLS / 'cargo/bin') + os.pathsep + env['PATH']
    env.pop('CARGO_ENCODED_RUSTFLAGS', None)
    wasm_pack = TOOLS / 'npm/node_modules/.bin/wasm-pack'
    versions = {tool: subprocess.check_output([executable, '--version'], env=env, text=True).strip()
        for tool, executable in [('node', 'node'), ('rustc', 'rustc'), ('wasm-pack', str(wasm_pack))]}
    assert versions['node'] == 'v25.6.0' and versions['rustc'].startswith('rustc 1.98.1 ') and versions['wasm-pack'] == 'wasm-pack 0.12.1'
    wasm = compat / 'builds/3d/wasm-build'
    run(str(wasm_pack), 'build', '--target', 'web', '--out-dir', str(wasm), '--', '--locked', '--offline', cwd=rust, env=env)
    gen = compat / 'builds/3d/gen3d'
    shutil.copytree(source / 'src.ts', gen)
    shutil.copytree(compat / 'src3d', gen, dirs_exist_ok=True)
    for path in gen.rglob('*.ts'):
        lines, skip = [], False
        for line in path.read_text().splitlines(keepends=True):
            if '#if DIM2' in line:
                skip = True
            if not skip:
                lines.append(line)
            if skip and '#endif' in line:
                skip = False
        path.write_text(''.join(lines))
    pkg = compat / 'builds/3d/pkg'
    pkg.mkdir()
    for path in wasm.glob('rapier_wasm*'):
        shutil.copy2(path, pkg / path.name)
    raw = pkg / 'rapier_wasm3d.js'
    raw.write_text(raw.read_text().replace('import.meta.url', '"<deleted>"'))
    for name in ['tsconfig.common.json', 'tsconfig.json']:
        shutil.copy2(compat / name, pkg.parent / name)
    shutil.copy2(compat / 'tsconfig.pkg3d.json', pkg.parent / 'tsconfig.pkg.json')
    shutil.copy2(RECIPE / 'rollup.config.js', compat / 'rollup.contact.config.js')
    run('npx', '--no-install', 'rollup', '--config', 'rollup.contact.config.js', '--bundleConfigAsCjs', cwd=compat, env=env)
    proof = {'scope': 'Experimental precision and gyroscopic variant; inspect precision/principalFrameFix and patch hashes. False flag default preserved; not production or source acceptance.',
        'precision': PRECISION, 'sourceCommit': COMMIT, 'toolchain': versions, 'bindingPatchSha256': sha(ROOT / 'gyroscopic-binding.patch'),
        'principalFrameFix': FRAME_FIX, 'nativePatchSha256': sha(ROOT / 'principal-frame.patch') if FRAME_FIX else None,
        'precisionPatchSha256': sha(precision_patch) if PRECISION == 'f64' else None,
        'parryPatchSha256': sha(RECIPE / 'parry.patch'), 'rustLockSha256': sha(rust / 'Cargo.lock'),
        'npmLockSha256': sha(compat / 'package-lock.json'), 'buildRecipeSha256': sha(Path(__file__)),
        'artifacts': {name: sha(pkg / name) for name in ['rapier.cjs', 'rapier.mjs', 'rapier_wasm3d_bg.wasm']}}
    (ROOT / 'build-proof.json').write_text(json.dumps(proof, indent=2) + '\n')
    print(json.dumps(proof))


if __name__ == '__main__':
    main()
