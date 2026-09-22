# Contributing

## An active experiment

Development has resumed from the initial public archive. See [STATUS.md](STATUS.md) and [docs/design-lab.md](docs/design-lab.md) for the current implementation and limitations.

Changes should include evidence for their physical or functional claims. Keep failed candidates visible, preserve inventory and overlap checks, and do not loosen thresholds just to make a target pass. A simulator result is not physical calibration. Useful regression cases include incorrect geometry, unsupported prompts, discontinuous road surfaces, unstable assembly steps, and cars that leave the track.

The original research and diagnosis remain available under `research/`.

## Running it locally

```bash
npm install
npm run dev     # http://localhost:3000
npm test
npm run lint
```

## A note on third-party content

The reference build videos and any frames extracted from them belong to their creators (see the Attribution section of the [README](README.md)). They were used only for research and are **not** included in this repository. Please do not add third-party copyrighted video frames or media to this repo.
