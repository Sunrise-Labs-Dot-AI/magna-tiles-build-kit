# Auto-Generating Buildable, Recognizable Magna-Tile Models

## A literature-grounded system design

*Synthesized from ~90 academic papers, technical blogs, and real systems across construction synthesis, computational origami, few-view reconstruction, discrete search, perceptual objectives, shape grammars, and mixed-initiative design. Citations are inline; full numbered references at the end. Opinionated where the evidence supports it; flagged where the evidence is thin.*

---

## 1. Executive summary

The recommended architecture treats the Magna-Tile build as a **rigid-foldable thick-panel assembly defined on a half-edge hinge graph** (not as free-floating tiles in space, and not as a voxel grid). A build is grown by **edge-folding operations** from a small library of part-templates that are themselves emitted by a **part-grammar prior** (a ShapeAssembly-style program over fuselage/wing/tail proxies [F-26]). Every operation is a hinge attachment with an explicitly bounded fold angle, so **non-self-intersection and magnetic connectivity are correct by construction** — the half-thickness offset and the maximum dihedral angle imposed by Tachi's bisecting-plane thick-panel model [B-20] are baked into the move generator, not checked after the fact. To make **wide flat wings expressible**, the data model adds a "coplanar lateral extension" move (square-to-square fold at dihedral ≈ 180°, anchored on a flat body facet) alongside the closed-shell folds, which is exactly the geometry origami struggles with and which we treat as a first-class primitive. The **target** is reconstructed from 3–10 frames with DUSt3R/MASt3R [C-15, C-16] for a metric pose-free point cloud, intersected with a multi-view **visual hull** [C-1] for a clean watertight occupancy at known scale. The **solver** is an AlphaZero-style **learned-policy-guided MCTS over hinge moves** [D-18], with a hard validity mask (the move generator only emits collision-free, magnetically-valid attachments) and a **CP-SAT** [D-19] fallback for small sub-assemblies where provable optimality is cheap. The **recognizability objective** is a deliberately multi-component, multi-view ensemble — voxel IoU (coarse structure) + min-over-views silhouette IoU (outline) + min-over-views CLIP (semantics) + a part-grammar plausibility term + an anti-sparseness surface-coverage penalty — combined with **early-stopping against Goodhart drift** [E-16] and a periodic **VLM critic** [E-15] as a held-out gold check. The **acceptance contract** is a hard gate (physical validity + connectivity + gravity stability) followed by a soft recognizability threshold that must be confirmed by the held-out critic, not the optimized proxy.

---

## 2. Per-area survey (strongest methods + one-line takeaways)

### Area A — Automated assembly / construction synthesis from a kit

The dominant paradigm is **sequential placement under a hard validity oracle**, and the strongest recent systems all separate a *scorer* (which placement is good?) from a *constraint filter* (which placement is legal?).

- **Brick-by-Brick** (NeurIPS 2021): actor-critic RL places LEGO bricks sequentially conditioned on target images, with an **action-validity prediction network** pruning illegal placements [A-1]. Takeaway: the sequential-placement + validity-mask pattern maps directly onto edge-to-edge tile snapping, but the validity check must be extended from lattice-overlap to *dihedral-angle feasibility*.
- **Budget-Aware Sequential Brick Assembly** (TMLR 2024): a 3D sparse-conv scorer predicts the next brick, and a **one-initialized convolution filter** validates no-overlap on GPU; beats RL, BO, and graph-generative baselines on validity and diversity [A-5]. Takeaway: this is the state of the art for LEGO-analogous assembly and argues for *learned scorer + explicit (non-learned) constraint filter* over end-to-end RL.
- **LegoGPT** (2025): LLM next-token brick prediction with **physics-aware rollback** that deletes unstable bricks and resumes [A-6]. Takeaway: rollback-on-violation is a clean way to keep a generative model inside the feasible set without a differentiable physics loss.
- **Legolization** (Luo et al., SIGGRAPH Asia 2015): force-based stability metric + **split-and-remerge local refinement** around weak regions [A-3]. Takeaway: a local "edge-swap" refinement operator on the hinge graph, driven by a stability metric, is the right late-stage polish step.
- **Testuz et al.** (EG 2013): graph-based connectivity analysis repairs disconnected/weak components layer-by-layer [A-2]. Takeaway: connectivity is a graph property of the assembly, checkable incrementally.
- **Computational design of assemblies STAR** (Wang, Song, Pauly, EG 2021): the definitive survey; organizes the field by objective (shape approximation, structural stability via rigid-body equilibrium, reconfigurability, tileability) [A-7]. Takeaway: our stability model should use the friction/contact-force (here: hinge-moment) equilibrium formulation it documents.
- **CofiFab** (SIGGRAPH 2016) and **FrameFab** (SIGGRAPH Asia 2016): flat-panel interlocking-joint design, and *fabrication-sequence planning where every prefix is statically stable* [A-8, A-9]. Takeaway: "is every partial build stable?" is a known, solved check we should adopt for assembly ordering.
- **Interlocking puzzles** (Song 2012; Chen 2022): the **disassembly graph** encodes which piece is removable [A-10, A-11]. Takeaway: a disassembly/removability graph is the right tool to certify that no tile is "floating."

*Thin evidence:* no published system handles a **polygon-tile vocabulary with arbitrary dihedral fold angles and magnetic polarity** — Magna-Tiles sit between the LEGO lattice world and the origami crease world, and nobody has built exactly this.

### Area B — Hinged-panel / folded-plate / net representations

This area supplies the **core geometry/data model** and the answer to thickness.

- **Rigid-Foldable Thick Origami** (Tachi, 5OSME 2010): offset each face by half-thickness, then **trim by the bisecting plane of each dihedral angle**; the max fold angle is π − δ with tan(δ/2) ∝ thickness [B-20]. **This is the central thickness model** — it makes "no interpenetration" a closed-form constraint on the fold angle at every hinge.
- **Origami of Thick Panels** (Chen, Peng, You, *Science* 2015): replaces the crease with a **spatial overconstrained linkage** giving *exact* kinematic equivalence to the zero-thickness fold with thick rigid panels [B-21]. Takeaway: the rigorous model for a thick hinge; use for high-fidelity validation of single-vertex regions.
- **Thickness-accommodation review** (Lang et al., AMR 2018): catalogs all seven strategies (axis-shift, tapered trimming, volume trimming, spatial-linkage, compliant, crease-splitting, offset-panel) [B-22]. Takeaway: for *uniform-thickness rigid tiles* the choice is **axis-shift or offset-panel** at hinges plus **vertex volume-trimming** where ≥3 tiles meet.
- **Flat-Foldable Rigid Origami with Uniform-Thickness Panels** (Shimoda, Tachi, Sato, AAG 2020): conditions on sector angles and thickness ratio for *uniform* panels that fold fully flat [B-24]. Takeaway: this is the closest geometry to actual Magna-Tiles and gives the buildability conditions at degree-4 vertices.
- **Origamizer** (Demaine & Tachi, SoCG 2017): computes a watertight crease pattern folding into *any* target polyhedron [B-13]. Takeaway: solves the inverse net problem for zero-thickness panels — gives net *topology* that we then thicken.
- **Freeform Origami** + **rigid-foldable PQ mesh** (Tachi 2010): the **product-of-rotations-around-each-interior-vertex = identity** constraint is the algebraic test of fold validity, and **planar-quad / conical meshes** (Pottmann survey) are the correct mesh class for square tiles, with **parallel/offset meshes** modeling constant panel thickness [B-14, B-18, B-19]. Takeaway: PQ/conical mesh theory is the right mathematical language; offset meshes natively encode thickness.
- **FOLD format** + **Origami Simulator** (Ghassaei et al.): a JSON half-edge mesh with per-edge fold angle and face stacking order, plus a GPU hinge-spring simulator [B-25, B-26]. Takeaway: adopt FOLD as the serialization and the simulator as the visualization/fold-animation engine.

