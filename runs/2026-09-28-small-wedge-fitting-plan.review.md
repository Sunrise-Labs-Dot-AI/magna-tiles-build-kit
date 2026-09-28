# Small-wedge fitting measurement plan review

Fresh sequential GPT-5.5 medium read-only fallback review49032 completed with one WARNING; raw review: `reviews/small-wedge-fitting-plan-review.txt`. The source33 frame hash was independently matched and no withheld image was used.

| Finding | Disposition | Correction | Verified |
|---|---|---|---|
| A second-square placement residual could fit its own unknown orientation, translation and gap, then overstate layout evidence. | ACCEPT | Restrict the first calculation to conditional square-shape consistency; explicitly count8 homography parameters and3 rigid2D nuisance parameters/5 remaining scalar shape constraints. Prohibit a placement verdict without independently fixed relative geometry, which this increment lacks. Publish recovered pose/gap only as fit-dependent observations. | Main-agent reread confirms both the labeled output and prohibited inference; no production change. |

The other scope/binding/feature/uncertainty limits were clean. With the warning addressed, the revised plan is CLEAN for an off-path measurement proposal. This does not certify pixels, geometry, coplanarity, source fidelity or construction. The concrete annotations still require independent image/feature review before projection fitting.
