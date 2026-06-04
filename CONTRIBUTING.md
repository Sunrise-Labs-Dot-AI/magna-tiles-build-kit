# Contributing

## This is an archived exploration

This repository is a **completed research exploration, published as a public archive**. It is not actively maintained, and there is no roadmap. Issues and pull requests may not get a response.

It is here to be read and learned from. The interesting parts are the honest write-up of what worked and what didn't ([README.md](README.md), [STATUS.md](STATUS.md), [research/diagnosis.md](research/diagnosis.md)) and the literature-grounded system design ([research/magna_tiles_system_design.md](research/magna_tiles_system_design.md)).

## If you want to build on it

You are welcome to fork it under the [MIT license](LICENSE). The most useful direction is the one in [STATUS.md](STATUS.md): replace the hand-eyeballed reconstruction target with a real, measured one (COLMAP / DUSt3R-MASt3R or human-encoded ground truth), add a real search/constraint solver, and add a perceptual scorer measured against the actual frames. That is the change that would let the pipeline converge on the real build instead of an approximation of it.

## Running it locally

```bash
npm install
npm run dev     # http://localhost:3000
npm test
npm run lint
```

## A note on third-party content

The reference build videos and any frames extracted from them belong to their creators (see the Attribution section of the [README](README.md)). They were used only for research and are **not** included in this repository. Please do not add third-party copyrighted video frames or media to this repo.
