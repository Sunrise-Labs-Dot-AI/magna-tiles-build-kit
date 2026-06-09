# Tile Measurements V2

Photos are treated as ground truth. Each image uses the four black 10 mm fiducials at sheet-mm centers A=(10,65), B=(205,65), C=(10,255), D=(205,255) to compute a pixel-to-mm homography before measuring red tile polygons and dark embedded magnet bars.

This run used the local `sharp` image pipeline because `opencv` and `numpy` are unavailable in the sandbox. Corner detection uses red-mask convex hull reduction plus fitted edge-line intersections; measurements below are averaged across all photos of the same shape.

## Calibration Sanity

| Image | Shape | Fiducial scale px/mm | Homography residual mm |
|---|---|---:|---:|
| IMG_8230.JPG | small square | 12.56 | 0.0000 |
| IMG_8231.JPG | small square | 12.93 | 0.0000 |
| IMG_8232.JPG | equilateral triangle | 12.46 | 0.0000 |
| IMG_8233.JPG | equilateral triangle | 12.18 | 0.0000 |
| IMG_8234.JPG | right triangle | 13.13 | 0.0000 |
| IMG_8235.JPG | right triangle | 10.89 | 0.0000 |
| IMG_8236.JPG | isosceles triangle | 11.03 | 0.0000 |
| IMG_8237.JPG | isosceles triangle | 12.20 | 0.0000 |
| IMG_8240.JPG | isosceles triangle | 11.64 | 0.0000 |
| IMG_8241.JPG | isosceles triangle | 11.32 | 0.0000 |
| IMG_8238.JPG | large square | 11.54 | 0.0000 |
| IMG_8239.JPG | large square | 11.43 | 0.0000 |

## Isosceles Triangle

| Image | Base mm | Equal side A mm | Equal side B mm | Apex angle deg | Base angles deg |
|---|---:|---:|---:|---:|---|
| IMG_8236.JPG | 84.5 | 140.7 | 145.7 | 34.3 | 69.6, 76.1 |
| IMG_8237.JPG | 84.4 | 146.4 | 147.9 | 33.3 | 72.4, 74.3 |
| IMG_8240.JPG | 79.1 | 143.4 | 145.1 | 31.8 | 72.9, 75.3 |
| IMG_8241.JPG | 79.9 | 147.0 | 147.8 | 31.4 | 73.7, 74.8 |

Average base: **82.0 mm** (range 79.1-84.5, sd 2.47).
Average equal sides: **144.3 mm** and **146.6 mm** (combined range 140.7-147.9, sd 2.28).
Average angles: apex **32.7 deg**, base angles **72.2 deg** and **75.1 deg**.

Snap verdict: base snaps to **76.2 mm / 3 in** even though the translucent outer contour measures about 82 mm. Equal sides measure **about 145 mm**, materially shorter than 152.4 mm / 6 in.

Magnet layout by detected edge:

| Edge | Avg edge mm | Consolidated count | Consolidated centers fraction | Consolidated mm from nearest corner | Raw detector centers |
|---|---:|---:|---|---|---|
| base | 82.0 | 2 | 0.20, 0.80 | 16.4 mm, 16.4 mm | IMG_8236.JPG: f=0.199 / 16.8mm, f=0.677 / 27.3mm<br>IMG_8237.JPG: f=0.505 / 41.8mm<br>IMG_8240.JPG: none<br>IMG_8241.JPG: f=0.505 / 39.5mm |
| equal side A | 144.3 | 3 | 0.16, 0.50, 0.84 | 23.1 mm, 72.2 mm, 23.1 mm | IMG_8236.JPG: f=0.142 / 20.0mm, f=0.416 / 58.6mm, f=0.716 / 40.0mm<br>IMG_8237.JPG: f=0.305 / 44.6mm, f=0.568 / 63.3mm, f=0.867 / 19.5mm<br>IMG_8240.JPG: f=0.832 / 24.1mm<br>IMG_8241.JPG: f=0.123 / 18.0mm, f=0.682 / 46.7mm |
| equal side B | 146.6 | 3 | 0.16, 0.50, 0.84 | 23.5 mm, 73.3 mm, 23.5 mm | IMG_8236.JPG: f=0.223 / 32.5mm, f=0.601 / 58.2mm, f=0.884 / 17.0mm<br>IMG_8237.JPG: f=0.123 / 18.2mm, f=0.422 / 62.3mm, f=0.713 / 42.5mm<br>IMG_8240.JPG: f=0.270 / 39.2mm, f=0.757 / 35.3mm<br>IMG_8241.JPG: f=0.304 / 44.9mm, f=0.579 / 62.2mm, f=0.888 / 16.5mm |

## Big Squares

