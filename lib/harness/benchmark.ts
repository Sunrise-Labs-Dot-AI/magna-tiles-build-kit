/** Fixed acceptance corpus. Do not remove a case because a compiler change makes it fail. */
export const ACCEPTANCE_BRIEFS = [
  "a tower at least 6 inches tall",
  "a tower at least 9 inches tall",
  "a tower at least 12 inches tall",
  "a tower at least 15 inches tall",
  "a tower with 3 levels and at most 30 pieces",
  "an open top box",
  "an open top box 2 tiles wide",
  "an open top box 3 tiles wide",
  "an open top box 2 tiles wide and 2 tiles deep",
  "an open top box 3 tiles wide and 2 tiles deep",
  "a tunnel",
  "a tunnel 2 tiles long",
  "a tunnel 3 tiles long",
  "a tunnel 4 tiles long",
  "a tunnel 2 tiles wide and 2 tiles long",
  "a staircase with 2 steps",
  "a staircase with 3 steps",
  "a staircase with 4 steps",
  "a staircase with 5 steps",
  "a staircase with 3 steps and 2 tiles deep",
] as const;

export const REJECTION_BRIEFS = [
  "a tower at least 12 inches tall and at most 6 inches tall",
  "a tower with a working elevator",
  "an open top box with a lid",
  "a tunnel with a door",
  "a staircase with a slide",
] as const;
