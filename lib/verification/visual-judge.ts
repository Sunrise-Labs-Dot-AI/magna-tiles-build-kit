import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";

export type VisualJudgeVerdict = "match" | "revise" | "wrong";

export interface VisualJudgeDifference {
  part: string;
  observed: string;
  expected: string;
  suggestedFix: string;
}

export interface VisualJudgeResult {
  verdict: VisualJudgeVerdict;
  score: number;
  differences: VisualJudgeDifference[];
  summary: string;
}

interface JudgeBuildOptions {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  model?: string;
  renderIfMissing?: boolean;
  rootDir?: string;
}

const DEFAULT_MODEL = "gpt-4.1-mini";
const UNAVAILABLE_SUMMARY = "judge unavailable";
const PREFERRED_REFERENCE_NAMES = [
  "test.jpg",
  "final.jpg",
  "final-a.jpg",
  "final-b.jpg",
  "final-front.jpg",
  "final-side.jpg",
  "final-rear.jpg"
];
const PREFERRED_RENDER_NAMES = ["final-default.png", "final-side.png", "final-high.png"];

const VISUAL_JUDGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: {
      type: "string",
      enum: ["match", "revise", "wrong"]
    },
    score: {
      type: "integer",
      minimum: 0,
      maximum: 100
    },
    differences: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          part: { type: "string" },
          observed: { type: "string" },
          expected: { type: "string" },
          suggestedFix: { type: "string" }
        },
        required: ["part", "observed", "expected", "suggestedFix"]
      }
    },
    summary: { type: "string" }
  },
  required: ["verdict", "score", "differences", "summary"]
};

export async function judgeBuild(id: string, options: JudgeBuildOptions = {}): Promise<VisualJudgeResult> {
  const rootDir = options.rootDir ?? process.cwd();
  const apiKey = options.apiKey?.trim() || process.env.OPENAI_API_KEY;
  if (!apiKey) return unavailable();

  const referencePath = await findReferencePhoto(rootDir, id);
  if (!referencePath) return unavailable();

  let renderPaths = await findRenderImages(rootDir, id);
  if (renderPaths.length === 0 && options.renderIfMissing) {
    await renderDraft(id, rootDir);
    renderPaths = await findRenderImages(rootDir, id);
  }
  if (renderPaths.length === 0) return unavailable();

  try {
    const result = await requestVisionJudgment({
      apiKey,
      fetchImpl: options.fetchImpl ?? fetch,
      model: options.model ?? DEFAULT_MODEL,
      id,
      referencePath,
      renderPaths
    });
    return normalizeResult(result);
  } catch {
    return unavailable();
  }
}

async function requestVisionJudgment(input: {
  apiKey: string;
  fetchImpl: typeof fetch;
  model: string;
  id: string;
  referencePath: string;
  renderPaths: string[];
}): Promise<VisualJudgeResult> {
  const referenceImage = await imageInput(input.referencePath);
  const renderImages = await Promise.all(input.renderPaths.map((path) => imageInput(path)));
  const response = await input.fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: input.model,
      instructions: [
        "You are a strict visual acceptance judge for MAGNA-TILES build reconstructions.",
        "Compare rendered 3D build screenshots against the real reference photo.",
        "Judge structure, not pixels: silhouette, overall shape, part arrangement, proportions, orientation, and whether the rendered build could physically be the photographed build.",
        "Ignore color differences, lighting, camera framing, transparency, grid background, and missing toy cars or hands.",
        "Return match only when the rendered build is recognizably the same construction. Use revise for close but structurally different. Use wrong for a different object or major geometry mismatch.",
        "Give specific, actionable differences that an authoring agent can apply."
      ].join("\n"),
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                `Build id: ${input.id}`,
                "The first image is the reference photo. The following image(s) are rendered views of the authored build.",
                "Score 90-100 only for a strong structural match; 65-89 for close but needing revision; below 65 for wrong/majorly different."
              ].join("\n")
            },
            referenceImage,
            ...renderImages
          ]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "visual_acceptance_judgment",
          strict: true,
          schema: VISUAL_JUDGE_SCHEMA
        }
      }
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI visual judge failed: ${(await response.text()).slice(0, 240)}`);
  }

  const json = (await response.json()) as { output_text?: string; output?: unknown[] };
  const text = json.output_text ?? extractOutputText(json.output);
  if (!text) throw new Error("OpenAI visual judge response did not include output text.");
  return JSON.parse(text) as VisualJudgeResult;
}

async function findReferencePhoto(rootDir: string, id: string) {
  const directory = join(rootDir, "public", "reference-frames", id);
  if (!existsSync(directory)) return null;
  const files = await readdir(directory);
  const imageFiles = files.filter((file) => [".jpg", ".jpeg", ".png"].includes(extname(file).toLowerCase()));
  const preferred = PREFERRED_REFERENCE_NAMES.find((name) => imageFiles.includes(name));
  const fallback = imageFiles.find((name) => !name.toLowerCase().includes("bom")) ?? imageFiles[0];
  const selected = preferred ?? fallback;
  return selected ? join(directory, selected) : null;
}

async function findRenderImages(rootDir: string, id: string) {
  const directory = join(rootDir, "verification", id);
  if (!existsSync(directory)) return [];
  const files = await readdir(directory);
  const finalRenders = files.filter((file) => /^final-.*\.png$/i.test(file));
  const preferred = PREFERRED_RENDER_NAMES.filter((name) => finalRenders.includes(name));
  const selected = preferred.length > 0 ? preferred : finalRenders.sort();
  return selected.slice(0, 4).map((file) => join(directory, file));
}

async function imageInput(path: string) {
  const bytes = await readFile(path);
  const mimeType = extname(path).toLowerCase() === ".png" ? "image/png" : "image/jpeg";
  return {
    type: "input_image",
    image_url: `data:${mimeType};base64,${bytes.toString("base64")}`,
    detail: "high"
  };
}

async function renderDraft(id: string, rootDir: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("npm", ["run", "render:draft", "--", id], {
      cwd: rootDir,
      env: process.env,
      stdio: "pipe"
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(output));
    });
  });
}

function normalizeResult(result: VisualJudgeResult): VisualJudgeResult {
  const verdict = ["match", "revise", "wrong"].includes(result.verdict) ? result.verdict : "wrong";
  const score = Math.max(0, Math.min(100, Math.round(Number(result.score) || 0)));
  return {
    verdict,
    score,
    differences: Array.isArray(result.differences) ? result.differences : [],
    summary: result.summary || UNAVAILABLE_SUMMARY
  };
}

function unavailable(): VisualJudgeResult {
  return {
    verdict: "wrong",
    score: 0,
    differences: [],
    summary: UNAVAILABLE_SUMMARY
  };
}

function extractOutputText(output: unknown): string | null {
  if (!Array.isArray(output)) return null;
  for (const item of output) {
    if (!isObject(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (isObject(content) && content.type === "output_text" && typeof content.text === "string") {
        return content.text;
      }
    }
  }
  return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
