export const ENGINE_VALID_LIBRARY_BUILD_IDS = ["jet-aircraft", "house", "castle", "dog", "snail", "small-car-ramp", "medium-car-ramp", "large-car-ramp", "rocket"] as const;

// The rebuilt jet is engine-valid again (stands, overlap-free, composed from macros). Visual
// resemblance polish (sharper nose, upright tail fin, swept wings) is tracked separately as the
// human signoff gate, not by the engine tests.
export const ENGINE_EXPECTED_FAIL_LIBRARY_BUILD_IDS = [] as const;

export const ENGINE_EXPECTED_FAIL_PROMPT_IDS = [
  "jet-aircraft-prompt",
  "build-me-a-jet-aircraft",
  "fast-airplane-with-wings",
  "small-car-ramp-prompt",
  "medium-car-ramp-prompt",
  "large-car-ramp-prompt",
  "toy-car-ramp",
  "ramp-for-toy-cars"
] as const;

export function isExpectedEngineFailure(kind: "library" | "prompt", id: string): boolean {
  if (kind === "library") return (ENGINE_EXPECTED_FAIL_LIBRARY_BUILD_IDS as readonly string[]).includes(id);
  return (ENGINE_EXPECTED_FAIL_PROMPT_IDS as readonly string[]).includes(id);
}
