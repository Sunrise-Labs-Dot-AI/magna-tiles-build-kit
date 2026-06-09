export interface VerificationPrompt {
  id: string;
  prompt: string;
  expectedFamily: string;
}

export const VERIFICATION_PROMPTS: VerificationPrompt[] = [
  { id: "jet-aircraft-prompt", prompt: "Jet Aircraft", expectedFamily: "aircraft" },
  { id: "build-me-a-jet-aircraft", prompt: "build me a jet aircraft", expectedFamily: "aircraft" },
  { id: "fast-airplane-with-wings", prompt: "fast airplane with wings", expectedFamily: "aircraft" },
  { id: "small-car-ramp-prompt", prompt: "Small Car Ramp", expectedFamily: "ramp" },
  { id: "medium-car-ramp-prompt", prompt: "Medium Car Ramp", expectedFamily: "ramp" },
  { id: "large-car-ramp-prompt", prompt: "Large Car Ramp", expectedFamily: "ramp" },
  { id: "toy-car-ramp", prompt: "toy car ramp", expectedFamily: "ramp" },
  { id: "ramp-for-toy-cars", prompt: "ramp for toy cars", expectedFamily: "ramp" }
];
