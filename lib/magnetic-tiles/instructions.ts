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

function rampCopyFor(title: string): Record<number, { title: string; instruction: string }> {
  if (title === "Small Car Ramp") {
    return {
      1: {
        title: "Make the wedge sides",
        instruction:
          "Stand the two right triangles opposite each other to set the ramp angle. Keep their long edges aligned so the driving surface has a clean slope."
      },
      2: {
        title: "Add the driving surface",
        instruction:
          "Snap on the sloped driving panel, the short lower runout, and the top landing panel. The car should have a smooth path from table to landing."
      },
      3: {
        title: "Lock the supports",
        instruction:
          "Add the front and rear support squares underneath the slope. Press along the full magnet edges so the wedge does not spread open."
      },
      4: {
        title: "Add the side guards",
        instruction:
          "Attach the two isosceles triangles as side guards near the landing. They keep the top square from wobbling when a toy car rolls over it."
      }
    };
  }

  if (title === "Medium Car Ramp") {
    return {
      1: {
        title: "Start the rear wall",
        instruction:
          "Build the first row of the rear support wall from five squares. Keep it straight; the slope will reference this row."
      },
      2: {
        title: "Raise the wall",
        instruction:
          "Add the second row of five squares directly above the first. Check that the panel stays flat and the side edges remain even."
      },
      3: {
        title: "Finish the support grid",
        instruction:
          "Add the third row of five squares to complete the tall rear support. This gives the medium ramp its higher landing."
      },
      4: {
        title: "Brace the lower slope",
        instruction:
          "Add the first triangle pattern along the lower slope and side guards. These pieces begin converting the wall into a ramp."
      },
      5: {
        title: "Continue the triangle run",
        instruction:
          "Snap on the next set of equilateral triangles along the driving surface. Keep their edges seated so the incline reads as one continuous path."
      },
      6: {
        title: "Finish and test the ramp",
        instruction:
          "Add the final equilateral triangles, then gently press the side braces and roll a small car over the path to check alignment."
      }
    };
  }

  if (title === "Large Car Ramp") {
    return {
      1: {
        title: "Begin the tall wall",
        instruction:
          "Lay out the first row of seven squares for the rear wall. This wide base keeps the large ramp from twisting."
      },
      2: {
        title: "Add wall row two",
        instruction:
          "Stack the second row of seven squares on top of the base row. Align every vertical seam before continuing."
      },
      3: {
        title: "Add wall row three",
        instruction:
          "Build the third row across the full width. Press from the center outward so the wall stays flat."
      },
      4: {
        title: "Add wall row four",
        instruction:
          "Continue with the fourth row, keeping the panel upright and square."
      },
      5: {
        title: "Add wall row five",
        instruction:
          "Add the fifth row of squares. The wall should now feel like a single rigid panel."
      },
      6: {
        title: "Finish the rear wall",
        instruction:
          "Add the sixth row and check the full wall for straight edges before attaching the ramp planes."
      },
      7: {
        title: "Attach the large ramp planes",
        instruction:
          "Connect the three large square panels across the lower edge of the wall. Center each panel on the square grid so the slope is broad and even."
      },
      8: {
        title: "Add side markers",
        instruction:
          "Place the six equilateral triangles along the upper side edges as markers and braces. Check the car path from bottom to top."
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
