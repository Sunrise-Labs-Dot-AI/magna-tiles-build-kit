# MagnaTiles archival checkpoint, 2026-10-30

James requested that all work be kept on GitHub and removed from this Mac. This is a preservation checkpoint, not a reviewed release or a claim that reconstruction is complete.

## Preserved work

- This branch combines the September29 local experimental app with all280 previously unpublished physics scripts, raw diagnostic records, plans and reviews from the footage worktree.
- The experimental app uses the f64 native runtime, principal-frame gyroscopic correction, full-precision tile hulls, live drop tests, recorded folding viewer and cancellable child-process build checks.
- Existing source-backed reconstruction and assembly evidence remains at1178de6191454c2ed1b367fc8e840b097f54b022 and draft PR4.
- Original local main is preserved separately at2ca960b841d8cc5f81feff4bfbf2088057157b19, including its unpublished builder/unified-viewer history. The source-sets branch at95051c86d1cee8d6790be15c99a2cf26803365be is preserved too.
- Per-checkout patches, deleted-tracked-paths.json lists and local-state-manifest.json retain the original outstanding edits and absent tracked files. Deleted tracked file contents remain available in each saved original commit. The original folding visualization is included unchanged.

## Recovery

The GitHub release `local-archive-2026-10-30` contains a Git bundle with all local repository refs, a source-media/frame archive, a media SHA-256 manifest and SHA256SUMS. The media includes the original two YouTube reference videos and extracted frames. Dependency installations and generated build caches can be regenerated and are intentionally excluded.

Clone this archive branch to recover the experimental app and diagnostics. Alternatively run `git clone magna-tiles-git-history.bundle recovered-magnatiles` after downloading and verifying the release assets; then select the desired branch. The release includes the full saved ref list. Extract the media archive separately. Install the package dependencies, then use `npm run dev:experimental` to open the local app. Ports3010/3011 were local previews and cease when the local project is removed.

## Known limits

No complete source replica is verified. The spring replacement for tile joins remains unimplemented. The latest spring/rotation unit prototype passed247checks plus6rotation controls; the tile-contact matrix passed198rows, while the experimental suite had14/15 selected tests passing because its frozen historical regression helper compares a native vector object to a plain JSON object. Full build checks can reach the unchanged four-minute analysis limit. These historical results have not been rerun as part of archival. Independent review of the newest experimental work is pending.

The native build recipe pins upstream commits, package locks and patch digests, but references temporary build/toolchain directories that no longer exist on this machine. Reconstruct those prerequisites to rebuild the native package; the compiled f64 artifact and its proof are saved in vendor/rapier-contact.
