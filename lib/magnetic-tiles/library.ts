import type { BuildLibraryItem } from "./types";

export const BUILD_LIBRARY: BuildLibraryItem[] = [
  {
    id: "jet-aircraft",
    title: "Jet Aircraft",
    prompt: "Jet Aircraft",
    summary: "A folded-panel aircraft with angled wings, tail planes, and a pointed nose.",
    difficulty: "medium",
    estimatedMinutes: 12,
    status: "engine-fail-pending-reauthoring",
    tags: ["folded panels", "angled wings", "symmetry", "aircraft", "pending E4"]
  },
  {
    id: "house",
    title: "House",
    prompt: "House",
    summary: "A compact open-front box house with square walls and a pitched gable roof.",
    difficulty: "easy",
    estimatedMinutes: 8,
    status: "engine-valid",
    tags: ["house", "box", "gable roof", "door opening", "physics verified"]
  },
  {
    id: "castle",
    title: "Castle",
    prompt: "Castle",
    summary: "A symmetric square keep with four taller corner towers and triangular tower caps.",
    difficulty: "medium",
    estimatedMinutes: 14,
    status: "engine-valid",
    tags: ["castle", "keep", "corner towers", "battlements", "physics verified"]
  },
  {
    id: "dog",
    title: "Little Tile Dog",
    prompt: "Dog House",
    summary: "A blocky four-legged dog with a raised body, front head, triangle ears, and a rear tail.",
    difficulty: "medium",
    estimatedMinutes: 12,
    status: "engine-valid",
    tags: ["dog", "animal", "four legs", "triangle ears", "physics verified"]
  },
  {
    id: "snail",
    title: "Snail",
    prompt: "Snail",
    summary: "A low foot slab with a raised head and a large vertical radial triangle shell.",
    difficulty: "medium",
    estimatedMinutes: 14,
    status: "engine-valid",
    tags: ["snail", "animal", "radial shell", "triangle fan", "physics verified"]
  },
  {
    id: "small-car-ramp",
    title: "Small Car Ramp",
    prompt: "Small Car Ramp",
    summary: "A compact ramp for small toy cars using a low wedge and top landing.",
    difficulty: "easy",
    estimatedMinutes: 6,
    status: "engine-valid",
    tags: ["ramp", "toy cars", "wedge", "quick build", "physics verified"]
  },
  {
    id: "medium-car-ramp",
    title: "Medium Car Ramp",
    prompt: "Medium Car Ramp",
    summary: "A continuous wedge ramp with rear supports, sloped driving surfaces, and side guardRails.",
    difficulty: "medium",
    estimatedMinutes: 10,
    status: "engine-valid",
    tags: ["ramp", "supports", "guardRails", "toy cars", "physics verified"]
  },
  {
    id: "large-car-ramp",
    title: "Large Car Ramp",
    prompt: "Large Car Ramp",
    summary: "A wide ramp structure with a tall rear grid and large sloped panels.",
    difficulty: "hard",
    estimatedMinutes: 18,
    status: "engine-fail-pending-reauthoring",
    tags: ["ramp", "large panels", "stability", "toy cars", "pending E4"]
  },
  {
    id: "rocket",
    title: "Rocket",
    prompt: "Rocket",
    summary: "An upright rocket with a square-panel body, triangular nose cone, and broad fin base.",
    difficulty: "medium",
    estimatedMinutes: 10,
    status: "engine-valid",
    tags: ["rocket", "box", "nose cone", "fins", "physics verified"]
  }
];

export function findLibraryBuild(id: string): BuildLibraryItem | undefined {
  return BUILD_LIBRARY.find((item) => item.id === id);
}
