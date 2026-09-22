import { generateStepInstructions } from "@/lib/magnetic-tiles/instructions";
import { TILE_SPECS } from "@/lib/magnetic-tiles/catalog";
import type { AssemblyStep, BuildGraph } from "@/lib/magnetic-tiles/types";

export function assemblyInstructions(build: BuildGraph): AssemblyStep[] {
  const steps = generateStepInstructions(build);
  const labels = new Map(build.tiles.map((tile, i) => [tile.id, `P${i + 1}`]));
  return steps.map((step) => {
    const ids = new Set(step.tileIds);
    const connections = build.connections.filter(
      (c) => ids.has(c.fromTileId) || ids.has(c.toTileId),
    );
    const usable = connections.filter((c) => {
      const a = build.tiles.find((t) => t.id === c.fromTileId)!;
      const b = build.tiles.find((t) => t.id === c.toTileId)!;
      return a.step <= step.step && b.step <= step.step;
    });
    const pieces = step.tileIds
      .map(
        (id) =>
          `${labels.get(id)} (${TILE_SPECS[build.tiles.find((t) => t.id === id)!.shape].label.toLowerCase()})`,
      )
      .join(", ");
    const joins = usable
      .map(
        (c) =>
          `${labels.get(c.fromTileId)} edge ${c.fromEdge + 1} ↔ ${labels.get(c.toTileId)} edge ${c.toEdge + 1}`,
      )
      .join("; ");
    let title = step.title;
    let guidance =
      "Hold the pieces in the highlighted orientation while connecting this group. Release them only after the whole step is assembled.";
    if (build.id.startsWith("course-")) {
      title =
        [
          "Assemble the supported slope",
          "Add the launch box",
          "Brace the rear wall",
        ][step.step - 1] ?? title;
      guidance =
        [
          "Hold the two triangular sides parallel, then join the large square across their sloping edges. Set both triangle bases on the table.",
          "Form a box from the four small square walls and the large square roof. Join its front roof edge to the high end of the slope. Keep the driving path open.",
          "Add the two rear squares above the launch box, joined side by side. Gently seat each connection before releasing the model.",
        ][step.step - 1] ?? guidance;
    }
    return {
      ...step,
      title,
      instruction: `${guidance} Pieces: ${pieces}. Joins: ${joins || "Position the pieces as shown."}`,
    };
  });
}
