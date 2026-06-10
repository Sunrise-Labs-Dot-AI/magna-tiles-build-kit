import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { draftToBuildGraph } from "@/lib/builder/operations";
import type { AuthoredBuildDraft } from "@/lib/builder/types";
import { gateBuild } from "@/lib/engine";
import { BUILD_LIBRARY } from "@/lib/magnetic-tiles/library";

/**
 * Library invariant: every authored draft that CLAIMS engine validity actually passes the
 * un-gameable engine gate. This keeps build-drafts/*.json honest — a draft cannot ship with
 * status "engine-valid" unless gateBuild (overlap pre-filter, magnetic-join validity, Rapier
 * stand test, and the roll test for functional ramps) passes it right now, in this repo state.
 */

const DRAFT_DIR = join(process.cwd(), "build-drafts");

interface DraftFile {
  file: string;
  draft: AuthoredBuildDraft;
}

const draftFiles: DraftFile[] = readdirSync(DRAFT_DIR)
  .filter((file) => file.endsWith(".json"))
  .sort()
  .map((file) => ({
    file,
    draft: JSON.parse(readFileSync(join(DRAFT_DIR, file), "utf8")) as AuthoredBuildDraft
  }));

const engineValidDrafts = draftFiles.filter(({ draft }) => draft.status === "engine-valid");

describe("library gate invariant", () => {
  it("finds engine-valid drafts to verify (the invariant is not vacuous)", () => {
    expect(engineValidDrafts.length).toBeGreaterThan(0);
    expect(engineValidDrafts.map(({ draft }) => draft.id)).toContain("jet-aircraft");
  });

  it.each(engineValidDrafts)(
    "$file claims engine-valid and passes gateBuild",
    async ({ draft }) => {
      const verdict = await gateBuild(draftToBuildGraph(draft));
      expect(verdict.passed, verdict.reasons.join("\n")).toBe(true);
    },
    120_000
  );

  it("library entries marked engine-valid are backed by engine-valid drafts", () => {
    const draftsById = new Map(draftFiles.map(({ draft }) => [draft.id, draft]));
    for (const item of BUILD_LIBRARY.filter((entry) => entry.status === "engine-valid")) {
      const draft = draftsById.get(item.id);
      expect(draft, `library entry ${item.id} has no authored draft`).toBeDefined();
      expect(draft?.status, `library entry ${item.id} draft status`).toBe("engine-valid");
    }
  });
});
