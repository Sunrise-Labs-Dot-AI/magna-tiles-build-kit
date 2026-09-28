# Measure the small wedge without merging separate assemblies

## Question and evidence boundary

The already reviewed five-panel wedge is clearly visible on the table in Henry's fitting frame at33s, while the four-panel launch is held separately. The frame is cataloged as `small-launch`. The current observation API correctly rejects wedge landmarks in that stage. Do not change the launch stage to include the wedge, relabel the frame as the completed nine-panel ramp, or bypass binding checks in the production evaluator.

Frame: `public/reference-frames/replication/henry/small-fit-33.png`, SHA-2569595d6e202d8b246aaaaae839e028a31cfd212c4775dd2cb44ff9867c8d34fff,1920×1080, source SHA-2562d2aca38030161b613d445154154e59a040514543079de9936869ba25d85bfe0. It has always been fitting/construction evidence. No withheld frame or prior heldout residual enters this experiment. The native/source-accounting qualification remains frozen while this separate image analysis runs.

## First deliverable: reviewed image measurements

Prepare an off-path annotation proposal with explicit component metadata: the catalog scene stage is `small-launch`, the measured component is the already completed `small-wedge`, and the launch is excluded from every measurement. This metadata is a proposed component binding, not an observation the production evaluator accepts.

Record straight visible outer-plastic edge segments for the two orange deck squares, distinguishing upper and lower squares by their source construction role. For each segment save its endpoint pixel coordinates, a visible uncertainty band, which physical boundary it follows, and any occlusion. Avoid rivet centers, magnet centers, internal decorative ribs, rounded corners and the yellow plastic visible through the orange tiles. Use a local measurement plot over the hashed fitting image to inspect every chosen segment. Unclear/occluded boundaries stay unmeasured rather than being assigned an ideal corner.

Use only these measured straight segments to extrapolate their same-panel intersections, propagating the declared endpoint/band uncertainty. The intersections are virtual sharp boundary corners, not observed plastic tips or direct mid-plane catalog vertices. Keep raw segments and extrapolated points separate. Do not assign a finite-thickness face offset until the visible face is independently identified. Independently review the annotated image and physical feature interpretation before any projection fitting. Review can reject a segment or leave an uncertainty unresolved; it need not produce a passing measurement set.

## Bounded planar diagnostic after measurement review

If the review establishes all four straight edges of each orange square, test conditional per-square shape consistency under a common-plane homography. The homography has eight degrees of freedom, fixed by the first square's four reviewed virtual corners; that exact fit is not validation. Map the second square through that fixed homography and compare its eight corner coordinates with an equal-size square, allowing only two translation parameters and one in-plane rotation (three nuisance parameters, leaving five scalar shape constraints). Report all fitted nuisance values and uncertainty under both fit directions. Label this result "within-frame per-square shape consistency under an assumed common plane". It is not a two-panel placement residual, proof of coplanarity, or source-dimension measurement. The second square is not a fresh independent view.

A two-panel placement residual is prohibited unless physical adjacency, relative orientation and a gap bound are independently reviewed and fixed before fitting; do not infer them from the same diagnostic corners and then claim validation. This increment has no such independent gap bound, so it will not compute that placement verdict. Report any recovered relative pose/gap only as a fit-dependent observation with its parameter count, never as a validated layout. Do not assume that the two squares form one uninterrupted six-inch rectangle. Do not optimize the catalog, source model, acceptance threshold or triangle dimensions.

This planar calculation does not recover a uniquely constrained3D camera, a hidden side pose, magnetic attachment or physical dimensions. Do not use it to bypass the production rejection of coplanar camera anchors. In particular, never apply the deck-plane homography to the non-coplanar yellow side to infer its side length. If the corner uncertainty or planarity prevents the intended comparison, record that failure and stop the planar phase instead of inventing3D evidence.

A future production component-binding/finite-face observation API and complete3D source constraint contract require a separate concrete proposal informed by this result. This increment does not implement either abstraction speculatively.

## Verification and delivery

Hash the original image and annotation proposal, retain the fitting-only role and actual scene/component distinction, test line-intersection and homography math with nondegenerate synthetic fixtures and reject degenerate inputs. Numeric evidence includes all segments, uncertainty cases and diagnostics, even failed cases. Native physics is not run; the active source/accounting inputs remain untouched. Any annotated creator-image plot stays ignored locally; publish only our numeric annotations and explanatory code, with reproducible source hashes. No source, assembly, fidelity, release or function status may change from this experiment.