| Image | Edge 1 mm | Edge 2 mm | Edge 3 mm | Edge 4 mm | Image avg edge mm |
|---|---:|---:|---:|---:|---:|
| IMG_8238.JPG | 155.1 | 151.2 | 156.0 | 150.5 | 153.2 |
| IMG_8239.JPG | 153.2 | 149.2 | 153.5 | 149.6 | 151.4 |

Determination: the two big-square photos are the **same size within measurement noise**. IMG_8238.JPG averages **153.2 mm** per edge and IMG_8239.JPG averages **151.4 mm** per edge (difference 1.8 mm), consistent with large 6 in / 152.4 mm squares rather than an XL square.

Magnet layout by detected edge:

| Edge | Avg edge mm | Consolidated count | Consolidated centers fraction | Consolidated mm from nearest corner | Raw detector centers |
|---|---:|---:|---|---|---|
| edge 1 | 154.1 | 4 | 0.13, 0.38, 0.62, 0.87 | 20.0 mm, 58.6 mm, 58.6 mm, 20.0 mm | IMG_8238.JPG: f=0.106 / 16.4mm, f=0.375 / 58.1mm, f=0.615 / 59.7mm, f=0.820 / 27.9mm<br>IMG_8239.JPG: f=0.130 / 19.8mm, f=0.485 / 74.3mm, f=0.773 / 34.8mm |
| edge 2 | 150.2 | 4 | 0.13, 0.38, 0.62, 0.87 | 19.5 mm, 57.1 mm, 57.1 mm, 19.5 mm | IMG_8238.JPG: f=0.096 / 14.4mm, f=0.363 / 54.8mm, f=0.569 / 65.1mm, f=0.857 / 21.6mm<br>IMG_8239.JPG: f=0.123 / 18.4mm, f=0.364 / 54.3mm, f=0.615 / 57.5mm, f=0.862 / 20.6mm |
| edge 3 | 154.7 | 4 | 0.13, 0.38, 0.62, 0.87 | 20.1 mm, 58.8 mm, 58.8 mm, 20.1 mm | IMG_8238.JPG: f=0.158 / 24.6mm, f=0.496 / 77.4mm, f=0.865 / 21.0mm<br>IMG_8239.JPG: f=0.153 / 23.5mm, f=0.425 / 65.3mm, f=0.636 / 55.8mm, f=0.910 / 13.8mm |
| edge 4 | 150.1 | 4 | 0.13, 0.38, 0.62, 0.87 | 19.5 mm, 57.0 mm, 57.0 mm, 19.5 mm | IMG_8238.JPG: f=0.147 / 22.2mm, f=0.385 / 58.0mm, f=0.634 / 55.0mm, f=0.873 / 19.1mm<br>IMG_8239.JPG: f=0.138 / 20.6mm, f=0.375 / 56.1mm, f=0.625 / 56.1mm, f=0.884 / 17.4mm |

## Small Square

| Image | Side 1 mm | Side 2 mm | Side 3 mm | Side 4 mm | Angles deg |
|---|---:|---:|---:|---:|---|
| IMG_8230.JPG | 82.5 | 74.9 | 81.6 | 78.3 | 88.0, 91.4, 91.0, 89.7 |
| IMG_8231.JPG | 81.7 | 75.2 | 81.5 | 75.7 | 89.6, 90.2, 90.1, 90.0 |

Average side across photos: **78.9 mm** (range 74.9-82.5).

Magnet layout by detected edge:

| Edge | Avg edge mm | Consolidated count | Consolidated centers fraction | Consolidated mm from nearest corner | Raw detector centers |
|---|---:|---:|---|---|---|
| edge 1 | 82.1 | 2 | 0.20, 0.80 | 16.4 mm, 16.4 mm | IMG_8230.JPG: f=0.231 / 19.1mm, f=0.783 / 17.9mm<br>IMG_8231.JPG: none |
| edge 2 | 75.1 | 2 | 0.20, 0.80 | 15.0 mm, 15.0 mm | IMG_8230.JPG: f=0.199 / 14.9mm, f=0.787 / 16.0mm<br>IMG_8231.JPG: f=0.202 / 15.2mm, f=0.767 / 17.5mm |
| edge 3 | 81.6 | 2 | 0.20, 0.80 | 16.3 mm, 16.3 mm | IMG_8230.JPG: f=0.186 / 15.2mm, f=0.778 / 18.1mm<br>IMG_8231.JPG: none |
| edge 4 | 77.0 | 2 | 0.20, 0.80 | 15.4 mm, 15.4 mm | IMG_8230.JPG: f=0.242 / 19.0mm, f=0.737 / 20.6mm<br>IMG_8231.JPG: none |

## Equilateral Triangle