*Thin evidence:* multi-vertex thick-panel assemblies with a *discrete* tile vocabulary are under-theorized; the vertex region where 3+ thick tiles meet needs explicit per-case geometry (volume trimming), and **non-convex net generation has no general guarantee** [B-15].

### Area C — Shape-from-images for the target (3–10 frames, known scale)

- **DUSt3R / MASt3R** (CVPR 2024 / 2024): pose-free, calibration-free dense pointmaps from 2+ uncalibrated images; MASt3R adds metric scale [C-15, C-16]. **Recommended primary reconstructor** — exactly matches "a handful of video frames, known object size."
- **Visual hull / space carving** (Laurentini; Kutulakos & Seitz): intersection of silhouette cones gives a guaranteed conservative outer bound, converging to the true shape minus concavities [C-1, C-2]. Takeaway: for piecewise-flat, mostly-convex tile builds the visual hull is *more reliable than appearance-based depth* and yields a clean occupancy grid at the tile scale.
- **Differentiable renderers** — Soft Rasterizer, nvdiffrast, PyTorch3D, Neural 3D Mesh Renderer [C-4, C-5, C-6, C-3]: back-propagate silhouette/photometric loss to fit a parametric model. Takeaway: **nvdiffrast** is the production choice to *refine* a tile-assembly hypothesis against the observed silhouettes.
- **Feed-forward single-image** — LRM, TripoSR, InstantMesh, Zero-1-to-3, One-2-3-45 [C-12, C-13, C-14, C-10, C-11]: seconds-fast mesh from one image. Takeaway: useful **cold-start prior** when only 1–2 frames exist, but all hallucinate hidden geometry and *struggle with thin flat panels* — never trust them as the sole target.
- **Sparse NeRF / InstantSplat** [C-17]: high-quality radiance fields from 3+ views but produce a visual proxy needing a meshing step.

**Recommended pipeline:** SAM2 segmentation → multi-view **visual hull** for guaranteed-conservative occupancy + **MASt3R** for metric pose/scale → optional **nvdiffrast** silhouette refinement → discretize to a tile-scale occupancy grid + extract a coarse part decomposition. *Thin evidence:* thin-panel objects are intrinsically depth-ambiguous from appearance, which is precisely why we lean on the silhouette/visual-hull path rather than NeRF/splatting.

### Area D — Generator / solver under hard constraints with a perceptual objective

- **Structured agents + MCTS** (Bapst et al., DeepMind, ICML 2019): on physical block-construction, **model-based MCTS with object-centric/graph representations beats model-free RL** on the hardest tasks [D-18]. **The key empirical result motivating our solver choice.**
- **Blocks Assemble!** (Ghasemipour et al., ICML 2022): large-scale RL with a **graph policy** in a *magnetic-block* environment (functionally Magna-Tiles) generalizes zero-shot to unseen blueprints; curriculum learning is essential [D-25]. Takeaway: a graph policy over the hinge graph is the right network; expect heavy training and curriculum.
- **Budget-Aware Assembly** (TMLR 2024) again [D-27]: learned scorer + hard conv filter is the current best for LEGO-like assembly. Takeaway: prefer supervised next-move scoring over sparse-reward RL where possible.
- **CP-SAT / ILP** (OR-Tools; Kollsker MILP thesis) [D-19, D-20]: guaranteed constraint satisfaction and optimality for ≲50-part problems; `AddNoOverlap3D` handles box packing. Takeaway: ideal for **small sub-assemblies / vertex regions**, poor at scale and at non-linear perceptual objectives.
- **CMA-ES** [D-22]: black-box continuous optimizer; only useful as a **continuous post-refinement** of fold angles, not for the discrete combinatorial search (discretization gap). *Thin evidence* for direct tile placement.
- **Beam search**: cheap first baseline; fails on non-local early-commitment errors.

**Documented failure modes across the board:** sparse final-only rewards, reward hacking, local minima, scalability collapse past ~50 parts for pure search, NP-hard blowup for ILP, and the continuous-discrete gap for CMA-ES. The consistent lesson: **hard constraints via an explicit filter, soft objective via a learned value, look-ahead via MCTS.**

### Area E — Recognizability objectives that resist reward-hacking

This is where the "valid-but-boxy" and "gameable score" problems live.

- **Multi-view silhouette IoU** via Soft Rasterizer [E-1]; Garifullin et al. demonstrate the exact procedural-parameter-from-silhouette loop [E-2]. Takeaway: cheap and differentiable, but **single-view silhouette is trivially gamed** — needs ≥8–12 views and *min* (not mean) aggregation.
- **Chamfer vs. EMD** (Fan, Su, Guibas) [E-4]: CD is fast but **hollow-structure-gameable** (a few well-placed points score well) — this *is* the token-tile hack; **EMD/DeepEMD** [E-5] forces full matching and resists it. Takeaway: prefer EMD-family for the surface-coverage term.
- **Voxel IoU**: penalizes both missing and spurious mass → harder to game than CD; good coarse "does it have wings/fuselage/tail" signal; Pix3D calibrated all three against humans [E-6]. Takeaway: the structural backbone of the score.
- **LPIPS** [E-7], with **E-LPIPS / R-LPIPS** for adversarial robustness [E-8, E-9] (LPIPS itself is attackable [E-10]). Takeaway: ensemble/transform-robust perceptual term, never the raw metric.
- **CLIP objectives** — DreamFields, CLIP-Forge, Text2Mesh [E-11, E-12, E-13]: usable semantic signal, but **DreamFields and Lee & Chang [E-14] document that raw CLIP guidance mode-collapses into adversarial blobs** unless multi-view + geometry-regularized. Takeaway: CLIP min-over-views only, never alone.
- **Goodhart / reward-overoptimization theory** — Karwowski et al. (NeurIPS 2023) prove true reward *falls* past a critical optimization point and propose **optimal early stopping**; Gao et al. give overoptimization scaling laws and motivate **KL penalties / ensembles**; Laidlaw et al. recommend **χ² regularization to a realistic prior** [E-16, E-17, E-18]. **This is the theoretical core of the un-gameable design.**
- **VLM-as-critic** — RL-VLM-F shows a VLM can judge "does this look like a fighter jet?" at near-human accuracy [E-15]. Takeaway: use a VLM as a *held-out gold critic*, not as the optimized proxy, to detect when the proxy has drifted.

