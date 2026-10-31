import { designBuild } from "../lib/planner/design";

process.once("message", async (input: { prompt: string; inventory: "classic-100" | "builder-xl"; unlimitedPieces: boolean }) => {
  try {
    const result = await designBuild(input.prompt, input.inventory, { unlimitedPieces: input.unlimitedPieces });
    process.send!({ result }, () => process.exit(0));
  } catch (error) {
    process.send!({ error: error instanceof Error ? error.message : "The build check failed." }, () => process.exit(0));
  }
});
