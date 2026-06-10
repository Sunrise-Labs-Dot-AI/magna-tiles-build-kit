import { countInventory } from "./validation";
import type { AssemblyStep, BuildGraph } from "./types";

export function generateInstructions(build: BuildGraph): AssemblyStep[] {
  if (build.family === "aircraft" && build.title === "Jet Aircraft") {
    return generateJetAircraftInstructions(build);
  }

  if (build.family === "ramp") {
    return generateRampInstructions(build);
  }

  return generateStepInstructions(build);
}

/**
 * Honest, structure-derived instructions: group the build's actual tiles by their
 * authored step, and derive each step's title/copy/count from the real tiles and roles.
 * No title-keyed hardcoded templates, so the text always matches the geometry. This is
 * the path used for hand-authored library builds (replayed from build-drafts/).
 */
export function generateStepInstructions(build: BuildGraph): AssemblyStep[] {
  const groups = new Map<number, typeof build.tiles>();
  build.tiles.forEach((tile) => {
    const existing = groups.get(tile.step) ?? [];
    existing.push(tile);
    groups.set(tile.step, existing);
  });

  return Array.from(groups.entries())
    .sort(([first], [second]) => first - second)
    .map(([step, tiles]) => {
      const roles = Array.from(new Set(tiles.map((tile) => tile.role)));
      return {
        step,
        title: titleForStep(step, roles),
        instruction: instructionForStep(step, tiles, roles),
        tileIds: tiles.map((tile) => tile.id),
        tileCounts: countInventory(tiles)
      };
    });
}

function generateRampInstructions(build: BuildGraph): AssemblyStep[] {
  const groups = groupedTilesByStep(build);
  const copy = rampCopyFor(build.title);

  return Array.from(groups.entries())
    .sort(([first], [second]) => first - second)
    .map(([step, tiles]) => ({
      step,
      title: copy[step]?.title ?? titleForStep(step, Array.from(new Set(tiles.map((tile) => tile.role)))),
      instruction:
        copy[step]?.instruction ??
        instructionForStep(step, tiles, Array.from(new Set(tiles.map((tile) => tile.role)))),
      tileIds: tiles.map((tile) => tile.id),
      tileCounts: countInventory(tiles)
    }));
}

function groupedTilesByStep(build: BuildGraph): Map<number, typeof build.tiles> {
  const groups = new Map<number, typeof build.tiles>();
  build.tiles.forEach((tile) => {
    const existing = groups.get(tile.step) ?? [];
    existing.push(tile);
    groups.set(tile.step, existing);
  });
  return groups;
}

/**
 * Step copy keyed to the hand-authored, engine-valid ramp drafts that the prompt
 * pipeline replays (build-drafts/{small,medium,large}-car-ramp.json). The text follows
 * the drafts' actual per-step tiles and roles, so the instructions never describe
 * geometry that is not in the build.
 */
function rampCopyFor(title: string): Record<number, { title: string; instruction: string }> {
  if (title === "Small Car Ramp") {
    return {
      1: {
        title: "Stand the wedge sides",
        instruction:
          "Stand the two isosceles triangles opposite each other with their long edges on the table. They set the ramp angle for everything that follows."
      },
      2: {
        title: "Add the driving surface",
        instruction:
          "Snap the lower and upper sloped squares onto the wedge sides so the car has one continuous driving surface from the table to the top."
      },
      3: {
        title: "Add the landing and support",
        instruction:
          "Attach the flat top landing square at the high end, then the vertical support square beneath it so the landing is fully held up."
      },
      4: {
        title: "Lock in the side supports",
        instruction:
          "Press the two flipped right triangles against the sides. They keep the wedge from spreading open when a toy car rolls down."
      }
    };
  }

  if (title === "Medium Car Ramp") {
    return {
      1: {
        title: "Stand the wedge sides",
        instruction:
          "Stand the two isosceles triangles opposite each other with their long edges on the table to set the medium ramp angle."
      },
      2: {
        title: "Add the driving surface",
        instruction:
          "Snap the lower and upper sloped squares onto the wedge sides so the slope reads as one continuous driving path."
      },
      3: {
        title: "Add the top landing",
        instruction:
          "Attach the flat top landing square at the high end of the slope. Seat the full magnet edge so it sits level."
      },
      4: {
        title: "Extend the landing",
        instruction:
          "Add the extended landing square and the two flipped right-triangle side supports so the longer landing stays rigid."
      },
      5: {
        title: "Lock the rear supports",
        instruction:
          "Finish with the extended side supports and the vertical support square under the landing. Press along every seam before rolling a car."
      }
    };
  }

  if (title === "Large Car Ramp") {
    return {
      1: {
        title: "Stand the side supports",
        instruction:
          "Stand the two large isosceles side supports opposite each other. They carry the big rigid ramp panel, so keep their ground edges flat."
      },
      2: {
        title: "Add the big ramp panel",
        instruction:
          "Lay the large square sloped panel across the side supports to form the wide driving surface. Check that it sits evenly on both sides."
      },
      3: {
        title: "Support the high end",
        instruction:
          "Add the two lower rear wall squares behind the high end so the panel cannot tip backward."
      },
      4: {
        title: "Add the landing platform",
        instruction:
          "Place the large square top landing platform at the high end, supported by the rear wall below it."
      },
      5: {
        title: "Brace the rear",
        instruction:
          "Finish with the rear side braces and the upper rear wall brace behind the high end, then roll a car from top to bottom to test the path."
      }
    };
  }

  return {};
}

