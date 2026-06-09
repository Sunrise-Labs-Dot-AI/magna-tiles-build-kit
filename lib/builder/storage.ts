import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AuthoredBuildDraft, BuildDraftSummary } from "./types";

const DRAFT_DIR = "build-drafts";

export function buildDraftsDirectory(root = process.cwd()): string {
  return join(root, DRAFT_DIR);
}

export async function listBuildDrafts(root = process.cwd()): Promise<BuildDraftSummary[]> {
  const directory = buildDraftsDirectory(root);
  await mkdir(directory, { recursive: true });
  const files = (await readdir(directory)).filter((file) => file.endsWith(".json"));
  const drafts = await Promise.all(
    files.map(async (file) => {
      const draft = await readBuildDraft(file.replace(/\.json$/, ""), root);
      return {
        id: draft.id,
        title: draft.title,
        status: draft.status,
        tileCount: draft.tiles.length,
        updatedAt: draft.updatedAt
      };
    })
  );

  return drafts.sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));
}

export async function readBuildDraft(id: string, root = process.cwd()): Promise<AuthoredBuildDraft> {
  const safeId = safeDraftId(id);
  const raw = await readFile(join(buildDraftsDirectory(root), `${safeId}.json`), "utf8");
  return JSON.parse(raw) as AuthoredBuildDraft;
}

export async function saveBuildDraft(draft: AuthoredBuildDraft, root = process.cwd()): Promise<AuthoredBuildDraft> {
  const safeId = safeDraftId(draft.id);
  const directory = buildDraftsDirectory(root);
  await mkdir(directory, { recursive: true });
  const normalized: AuthoredBuildDraft = {
    ...draft,
    id: safeId,
    updatedAt: new Date().toISOString()
  };
  validateDraftShape(normalized);
  await writeFile(join(directory, `${safeId}.json`), `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

export function safeDraftId(id: string): string {
  const safe = id.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!safe) throw new Error("Draft id is required.");
  return safe;
}

export function validateDraftShape(draft: AuthoredBuildDraft): void {
  if (!draft.id || !draft.title || !Array.isArray(draft.tiles) || !Array.isArray(draft.connections)) {
    throw new Error("Draft payload is missing required fields.");
  }
  draft.tiles.forEach((tile) => {
    if (!tile.id || !tile.shape || !tile.position || !tile.rotation || !tile.role) {
      throw new Error(`Draft tile ${tile.id || "unknown"} is incomplete.`);
    }
  });
}