| Image | Side 1 mm | Side 2 mm | Side 3 mm | Side 4 mm | Angles deg |
|---|---:|---:|---:|---:|---|
| IMG_8232.JPG | 79.9 | 75.8 | 79.1 |  | 56.9, 61.0, 62.0 |
| IMG_8233.JPG | 79.4 | 75.5 | 75.7 |  | 58.2, 58.4, 63.4 |

Average side across photos: **77.6 mm** (range 75.5-79.9).

Magnet layout by detected edge:

| Edge | Avg edge mm | Consolidated count | Consolidated centers fraction | Consolidated mm from nearest corner | Raw detector centers |
|---|---:|---:|---|---|---|
| edge 1 | 79.7 | 2 | 0.20, 0.80 | 15.9 mm, 15.9 mm | IMG_8232.JPG: none<br>IMG_8233.JPG: none |
| edge 2 | 75.6 | 2 | 0.20, 0.80 | 15.1 mm, 15.1 mm | IMG_8232.JPG: f=0.234 / 17.7mm, f=0.800 / 15.2mm<br>IMG_8233.JPG: f=0.224 / 16.9mm, f=0.817 / 13.8mm |
| edge 3 | 77.4 | 2 | 0.20, 0.80 | 15.5 mm, 15.5 mm | IMG_8232.JPG: none<br>IMG_8233.JPG: none |

## Right Triangle

| Image | Side 1 mm | Side 2 mm | Side 3 mm | Side 4 mm | Angles deg |
|---|---:|---:|---:|---:|---|
| IMG_8234.JPG | 105.7 | 73.9 | 75.7 |  | 44.4, 45.8, 89.8 |
| IMG_8235.JPG | 83.5 | 112.6 | 76.2 |  | 89.5, 42.6, 47.9 |

Average side across photos: **87.9 mm** (range 73.9-112.6).

Magnet layout by detected edge:

| Edge | Avg edge mm | Consolidated count | Consolidated centers fraction | Consolidated mm from nearest corner | Raw detector centers |
|---|---:|---:|---|---|---|
| short leg | 75.1 | 2 | 0.20, 0.80 | 15.0 mm, 15.0 mm | IMG_8234.JPG: f=0.549 / 33.3mm<br>IMG_8235.JPG: f=0.251 / 19.2mm, f=0.760 / 18.3mm |
| other leg | 79.6 | 2 | 0.20, 0.80 | 15.9 mm, 15.9 mm | IMG_8234.JPG: none<br>IMG_8235.JPG: f=0.217 / 18.1mm, f=0.728 / 22.7mm |
| hypotenuse | 109.1 | 3 | 0.18, 0.50, 0.82 | 19.6 mm, 54.6 mm, 19.6 mm | IMG_8234.JPG: none<br>IMG_8235.JPG: f=0.273 / 30.7mm, f=0.781 / 24.7mm |

## Consolidated Magnet Rule

| Edge class | Samples | Avg edge mm | Magnets per edge | Center rule |
|---|---:|---:|---:|---|
| short 76 mm edge | 22 | 78.8 | 2 | m1: f=0.20, nearest 15.8 mm; m2: f=0.80, nearest 15.8 mm |
| right-triangle hypotenuse 108 mm edge | 2 | 109.1 | 3 | m1: f=0.18, nearest 19.6 mm; m2: f=0.50, nearest 54.6 mm; m3: f=0.82, nearest 19.6 mm |
| isosceles long 145 mm edge | 8 | 145.5 | 3 | m1: f=0.16, nearest 23.3 mm; m2: f=0.50, nearest 72.7 mm; m3: f=0.84, nearest 23.3 mm |
| large 152 mm square edge | 8 | 152.3 | 4 | m1: f=0.13, nearest 19.8 mm; m2: f=0.38, nearest 57.9 mm; m3: f=0.62, nearest 57.9 mm; m4: f=0.87, nearest 19.8 mm |

Interpretation: short 76 mm edges carry two magnets near the corners. The right-triangle hypotenuse and the isosceles long sides carry three magnets. The 152 mm square edges carry four magnets: two near the corners and two interior bars.

## Debug Overlays

Overlay color key: green fiducials, cyan detected tile edges, orange/cyan vertices, magenta detected magnet bar spans, yellow magnet centers. Files are in `docs/research/measure-debug-v2/`.

- `IMG_8230.png` (small square)
- `IMG_8231.png` (small square)
- `IMG_8232.png` (equilateral triangle)
- `IMG_8233.png` (equilateral triangle)
- `IMG_8234.png` (right triangle)
- `IMG_8235.png` (right triangle)
- `IMG_8236.png` (isosceles triangle)
- `IMG_8237.png` (isosceles triangle)
- `IMG_8240.png` (isosceles triangle)
- `IMG_8241.png` (isosceles triangle)
- `IMG_8238.png` (large square)
- `IMG_8239.png` (large square)