function generateJetAircraftInstructions(build: BuildGraph): AssemblyStep[] {
  const groups = groupedTilesByStep(build);

  return Array.from(groups.entries())
    .sort(([first], [second]) => first - second)
    .map(([step, tiles]) => {
      const roles = Array.from(new Set(tiles.map((tile) => tile.role)));
      const count = tiles.length;
      const noun = count === 1 ? "tile" : "tiles";
      return {
        step,
        title: jetTitleForStep(step, roles),
        instruction: `Attach ${count} ${noun}: ${formatRoleList(roles)}. ${jetGuidanceForStep(step, roles)}`,
        tileIds: tiles.map((tile) => tile.id),
        tileCounts: countInventory(tiles)
      };
    });
}

function jetTitleForStep(step: number, roles: string[]): string {
  if (step <= 2) return "Build the fuselage";
  if (roles.some((role) => /wing|brace/i.test(role))) return "Shape the wings";
  if (roles.some((role) => /tail|fin/i.test(role))) return "Build the tail";
  if (roles.some((role) => /nose/i.test(role))) return "Shape the nose";
  if (roles.some((role) => /fuselage|body|deck/i.test(role))) return "Build the fuselage";
  return `Jet step ${step}`;
}

function jetGuidanceForStep(step: number, roles: string[]): string {
  if (step <= 2) return "Keep the two-column body straight so later wing and tail edges stay mirrored.";
  if (roles.some((role) => /wing|brace/i.test(role))) {
    return "Mirror left and right pieces across the fuselage and press only along seated magnet edges.";
  }
  if (roles.some((role) => /tail|fin/i.test(role))) {
    return "Add the rear pieces after the body and wing roots so the upright fins have a supported edge.";
  }
  if (roles.some((role) => /nose/i.test(role))) {
    return "Center the pointed pieces on the front of the fuselage to keep the jet silhouette tapered.";
  }
  return "Check the model from the front and side before continuing.";
}

function titleForStep(step: number, roles: string[]): string {
  if (step === 1) return "Start with the base";
  if (roles.some((role) => role.includes("ramp") || role.includes("wedge"))) {
    return "Shape the ramp";
  }
  if (roles.some((role) => role.includes("wing"))) {
    return "Attach the wings";
  }
  if (roles.some((role) => role.includes("tail") || role.includes("fin"))) {
    return "Add the fins";
  }
  if (roles.some((role) => role.includes("roof") || role.includes("cap"))) {
    return "Add the top pieces";
  }
  if (roles.some((role) => /ear|head|antenna/.test(role))) {
    return "Add the head details";
  }
  if (roles.some((role) => /leg|foot|paw/.test(role))) {
    return "Build the legs";
  }
  if (roles.some((role) => /body|shell|span|pillar/.test(role))) {
    return "Build the body";
  }
  if (roles.some((role) => role.includes("side") || role.includes("stabilizer"))) {
    return "Lock in the sides";
  }
  return "Build the next layer";
}

function instructionForStep(
  step: number,
  tiles: Array<{ role: string; shape: string }>,
  roles: string[]
): string {
  const count = tiles.length;
  const noun = count === 1 ? "tile" : "tiles";
  const roleCopy = roles.length === 1 ? roles[0] : roles.slice(0, 2).join(" and ");

  if (step === 1) {
    return `Place ${count} ${noun} on the table to make the ${roleCopy}. Keep the lower edges flat and aligned.`;
  }

  if (roles.some((role) => role.includes("ramp") || role.includes("wedge") || role.includes("slope"))) {
    return `Attach ${count} ${noun} to form the ${roleCopy}. Keep the driving surface sloped, with full magnetic edges seated against the support pieces.`;
  }

  if (roles.some((role) => role.includes("wing"))) {
    return `Attach ${count} ${noun} as ${roleCopy}. Mirror the left and right sides so the aircraft stays balanced.`;
  }

  if (roles.some((role) => role.includes("tail") || role.includes("fin"))) {
    return `Add ${count} ${noun} for the ${roleCopy}. Press gently at the contact edge so the fins stay upright.`;
  }

  if (roles.some((role) => role.includes("side") || role.includes("stabilizer"))) {
    return `Attach ${count} ${noun} at right angles as ${roleCopy}. These pieces help the model stand while you keep building.`;
  }

  if (roles.some((role) => role.includes("roof") || role.includes("cap") || role.includes("nose"))) {
    return `Snap on ${count} triangle ${count === 1 ? "piece" : "pieces"} to form the ${roleCopy}. Center them over the wall tiles below.`;
  }

  return `Add ${count} ${noun} for the ${roleCopy}. Match full edges whenever possible so the magnets can grab cleanly.`;
}

function formatRoleList(roles: string[]): string {
  if (roles.length === 0) return "the next build-specific pieces";
  if (roles.length === 1) return roles[0];
  if (roles.length === 2) return `${roles[0]} and ${roles[1]}`;
  return `${roles.slice(0, -1).join(", ")}, and ${roles[roles.length - 1]}`;
}
