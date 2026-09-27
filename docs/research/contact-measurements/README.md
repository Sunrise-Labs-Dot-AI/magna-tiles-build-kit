# Reviewed contact measurements — 26 September 2026

These are independent **fit/calibration photos**, not reserved source-video checks. The original photo hashes, four printed marker centers, manually reviewed straight portions of the plastic edge, and two independent printed distances are saved in `annotations.json`. Run `scripts/reference/measure-contact-photos.py` with both original JPG paths to reproduce the results and annotated overlays. Yellow shows the sampled plastic edge; cyan shows its extrapolated straight-line intersection; green marks calibration and independent checks.

The 100 mm and 50 mm checks are within 0.2 mm of their printed values in both images. Unlike the old four-point homography residual, these are points excluded from the calibration fit. They check printed-plane geometry, not printer scale against a physical ruler, camera lens distortion or parallax from the raised plastic surface.

| Photo | Shape | Straight-line dimensions |
|---|---|---|
| IMG_8230 | Small square | 77.42, 76.14, 77.37, 76.68 mm |
| IMG_8240 | Isosceles | 77.86 mm base; 148.33 and 147.35 mm extrapolated sides |

The isosceles has a rounded tip. Its extrapolated corner lies beyond the actual plastic: those straight-line side lengths are **not** a measured sharp-tipped tile of that size. The previous outline and these reviewed lines also differ by several pixels, and the two sides disagree by about 1 mm. Two-pixel endpoint uncertainty, plastic height and rounding remain material. These measurements do not justify changing the catalog's 143 mm side to six inches. They also do not establish that 143 mm is a precise ideal polygon measurement. The catalog remains unchanged pending additional independent photos and an explicit rounded-outline model.

The former detector's square outline overshot the actual right-hand plastic edge. Its published magnet positions were template fractions, not reliable independent measurements of every metal bar. Neither old nor new edge lengths establish magnetic strength or contact locations.

The 25–33 second construction sequence is separately recorded as fitting evidence in the evidence ledger. It shows the high deck square placed before the lower square, and the launch assembled with its final back panel flat on the table and final roof upright. The launch then rotates before joining the wedge. That supports the corrected construction pose and order; it does not verify the final rotation or the complete source replica.
