export const ENGINE_VALID_LIBRARY_BUILD_IDS = ["house", "castle", "dog", "medium-car-ramp", "large-car-ramp"] as const;

// Raw non-intersection is a separate property; retain the jet as a geometry
// regression fixture without claiming it stands.
export const RAW_GEOMETRY_LIBRARY_BUILD_IDS = ["jet-aircraft", "house", "castle", "dog", "snail", "small-car-ramp", "medium-car-ramp", "large-car-ramp", "rocket"] as const;

// These historical fixtures fail strict peak-contact, displacement or sustained-rest
// checks. Their geometry is retained as diagnostic evidence, not valid anchors.
export const ENGINE_EXPECTED_FAIL_LIBRARY_BUILD_IDS = ["jet-aircraft", "snail", "small-car-ramp", "rocket"] as const;

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