### Area F — Part-based / grammar-based generative priors

- **ShapeAssembly** (Jones et al., SIGGRAPH Asia 2020): a domain-specific **assembly language** declaring cuboid part proxies attached hierarchically, a hierarchical VAE that writes novel programs, and a **differentiable interpreter** that fits programs to point clouds [F-26]. **The single most directly transferable system** — swap "cuboid proxy" for "tile-panel proxy."
- **GRASS / StructureNet / SCORES / PartNet** [F-22, F-23, F-25, F-24]: recursive/​n-ary part-graph generative models and the airplane/vehicle part vocabulary (fuselage, wing, engine, tail) that defines what "recognizable jet" structurally means. Takeaway: provides the *part prior* and a latent space the optimizer can search.
- **Shape grammars / CGA split grammars** (Stiny; Mueller et al.) [F-19, F-20]; **inverse procedural modeling / guided proceduralization** [F-21] to *extract* a grammar from the reconstructed reference. Takeaway: a split grammar ("body → fuselage + wing-mounts + tail") decomposes the global search into recognizable sub-problems.
- **CSGNet / ShapeCoder / Ellis graphics programs** [F-27, F-29, F-28]: program-synthesis machinery for discovering reusable macros ("a wing pair") and parsing shapes into editable programs. Takeaway: enables compact, human-editable build programs and reusable part abstractions.

*Thin evidence:* the unified stack (tile grammar + differentiable silhouette loss + CLIP recognizability) has **never been published as one system** — this is a genuine research gap, not an integration of off-the-shelf parts.

### Area G — Mixed-initiative / human-in-the-loop

- **Computational LEGO Technic Design** (Xu et al., SIGGRAPH Asia 2020): the closest published prior art — a weighted objective of **faithfulness + simplicity + structural integrity** searched over a brick set, benchmarked against professional designers [G-33]. Takeaway: the template for our objective decomposition.
- **MAP-Elites for human-AI design** [G-31]: maintain a **quality-diversity archive** (varying wingspan, part count, silhouette IoU) for humans to browse, rather than one "optimal" output. Takeaway: gives the human meaningful, diverse choices and sidesteps single-metric overfitting.
- **Sketch2CAD** [G-32] and **BrickStARt** (MR LEGO design) [G-34]: sequential intent→operation loops and tangible MR placement validated with novices. Takeaway: humans should approve **part-level** proposals (not every tile) and optionally place/correct in AR.
- **HITL Bayesian optimization** (Chan et al., CHI 2022) [G-36]: human feedback accelerates convergence but is expensive → query sparingly (every 50–100 placements) with **pairwise preferences** (theoretically strongest, per Gao et al.). Takeaway: humans best spent on (1) encoding/confirming the target, (2) approving part decompositions, (3) occasional pairwise "which looks more like a jet" judgments to recalibrate the proxy against Goodhart drift.

---

## 3. Proposed from-scratch architecture

### 3.1 Core geometry / data model — *"correct by construction"*

**Representation: a thick-panel rigid-foldable assembly on an oriented half-edge hinge graph, serialized in FOLD [B-25].**

- **Tile (face).** A rigid planar polygon with an **edge-class** (a discrete length ∈ {L₁, L₂, …}), a polygon type (square or one of the triangles), and a **uniform thickness t**. Stored as a face in the half-edge structure. Its mid-surface is the canonical zero-thickness polygon; the physical solid is the mid-surface offset by ±t/2 (an **offset/parallel mesh**, the constant-thickness model from PQ/conical mesh theory [B-18]).
- **Edge (half-edge pair).** A magnetic edge. Two tiles join *only* when (a) edge-classes match exactly (lengths equal), and (b) the join is registered as a **twin half-edge pair** — the FOLD `edges_faces` relation. The shared hinge axis is the *mid-surface* edge line.
- **Hinge / fold angle.** Each interior edge carries a dihedral angle φ ∈ (−φ_max, +φ_max). **Crucially, φ_max is not free:** by Tachi's thick-panel model [B-20], to keep the two offset solids from interpenetrating at the hinge, the realizable fold is bounded by a δ with tan(δ/2) ∝ t/L (panel thickness over edge length). We implement this with the **axis-shift / offset-panel hinge** [B-22, B-24]: the hinge axis sits on the appropriate panel face rather than the mid-surface, so two tiles can close toward each other without their half-thickness volumes colliding. **The fold-angle bound is therefore a property of the edge-class + thickness, precomputed once per (edge-class, polygon-type) pair.**
- **Vertices.** Where k ≥ 3 tiles meet, we apply **vertex volume-trimming** [B-22] and check the **product-of-rotations = identity** rigid-foldability condition [B-14, B-19]; for degree-4 equal-opposite-sector vertices we use the closed-form uniform-thickness buildability conditions of Shimoda–Tachi [B-24]. Vertex regions that cannot be made non-interpenetrating are rejected by the move generator.
- **Magnetic polarity.** Each edge magnet carries an alternating N/S pattern; a join is valid only if mating edges present compatible polarity. This is an extra boolean filter on the twin-pairing step (a constraint *no prior system models* — flagged as novel).

**The move set (this is what makes validity correct-by-construction).** The build grows by exactly three reversible operations, and **the generator only ever emits operations whose resulting geometry is already collision-free and magnetically valid** — there is no "place then check," there is only "enumerate the legal placements":

1. **Fold-attach.** Attach a new tile to an existing free edge (matching edge-class + polarity) at a fold angle drawn from the *precomputed feasible interval* (−φ_max, φ_max) for that edge-class/thickness. Because the interval already excludes interpenetration at that hinge, the join is non-overlapping by construction.
2. **Close-seam.** When two free edges of the current shell are brought coincident by the kinematics, snap them into a twin-pair (closing a loop), *only if* the resulting dihedral is within the feasible interval and the global collision test passes. This is what turns an open net into a closed shell.
3. **Coplanar lateral extension (the wing primitive — see §4).** A *special case of fold-attach with φ ≈ 0 (dihedral ≈ 180°)*: attach a tile coplanar to a flat body facet, extending a flat panel laterally. Because φ ≈ 0 is always inside the feasible interval (thick panels never interpenetrate when they stay coplanar and edge-adjacent), wide flat panels are *always expressible and always valid*.

Global (non-adjacent) interpenetration — a wing folding back into the fuselage — is caught by the swept bisecting-plane test [B-20] / an explicit broad-phase collision check during MCTS rollout; the offending move is simply not emitted.

**Connectivity & stability, by construction + incremental check.**
- *Connectivity:* the half-edge graph is connected by definition of the move set (every new tile attaches to an existing edge). A **disassembly/removability graph** [A-10, A-11] certifies no tile is removable-into-disconnection, i.e., every tile has at least one valid magnetic neighbor.
- *Stability under gravity:* a rigid-body static-equilibrium check in the friction/contact formulation of the assembly STAR [A-7], generalized so each magnetic hinge supplies a bounded resisting moment (capacity ∝ magnet strength × edge length). We require **every prefix of the assembly order to be stable** (the FrameFab guarantee [A-9]) and the final shell to satisfy equilibrium under gravity given hinge-moment capacities. This is the model gap most worth prototyping early (magnetic hinge-moment capacity is not in the literature — flagged).

### 3.2 Target reconstruction pipeline (few images → metric occupancy + parts)

1. **Frame selection & segmentation.** Pull 5–10 well-spaced frames; **SAM2** foreground masks → silhouettes (robust on plain backgrounds) [C-1 practicalities].
2. **Pose + metric geometry.** **MASt3R** [C-16] for pose-free metric pointmaps; the known tile dimension (~the real edge length) fixes absolute scale, removing the usual scale ambiguity.
3. **Conservative occupancy.** Multi-view **visual hull** [C-1] intersected with the MASt3R point cloud → a watertight, concavity-conservative occupancy grid discretized at the tile edge-length scale. (Visual hull is preferred over NeRF/splatting because thin flat panels are depth-ambiguous from appearance [C thin-evidence].)
4. **Part decomposition.** Fit a **part graph** to the occupancy by inverse procedural modeling / guided proceduralization [F-21] using the PartNet airplane/vehicle part vocabulary [F-24] → labels {fuselage, wing-L, wing-R, tail, …} with oriented bounding proxies. This produces both the **part-grammar seed** (§3.4) and the per-part target silhouettes used by the objective.
5. **Optional refinement.** **nvdiffrast** [C-5] silhouette/photometric refinement of the proxy fit to tighten scale and orientation.
6. **Cold-start fallback.** With only 1–2 frames, seed with **TripoSR/InstantMesh** [C-13, C-14] but treat the result as a prior to be overwritten by the visual hull, never as ground truth.

### 3.3 Generator / solver (named and justified)

**Primary: learned-policy-guided MCTS over hinge moves (AlphaZero-style), with a hard validity mask.** Justified directly by Bapst et al. [D-18] (model-based MCTS + structured/graph representations beats model-free RL on physical construction) and Blocks Assemble! [D-25] (graph policies in a magnetic-block environment generalize zero-shot with curriculum).

- **State:** the current hinge graph (half-edge mesh) + the remaining target occupancy/part-graph.
- **Policy/value network:** a **graph neural network over the hinge graph** (tiles = nodes, hinges = edges), trained AlphaZero-style on self-play against simulated targets, with **curriculum** from few-tile to many-tile shapes [D-25]. The policy proposes promising fold-attach / close-seam / lateral-extension moves; the value head estimates final recognizability without full rollout.
- **Hard validity mask = the move generator of §3.1.** Only collision-free, polarity-valid, fold-angle-feasible moves are ever expanded — the non-negotiable lesson from every competitive system [D-18, D-27, A-1].
- **CP-SAT sub-solver** [D-19] for small, well-posed sub-assemblies (a single part, a vertex region): `AddNoOverlap3D`-style packing with provable optimality where ≲50 tiles makes it cheap. Decomposition by the part grammar keeps each CP-SAT call small.
- **Local refinement:** a **split-and-remerge / edge-swap** polish [A-3] guided by the stability metric, plus a **CMA-ES** [D-22] continuous tune of fold angles at the very end (its only good use — a continuous post-refinement, not the combinatorial search).
- **Quality-diversity outer loop:** wrap the search in **MAP-Elites** [G-31] with behavioral descriptors (part count, wingspan, silhouette IoU) so the system yields a *diverse archive* of valid builds for the human to choose from — and so the search does not collapse onto a single proxy-overfit solution.

Why not pure RL or pure ILP: pure RL suffers sparse-reward + reward-hacking + scale collapse [D-25 failure modes]; ILP cannot represent the non-linear perceptual objective and blows up past ~50 parts [D-20]. The hybrid gets hard-constraint guarantees from the mask/CP-SAT and a perceptual objective from the learned value.

### 3.4 Recognizability objective(s)

A **part-grammar prior biases the generator** before any score is computed: a ShapeAssembly-style program [F-26] over tile-panel proxies, seeded by the reconstructed part graph (§3.2 step 4) and the PartNet vocabulary [F-24], so the generator *starts* from "fuselage + two wings + tail," not from a boxy blob. This is the primary defense against "valid but boxy" — recognizable structure is in the prior, not just the reward.

The scalar objective is a **deliberately heterogeneous, multi-view ensemble** (heterogeneity is the anti-hacking mechanism — Gao et al. [E-17] argue for ensembles of weak proxies over one strong one):

```
R(build) = 0.35 · VoxelIoU(build, target)              # coarse structure: wings/body/tail present
         + 0.25 · min_v SilhouetteIoU_v(build, target)  # min over ≥12 views — outline fidelity
         + 0.20 · min_v CLIP_v(build, "fighter jet")     # min over views — semantic category
         + 0.10 · PartGrammarPlausibility(build)         # StructureNet/SCORES-style prior [F-23,F-25]
         + 0.10 · (1 − EMD_coverage(build, target))      # EMD, not Chamfer — resists hollow hacks [E-5]
         − λ · SparsenessPenalty(build)                  # see below
```

Anti-hacking design, each grounded:
- **min-over-views, not mean** for silhouette and CLIP — a build that looks right from one angle and is a flat sheet from another is punished by the worst view [E-1, E-14].
- **EMD coverage, never Chamfer** — Chamfer rewards a few token tiles at silhouette extremes (the exact hack #2); EMD forces full matching [E-4, E-5].
- **Voxel IoU** penalizes both missing and spurious mass, unlike recall-only scores [E-6].
- **SparsenessPenalty:** a hard floor on *connected surface coverage* of the target's exposed faces — not raw tile count (which is itself gameable by stacking). Specifically, penalize uncovered target surface area, so "a few token tiles" leaves most of the surface uncovered and scores near zero.
- **VLM critic as held-out gold** [E-15]: a periodically-queried GPT-4V-class judge that scores "does this look like a fighter jet?" is **never** in the optimized loss (so it can't be hacked); it is the gold signal used to (a) detect Goodhart drift and (b) trigger early stopping.
- **Goodhart control:** per Karwowski et al. [E-16], optimize the proxy only until the **held-out VLM gold score stops improving**, then stop (optimal early stopping); add a **χ²/KL penalty** [E-18, E-17] pulling the tile-layout distribution toward the realistic-build prior. MAP-Elites diversity [G-31] further prevents single-mode proxy overfitting.

### 3.5 Verification / acceptance contract

A build is **accepted** iff:

**Hard gate (must all pass; non-negotiable, computed exactly, never learned):**
1. *No interpenetration* — every hinge dihedral within its precomputed feasible interval [B-20], and global broad-phase collision test passes.
2. *Full magnetic connectivity* — every tile has ≥1 valid matching-edge-class, compatible-polarity neighbor; the disassembly graph confirms no tile is disconnected [A-10].
3. *Gravity stability* — static equilibrium under gravity with bounded hinge-moment capacities, and every prefix of the assembly order is stable [A-7, A-9].
4. *Edge-class legality* — all joins are length-matched.

**Soft gate (recognizability):**
5. Proxy objective R ≥ τ_proxy, **and**
6. **Held-out VLM gold critic** ≥ τ_gold (this is the gate that proxy-hacked builds fail — they clear R but not the independent critic) [E-15], **and**
7. SparsenessPenalty surface-coverage floor met.

**Output:** the accepted build plus a **stable assembly order** (FrameFab-style sequencing [A-9]) and a FOLD-format file that the Origami Simulator [B-26] can animate fold-by-fold. If the soft gate fails, return the MAP-Elites archive to the human for selection/correction rather than forcing a single answer.

---

## 4. How this design resolves the five hard problems

**Problem 1 — "Valid but boxy" (validity ≠ recognizability).** Recognizability is enforced in *two independent places*: (a) the **part-grammar prior** [F-26, F-24] makes the generator *start* from a fuselage-wings-tail decomposition rather than a blob, so the search space is already biased toward recognizable structure; and (b) the **multi-component objective + held-out VLM gold critic** [E-15] make "boxy" score low and *stay* low even after optimization. Validity (the hard gate) and recognizability (the soft gate) are separate contracts, exactly as you intuited they must be.

**Problem 2 — Gameable recognizability.** Defeated by *heterogeneity + held-out gold + Goodhart-aware stopping*: min-over-12-views silhouette/CLIP [E-1, E-14], **EMD instead of Chamfer** to kill the token-tile hack [E-4, E-5], voxel IoU's two-sided penalty [E-6], a **surface-coverage sparseness floor** (token tiles leave the surface bare → near-zero score), and crucially a **VLM critic that is never in the optimized loss** so it cannot be gamed, used to trigger **optimal early stopping** before the proxy-gold gap opens [E-16, E-17, E-18]. A handful of token tiles passes none of these.

**Problem 3 — Thickness breaks naive geometry (overlap vs. join in tension).** Resolved *at the representation level* by Tachi's thick-panel model [B-20] with **axis-shift/offset-panel hinges** [B-22, B-24]: the hinge axis is placed so the two half-thickness solids rotate without colliding, and the **maximum fold angle is a precomputed function of thickness/edge-length**. Because the move generator only ever emits folds *inside* the feasible interval, "no interpenetration" and "edges coincide enough to register a magnetic join" are **the same constraint, satisfied simultaneously by construction** — there is no free placement to put them in tension. The mid-surface edge is where the magnetic join registers; the offset solids are where collision is avoided; the offset-mesh formalism [B-18] keeps both consistent.

**Problem 4 — Wide flat wings are hard to express via edge-folding.** Solved by promoting **coplanar lateral extension (dihedral ≈ 180°) to a first-class move** (§3.1, move 3). The origami dead-end you hit — a triangle folded off a closed box corner always overlaps the adjacent face — happens because folding *toward* a closed shell runs into the feasible-angle wall. A coplanar extension off a *flat body facet* is always inside the feasible interval (coplanar thick panels never interpenetrate), so wings spread **wide and flat outward** instead of folding down. The part grammar [F-26] explicitly attaches wing parts as lateral coplanar panel-groups anchored to the fuselage's side facets, and the body cross-section is chosen by the grammar to expose flat side facets for exactly this purpose. Wide flat panels become the natural, always-valid case rather than the hard case.

**Problem 5 — Reconstructing the target from a handful of frames at correct scale.** The §3.2 pipeline: **MASt3R** for pose-free *metric* geometry [C-16] with the known tile size fixing absolute scale, intersected with a multi-view **visual hull** [C-1] for a conservative, concavity-safe occupancy — chosen over NeRF/splatting specifically because thin flat panels are depth-ambiguous from appearance [C thin-evidence] — and a part-graph fit [F-21, F-24] that doubles as the generator's grammar seed. Robust at 3–10 frames, exploits known scale directly, and degrades gracefully to a TripoSR/InstantMesh cold-start [C-13, C-14] when frames are scarce.

---

## 5. Phased build plan

**Phase 0 — Geometry kernel & validity oracle (highest leverage; do first).**
Implement the half-edge/FOLD data model [B-25], the offset-panel thick-tile geometry, the precomputed per-edge-class feasible-fold-angle intervals [B-20, B-24], the three-move generator, polarity filter, broad-phase collision, connectivity (disassembly graph [A-10]), and a stability check [A-7]. Deliverable: a function `legal_moves(state)` that *provably* emits only valid builds, and a `verify(build)` hard gate. This is the foundation everything else stands on.

**Phase 1 — Target reconstruction.** SAM2 + visual hull + MASt3R + part-graph fit [C-1, C-16, F-21]. Deliverable: video/photos → metric occupancy grid + labeled part proxies. Validate on a few hand-built reference jets you photograph yourself.

**Phase 2 — Baseline solver.** CP-SAT on single parts [D-19] + greedy/beam fold-attach with the Phase-0 mask, scored by voxel IoU + silhouette IoU. Deliverable: end-to-end "photos → a valid, roughly-matching build" with no learning. Establishes whether the geometry model is expressive enough *before* investing in training.

**Phase 3 — Recognizability objective + part-grammar prior.** Implement the full ensemble objective, the ShapeAssembly-style tile grammar [F-26] seeded from Phase-1 parts, EMD coverage [E-5], min-over-views CLIP/silhouette, and the held-out VLM critic [E-15]. Deliverable: measurable recognizability with Goodhart-drift detection.

**Phase 4 — Learned-policy MCTS.** Train the GNN policy/value AlphaZero-style with curriculum [D-18, D-25], wrap in MAP-Elites [G-31], add CMA-ES fold-angle polish [D-22]. Deliverable: fast, high-quality, *diverse* builds at 50+ tiles.

**Phase 5 — Human-in-the-loop.** Part-level approval UI, MAP-Elites archive browser, optional pairwise-preference recalibration of the proxy [G-36], optional AR placement à la BrickStARt [G-34]. Deliverable: mixed-initiative tool.

---

## 6. Biggest risks / unknowns (honest)

1. **Magnetic hinge-moment capacity is not in the literature.** The whole stability model rests on how much moment a magnetic edge join can resist before tiles peel apart. This needs *empirical measurement* on real tiles, not citation. **Highest-risk unknown.**
2. **Multi-vertex thick-panel assemblies with a discrete tile vocabulary are under-theorized** [B thin-evidence]. The single-vertex thick-origami results [B-20, B-21, B-24] are solid; the vertex region where 3+ thick tiles meet at arbitrary angles may need bespoke volume-trimming per configuration, and some configurations may simply be unbuildable. Risk that the expressible shape space is narrower than hoped.
3. **No prior system matches Magna-Tiles exactly** [A thin-evidence] — polygon vocabulary + arbitrary dihedral + magnetic polarity is a genuine gap. We are integrating components that have never been combined, so integration risk is real (the F-area note: tile-grammar + differentiable silhouette + CLIP has never shipped as one system [F thin-evidence]).
4. **Thin-panel reconstruction is intrinsically depth-ambiguous** [C thin-evidence]. The visual-hull fallback mitigates this, but builds dominated by thin features at oblique angles may reconstruct poorly; known scale helps but doesn't fully resolve it.
5. **Reward hacking is a moving target.** The ensemble + held-out critic + early stopping is the best-known defense [E-16, E-17, E-18], but Goodhart's law guarantees *some* exploitable gap exists; expect to iterate the objective as the optimizer finds new holes. Budget for adversarial red-teaming of the score.
6. **Solver scale.** MCTS+GNN is the right bet [D-18, D-25] but past ~50–100 tiles training cost and search depth balloon; the part-grammar decomposition is the main mitigation (small per-part sub-problems), and it must carry a lot of weight.
7. **Expressiveness of the coplanar-extension move.** It cleanly handles flat wings, but compound-curved or highly swept wing surfaces may need chained small folds that re-approach the thickness wall — the wide-flat-wing solution may not generalize to all aircraft silhouettes.

---

## 7. References

**Areas A & B (construction synthesis; hinged/folded-plate)**
- [A-1] Kim et al., *Brick-by-Brick: Combinatorial Construction with Deep Reinforcement Learning*, NeurIPS 2021 — https://proceedings.neurips.cc/paper_files/paper/2021/hash/2d4027d6df9c0256b8d4474ce88f8c88-Abstract.html
- [A-2] Testuz, Schwartzburg, Pauly, *Automatic Generation of Constructable Brick Sculptures*, Eurographics 2013 — https://diglib.eg.org/items/82e2ee53-fa57-4929-ac81-85acd0d9f855
- [A-3] Luo et al., *Legolization: Optimizing LEGO Designs*, SIGGRAPH Asia 2015 — https://dl.acm.org/doi/10.1145/2816795.2818091
- [A-4] Kim, *Survey on Automated LEGO Assembly Construction*, ETRI — https://dspace.zcu.cz/bitstream/11025/11949/1/Kim.pdf
- [A-5] Ahn et al., *Budget-Aware Sequential Brick Assembly with Efficient Constraint Satisfaction*, TMLR 2024 — https://arxiv.org/abs/2210.01021
- [A-6] Pun et al., *LegoGPT: Generating Physically Stable and Buildable LEGO Designs from Text*, 2025 — https://arxiv.org/html/2505.05469v1
- [A-7] Wang, Song, Pauly, *State of the Art on Computational Design of Assemblies with Rigid Parts*, Eurographics 2021 — https://sutd-cgl.github.io/supp/Publication/papers/2021-EG-AssemblySurvey.pdf
- [A-8] Song et al., *CofiFab: Coarse-to-Fine Fabrication of Large 3D Objects*, SIGGRAPH 2016 — https://dl.acm.org/doi/10.1145/2897824.2925876
- [A-9] Huang et al., *FrameFab: Robotic Fabrication of Frame Shapes*, SIGGRAPH Asia 2016 — https://dl.acm.org/doi/10.1145/2980179.2982401
- [A-10] Chen et al., *Computational Design of High-Level Interlocking Puzzles*, SIGGRAPH 2022 — https://dl.acm.org/doi/10.1145/3528223.3530071
- [A-11] Song, Fu, Cohen-Or, *Recursive Interlocking Puzzles*, SIGGRAPH Asia 2012 — https://dl.acm.org/doi/10.1145/2366145.2366147
- [A-12] Coros et al., *Computational Design of Mechanical Characters*, SIGGRAPH 2013 — https://dl.acm.org/doi/10.1145/2461912.2461953
- [B-13] Demaine, Tachi, *Origamizer: A Practical Algorithm for Folding Any Polyhedron*, SoCG 2017 — https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.SoCG.2017.34
- [B-14] Tachi, *Freeform Variations of Origami*, 5OSME 2010 — https://tsg.ne.jp/TT/cg/TachiFreeformOrigami2010.pdf
- [B-15] Demaine, O'Rourke, *Geometric Folding Algorithms: Linkages, Origami, Polyhedra*, Cambridge UP 2007 — https://www.gfalop.org
- [B-16] Demaine, O'Rourke, *A Survey of Folding and Unfolding in Computational Geometry*, MSRI 2005 — https://library.slmath.org/books/Book52/files/12dem.pdf
- [B-17] Eigensatz et al., *Paneling Architectural Freeform Surfaces*, SIGGRAPH 2010 — https://dl.acm.org/doi/10.1145/1778765.1778782
- [B-18] Pottmann et al., *Architectural Geometry*, Computers & Graphics 2015 — https://dl.acm.org/doi/10.1016/j.cag.2014.11.002
- [B-19] Tachi, *Freeform Rigid-Foldable Structure using Bidirectionally Flat-Foldable Planar Quadrilateral Mesh*, AAG 2010 — https://origami.c.u-tokyo.ac.jp/~tachi/cg/BDFFPQMeshTachiAAG2010.pdf
- [B-20] Tachi, *Rigid-Foldable Thick Origami*, 5OSME 2010 — https://origami.c.u-tokyo.ac.jp/~tachi/cg/ThickRigidOrigami_tachi_5OSME.pdf
- [B-21] Chen, Peng, You, *Origami of Thick Panels*, Science 349(6246):396–400, 2015 — https://www.science.org/doi/abs/10.1126/science.aab2870
- [B-22] Lang et al., *A Review of Thickness-Accommodation Techniques in Origami-Inspired Engineering*, Applied Mechanics Reviews 70(1), 2018 — https://asmedigitalcollection.asme.org/appliedmechanicsreviews/article/70/1/010805/443701/
- [B-23] Ku, Demaine, *Folding Flat Crease Patterns with Thick Materials*, J. Mechanisms and Robotics 8(3), 2016 — https://erikdemaine.org/papers/ThickFolding_JMR/paper.pdf
- [B-24] Shimoda, Tachi, Sato, *Flat-Foldable Rigid Origami with Uniform-Thickness Panels*, AAG 2020 — https://thinkshell.fr/wp-content/uploads/2019/10/AAG2020_08_Shimoda.pdf
- [B-25] Demaine, Ku, Lang, *FOLD: Flexible Origami List Datastructure*, 2016+ — https://github.com/edemaine/fold
- [B-26] Ghassaei, Demaine, Gershenfeld, *Fast, Interactive Origami Simulation using GPU Computation*, 7OSME 2018 — https://erikdemaine.org/papers/OrigamiSimulator_Origami7/ (tool: https://origamisimulator.org)
- [B-27] Zhang, Paik, *Kirigami Design and Modeling for Strong, Lightweight Metamaterials*, Adv. Functional Materials 2022 — https://advanceseng.com/kirigami-design-modeling-strong-lightweight-metamaterials/

**Area C (shape-from-images)**
- [C-1] Laurentini, *The Visual Hull Concept for Silhouette-Based Image Understanding*, IEEE TPAMI 1994 — https://homepages.inf.ed.ac.uk/rbf/CVonline/LOCAL_COPIES/AV0809/schneider.pdf
- [C-2] Kutulakos, Seitz, *A Theory of Shape by Space Carving*, IJCV 2000 — https://www.cs.toronto.edu/~kyros/pubs/00.ijcv.carve.pdf
- [C-3] Kato, Ushiku, Harada, *Neural 3D Mesh Renderer*, CVPR 2018 — https://arxiv.org/abs/1711.07566
- [C-4] Liu et al., *Soft Rasterizer*, ICCV 2019 — https://arxiv.org/abs/1904.01786
- [C-5] Laine et al., *Modular Primitives for High-Performance Differentiable Rendering (nvdiffrast)*, SIGGRAPH Asia 2020 — https://arxiv.org/abs/2011.03277
- [C-6] Ravi et al., *Accelerating 3D Deep Learning with PyTorch3D*, 2020 — https://arxiv.org/abs/2007.08501
- [C-7] Kato et al., *Differentiable Rendering: A Survey*, 2020 — https://arxiv.org/abs/2006.12057
- [C-8] Yu et al., *pixelNeRF: Neural Radiance Fields from One or Few Images*, CVPR 2021 — https://arxiv.org/abs/2012.02190
- [C-9] Zhou, Tulsiani, *SparseFusion*, CVPR 2023 — https://arxiv.org/abs/2212.10047
- [C-10] Liu et al., *Zero-1-to-3: Zero-shot One Image to 3D Object*, ICCV 2023 — https://arxiv.org/abs/2303.11328
- [C-11] Liu et al., *One-2-3-45*, NeurIPS 2023 — https://arxiv.org/abs/2306.16928
- [C-12] Hong et al., *LRM: Large Reconstruction Model for Single Image to 3D*, ICLR 2024 — https://arxiv.org/abs/2311.04400
- [C-13] Tochilkin et al., *TripoSR*, 2024 — https://arxiv.org/abs/2403.02151
- [C-14] Xu et al., *InstantMesh*, 2024 — https://arxiv.org/abs/2404.07191
- [C-15] Wang et al., *DUSt3R: Geometric 3D Vision Made Easy*, CVPR 2024 — https://github.com/naver/dust3r
- [C-16] Leroy, Cabon, Revaud, *Grounding Image Matching in 3D with MASt3R*, 2024 — https://arxiv.org/abs/2406.09756
- [C-17] Wang et al., *SparseNeRF: Distilling Depth Ranking for Few-shot Novel View Synthesis*, ICCV 2023 — https://sparsenerf.github.io

**Area D (solvers)**
- [D-18] Bapst et al., *Structured Agents for Physical Construction*, ICML 2019 — https://arxiv.org/abs/1904.03177
- [D-19] Google OR-Tools, *CP-SAT Solver* — https://developers.google.com/optimization/cp/cp_solver
- [D-20] Kollsker, *Mathematical Models and Algorithms for Optimisation of the LEGO Construction Problem*, PhD thesis DTU 2021 — https://backend.orbit.dtu.dk/ws/portalfiles/portal/236623063/PhD_Thesis_Torkil_Kollsker.pdf
- [D-21] Luo et al., *Legolization* (see [A-3]) — https://dl.acm.org/doi/10.1145/2816795.2818091
- [D-22] Hansen, *The CMA Evolution Strategy: A Tutorial*, 2016/2023 — https://arxiv.org/pdf/1604.00772
- [D-23] Noguchi, Yamada, *CMA-ES-based Structural Topology Optimization Using a Level Set*, CMAME 2018 — https://www.sciencedirect.com/science/article/abs/pii/S0045782518300112
- [D-24] Chung et al., *Brick-by-Brick* (see [A-1]) — https://papers.nips.cc/paper_files/paper/2021/file/2d4027d6df9c0256b8d4474ce88f8c88-Paper.pdf
- [D-25] Ghasemipour et al., *Blocks Assemble! Learning to Assemble with Large-Scale Structured Reinforcement Learning*, ICML 2022 — https://arxiv.org/abs/2203.13733
- [D-26] Kim et al., *Combinatorial 3D Shape Generation via Sequential Assembly*, NeurIPS ML4Eng 2020 — https://ml4eng.github.io/camera_readys/26.pdf
- [D-27] Ahn et al., *Budget-Aware Sequential Brick Assembly* (see [A-5]) — https://arxiv.org/abs/2210.01021

**Area E (recognizability objectives)**
- [E-1] Liu et al., *Soft Rasterizer*, ICCV 2019 — https://arxiv.org/abs/1904.01786
- [E-2] Garifullin, Maiorov, Frolov, *Differentiable Procedural Models for Single-View 3D Mesh Reconstruction*, GraphiCon 2023 — https://www.graphicon.ru/html/2023/papers/paper_001.pdf
- [E-3] Han et al., *DRWR: A Differentiable Renderer without Rendering*, ICML 2020 — https://arxiv.org/abs/2007.06127
- [E-4] Fan, Su, Guibas, *A Point Set Generation Network for 3D Object Reconstruction from a Single Image*, CVPR 2017 — https://arxiv.org/abs/1612.00603
- [E-5] Sinha, Fleuret, *DeepEMD: Fast Estimation of the Earth Mover's Distance*, 2023 — https://arxiv.org/abs/2311.09998
- [E-6] Sun et al., *Pix3D: Dataset and Methods for Single-Image 3D Shape Modeling*, CVPR 2018 — https://openaccess.thecvf.com/content_cvpr_2018/papers/Sun_Pix3D_Dataset_and_CVPR_2018_paper.pdf
- [E-7] Zhang et al., *The Unreasonable Effectiveness of Deep Features as a Perceptual Metric (LPIPS)*, CVPR 2018 — https://arxiv.org/abs/1801.03924
- [E-8] Kettunen, Härkönen, Lehtinen, *E-LPIPS: Robust Perceptual Image Similarity via Random Transformation Ensembles*, 2019 — https://arxiv.org/abs/1906.03973
- [E-9] Ghazanfari et al., *R-LPIPS: An Adversarially Robust Perceptual Similarity Metric*, 2023 — https://arxiv.org/abs/2307.15157
- [E-10] Ghildyal, Liu, *Attacking Perceptual Similarity Metrics*, 2023 — https://arxiv.org/abs/2305.08840
- [E-11] Jain et al., *Zero-Shot Text-Guided Object Generation with Dream Fields*, CVPR 2022 — https://arxiv.org/abs/2112.01455
- [E-12] Sanghi et al., *CLIP-Forge: Towards Zero-Shot Text-to-Shape Generation*, CVPR 2022 — https://arxiv.org/abs/2110.02624
- [E-13] Michel et al., *Text2Mesh: Text-Driven Neural Stylization for Meshes*, CVPR 2022 — https://arxiv.org/abs/2112.03221
- [E-14] Lee, Chang, *Understanding Pure CLIP Guidance for Voxel Grid NeRF Models*, 2022 — https://arxiv.org/abs/2209.15172
- [E-15] Wang et al., *RL-VLM-F: Reinforcement Learning from Vision Language Foundation Model Feedback*, ICML 2024 — https://liralab.usc.edu/pdfs/publications/wang2024rlvlmf.pdf
- [E-16] Karwowski et al., *Goodhart's Law in Reinforcement Learning*, NeurIPS 2023 — https://arxiv.org/abs/2310.09144
- [E-17] Gao, Schulman, Hilton, *Scaling Laws for Reward Model Overoptimization*, 2022 — https://arxiv.org/abs/2210.10760
- [E-18] Laidlaw, Singhal, Dragan, *Correlated Proxies: A New Definition and Improved Mitigation for Reward Hacking*, 2024 — https://arxiv.org/abs/2403.03185

**Area F (grammars / part-based / program synthesis)**
- [F-19] Stiny, *Introduction to Shape and Shape Grammars*, Environment and Planning B 7, 1980 — https://journals.sagepub.com/doi/10.1068/b070343
- [F-20] Mueller et al., *Procedural Modeling of Buildings*, SIGGRAPH 2006 — https://dl.acm.org/doi/10.1145/1141911.1141931
- [F-21] Demir, Aliaga, *Guided Proceduralization*, Computers & Graphics 2018 — https://arxiv.org/abs/1807.02578
- [F-22] Li et al., *GRASS: Generative Recursive Autoencoders for Shape Structures*, SIGGRAPH 2017 — https://arxiv.org/abs/1705.02090
- [F-23] Mo et al., *StructureNet: Hierarchical Graph Networks for 3D Shape Generation*, SIGGRAPH Asia 2019 — https://arxiv.org/abs/1908.00575
- [F-24] Mo et al., *PartNet: A Large-scale Benchmark for Fine-grained and Hierarchical Part-level 3D Object Understanding*, CVPR 2019 — https://arxiv.org/abs/1812.02713
- [F-25] Zhu et al., *SCORES: Shape Composition with Recursive Substructure Priors*, SIGGRAPH Asia 2018 — https://arxiv.org/abs/1809.05398
- [F-26] Jones et al., *ShapeAssembly: Learning to Generate Programs for 3D Shape Structure Synthesis*, SIGGRAPH Asia 2020 — https://arxiv.org/abs/2009.08026
- [F-27] Sharma et al., *CSGNet: Neural Shape Parser for Constructive Solid Geometry*, CVPR 2018 — https://arxiv.org/abs/1712.08290
- [F-28] Ellis et al., *Learning to Infer Graphics Programs from Hand-Drawn Images*, NeurIPS 2018 — https://arxiv.org/abs/1707.09627
- [F-29] Jones et al., *ShapeCoder: Discovering Abstractions for Visual Programs from Unstructured Primitives*, SIGGRAPH 2023 — https://arxiv.org/abs/2305.05661
- [F-30] Wu et al., *SAGNet: Structure-aware Generative Network for 3D-Shape Modeling*, SIGGRAPH 2019 — https://arxiv.org/abs/1808.03981

**Area G (mixed-initiative / human-in-the-loop)**
- [G-31] Walton et al., *Does MAP-Elites Illuminate Search Spaces? A Large-scale User Study of MAP-Elites Applied to Human-AI Collaborative Design*, 2024 — https://arxiv.org/abs/2402.07911
- [G-32] Li et al., *Sketch2CAD: Sequential CAD Modeling by Sketching in Context*, SIGGRAPH Asia 2020 — https://arxiv.org/abs/2009.04927
- [G-33] Xu, Hui, Fu, Zhang, *Computational LEGO Technic Design*, SIGGRAPH Asia 2020 — https://arxiv.org/abs/2007.02245
- [G-34] Schikorr et al., *BrickStARt: Enabling In-situ Design and Tangible Exploration for Personal Fabrication using Mixed Reality*, ACM IMWUT 2023 — https://dl.acm.org/doi/pdf/10.1145/3626465
- [G-35] Margarido et al., *Boosting Mixed-Initiative Co-Creativity in Game Design: A Tutorial*, 2024 — https://arxiv.org/abs/2401.05999
- [G-36] Chan et al., *Investigating Positive and Negative Qualities of Human-in-the-Loop Optimization for Designing Interaction Techniques*, CHI 2022 — https://arxiv.org/abs/2204.07641
- [G-37] Lin et al., *Beyond Prompts: Exploring the Design Space of Mixed-Initiative Co-Creativity Systems*, 2023 — https://arxiv.org/abs/2305.07465
- [G-38] Liao et al., *Continual Human-in-the-Loop Optimization*, CHI 2025 — https://arxiv.org/html/2503.05405v1
- [G-39] Lienhard et al., *Design Transformations for Rule-based Procedural Modeling*, Computer Graphics Forum 2017 — https://onlinelibrary.wiley.com/doi/10.1111/cgf.13105

---

*Evidence is strongest for: LEGO-analogous sequential assembly with hard validity masks (A, D), thick-panel origami geometry (B), few-view metric reconstruction (C), and the theory of reward-hacking resistance (E). Evidence is thinnest — and the principal research risk — for: a polygon-tile vocabulary with arbitrary dihedral angles and magnetic polarity (no prior system), multi-vertex thick-panel buildability, magnetic hinge-moment stability, and the unified grammar+silhouette+CLIP pipeline (never shipped as one system).*
