import {
  TECHNIQUE_TAGS,
  type AssemblyAction,
  type ReferenceBuildEncoding,
  type ReferenceEncodingStep,
  type ReferenceVideoSource
} from "./types";
import {
  DEFAULT_DRAFT_MODEL_CONFIG,
  type DraftModelConfig
} from "./model-options";
import type { FrameSample } from "./frame-sampler";

export interface DraftEncodingResult {
  encoding: ReferenceBuildEncoding;
  draftSource: "model" | "heuristic";
  modelConfig: DraftModelConfig;
  note: string;
}

interface DraftStep {
  timestamp: string;
  action: AssemblyAction;
  title: string;
  notes: string;
  subassemblyId?: string;
  tileCounts: {
    "small-square": number;
    "large-square": number;
    "equilateral-triangle": number;
    "right-triangle": number;
    "isosceles-triangle": number;
  };
  pieceEstimateConfidence: "low" | "medium" | "high";
  learnedTechnique?: string;
}

interface ModelDraft {
  buildLabel: string;
  observedTechniques: string[];
  steps: DraftStep[];
}

const MODEL_DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    buildLabel: { type: "string" },
    observedTechniques: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: 8
    },
    steps: {
      type: "array",
      minItems: 4,
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          timestamp: { type: "string" },
          action: {
            type: "string",
            enum: [
              "place",
              "connect",
              "build-subassembly",
              "fold",
              "rotate",
              "stand-up",
              "brace",
              "adjust",
              "balance-check"
            ]
          },
          title: { type: "string" },
          notes: { type: "string" },
          subassemblyId: { type: "string" },
          tileCounts: {
            type: "object",
            additionalProperties: false,
            properties: {
              "small-square": { type: "number" },
              "large-square": { type: "number" },
              "equilateral-triangle": { type: "number" },
              "right-triangle": { type: "number" },
              "isosceles-triangle": { type: "number" }
            },
            required: [
              "small-square",
              "large-square",
              "equilateral-triangle",
              "right-triangle",
              "isosceles-triangle"
            ]
          },
          pieceEstimateConfidence: {
            type: "string",
            enum: ["low", "medium", "high"]
          },
          learnedTechnique: { type: "string" }
        },
        required: [
          "timestamp",
          "action",
          "title",
          "notes",
          "subassemblyId",
          "tileCounts",
          "pieceEstimateConfidence",
          "learnedTechnique"
        ]
      }
    }
  },
  required: ["buildLabel", "observedTechniques", "steps"]
};

export async function draftReferenceEncoding(
  source: ReferenceVideoSource,
  reviewerNotes: string,
  modelConfig: DraftModelConfig = DEFAULT_DRAFT_MODEL_CONFIG,
  apiKeyOverride?: string,
  frames: FrameSample[] = []
): Promise<DraftEncodingResult> {
  const apiKey = apiKeyOverride?.trim() || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      encoding: toEncoding(source, generateHeuristicDraft(source, reviewerNotes)),
      draftSource: "heuristic",
      modelConfig,
      note: "No OPENAI_API_KEY is configured, so this draft used the built-in heuristic encoder."
    };
  }

  try {
    const draft = await generateModelDraft(source, reviewerNotes, apiKey, modelConfig, frames);
    return {
      encoding: toEncoding(source, draft),
      draftSource: "model",
      modelConfig,
      note:
        `${modelConfig.model} (${modelConfig.reasoningEffort}) generated this draft from ${frames.length ? `${frames.length} sampled video frames, ` : ""}video metadata and reviewer notes. It still needs human review against the actual video.`
    };
  } catch (error) {
    return {
      encoding: toEncoding(source, generateHeuristicDraft(source, reviewerNotes)),
      draftSource: "heuristic",
      modelConfig,
      note: `Model draft failed, so the app used the heuristic encoder instead. ${error instanceof Error ? error.message : ""}`.trim()
    };
  }
}

export function generateHeuristicDraft(
  source: ReferenceVideoSource,
  reviewerNotes = ""
): ModelDraft {
  const title = source.title.replace(/^Magna-Tiles Idea:\s*/i, "");
  const normalized = `${title} ${reviewerNotes}`.toLowerCase();

  if (/\b(jet|aircraft|plane|airplane|spaceship|rocket)\b/.test(normalized)) {
    return {
      buildLabel: title,
      observedTechniques: [
        "make a subassembly",
        "build flat, then fold",
        "adjust angle for magnet alignment",
        "use symmetry",
        "widen base for balance"
      ],
      steps: [
        {
          timestamp: "00:00",
          action: "build-subassembly",
          title: "Build the center body as a flat group",
          notes:
            "Start by encoding the fuselage/body panel as a flat magnetic tile group. Watch for whether squares are joined edge-to-edge before the body is lifted.",
          subassemblyId: "body",
          tileCounts: {
            "small-square": 3,
            "large-square": 0,
            "equilateral-triangle": 0,
            "right-triangle": 0,
            "isosceles-triangle": 0
          },
          pieceEstimateConfidence: "medium",
          learnedTechnique: "make a subassembly"
        },
        {
          timestamp: "",
          action: "build-subassembly",
          title: "Create matching wing panels",
          notes:
            "Capture the left and right wing groups separately. Note symmetry, triangle orientation, and whether the builder mirrors the first wing.",
          subassemblyId: "wings",
          tileCounts: {
            "small-square": 2,
            "large-square": 0,
            "equilateral-triangle": 2,
            "right-triangle": 2,
            "isosceles-triangle": 0
          },
          pieceEstimateConfidence: "medium",
          learnedTechnique: "use symmetry"
        },
        {
          timestamp: "",
          action: "fold",
          title: "Fold or angle the wings into position",
          notes:
            "Record which long edge behaves like the hinge and how far the wing rotates before the magnets settle.",
          subassemblyId: "wings",
          tileCounts: {
            "small-square": 0,
            "large-square": 0,
            "equilateral-triangle": 0,
            "right-triangle": 0,
            "isosceles-triangle": 0
          },
          pieceEstimateConfidence: "high",
          learnedTechnique: "build flat, then fold"
        },
        {
          timestamp: "",
          action: "connect",
          title: "Attach wings to the body",
          notes:
            "Mark the edge-to-edge contact points. If the builder nudges tiles so the magnets grab, preserve that as an adjustment step.",
          subassemblyId: "airframe",
          tileCounts: {
            "small-square": 0,
            "large-square": 0,
            "equilateral-triangle": 0,
            "right-triangle": 0,
            "isosceles-triangle": 0
          },
          pieceEstimateConfidence: "medium",
          learnedTechnique: "adjust angle for magnet alignment"
        },
        {
          timestamp: "",
          action: "brace",
          title: "Add nose, tail, or fin braces",
          notes:
            "Capture small triangular pieces used as fins, nose details, or stabilizers. These may be structural even if they look decorative.",
          subassemblyId: "fins",
          tileCounts: {
            "small-square": 0,
            "large-square": 0,
            "equilateral-triangle": 1,
            "right-triangle": 2,
            "isosceles-triangle": 1
          },
          pieceEstimateConfidence: "medium",
          learnedTechnique: "brace with side returns"
        },
        {
          timestamp: "",
          action: "balance-check",
          title: "Check that the aircraft stands evenly",
          notes:
            "Watch for small balance corrections: widening the base, changing wing angle, or pressing a joint so magnets fully align.",
          subassemblyId: "airframe",
          tileCounts: {
            "small-square": 0,
            "large-square": 0,
            "equilateral-triangle": 0,
            "right-triangle": 0,
            "isosceles-triangle": 0
          },
          pieceEstimateConfidence: "high",
          learnedTechnique: "widen base for balance"
        }
      ]
    };
  }

  return {
    buildLabel: title,
    observedTechniques: TECHNIQUE_TAGS.slice(0, 5),
    steps: [
      {
        timestamp: "00:00",
        action: "build-subassembly",
        title: "Identify the first flat subassembly",
        notes:
          "Capture the first group of tiles the builder makes before attaching it to the main structure.",
        subassemblyId: "primary-group",
        tileCounts: {
          "small-square": 0,
          "large-square": 0,
          "equilateral-triangle": 0,
          "right-triangle": 0,
          "isosceles-triangle": 0
        },
        pieceEstimateConfidence: "low",
        learnedTechnique: "make a subassembly"
      },
      {
        timestamp: "",
        action: "connect",
        title: "Attach the group to the main build",
        notes:
          "Record the magnetic edge where the group connects and whether the contact is full-edge or partial.",
        subassemblyId: "primary-group",
        tileCounts: {
          "small-square": 0,
          "large-square": 0,
          "equilateral-triangle": 0,
          "right-triangle": 0,
          "isosceles-triangle": 0
        },
        pieceEstimateConfidence: "low",
        learnedTechnique: "adjust angle for magnet alignment"
      },
      {
        timestamp: "",
        action: "adjust",
        title: "Capture alignment corrections",
        notes:
          "Watch for hand nudges, angle changes, or re-seating moves that help magnets grab cleanly.",
        subassemblyId: "main-structure",
        tileCounts: {
          "small-square": 0,
          "large-square": 0,
          "equilateral-triangle": 0,
          "right-triangle": 0,
          "isosceles-triangle": 0
        },
        pieceEstimateConfidence: "low",
        learnedTechnique: "adjust angle for magnet alignment"
      },
      {
        timestamp: "",
        action: "balance-check",
        title: "Record the stability check",
        notes:
          "Note any braces, side returns, or base-widening moves that keep the build upright.",
        subassemblyId: "main-structure",
        tileCounts: {
          "small-square": 0,
          "large-square": 0,
          "equilateral-triangle": 0,
          "right-triangle": 0,
          "isosceles-triangle": 0
        },
        pieceEstimateConfidence: "low",
        learnedTechnique: "widen base for balance"
      }
    ]
  };
}

async function generateModelDraft(
  source: ReferenceVideoSource,
  reviewerNotes: string,
  apiKey: string,
  modelConfig: DraftModelConfig,
  frames: FrameSample[]
): Promise<ModelDraft> {
  const userContent: Array<Record<string, unknown>> = [
    {
      type: "input_text",
      text: [
        `Video title: ${source.title}`,
        `Creator: ${source.authorName}`,
        `URL: ${source.url}`,
        `Reviewer notes: ${reviewerNotes || "(none yet)"}`,
        frames.length
          ? `Sampled frames are provided at these timestamps: ${frames.map((frame) => frame.timestamp).join(", ")}. Use them to ground step timing, visible piece counts, and construction-state changes.`
          : "No sampled frames were provided; infer from metadata and reviewer notes only.",
        frames.some((frame) => frame.landmarkRole === "bill-of-materials")
          ? `The frame marked bill-of-materials is the source of truth for total pieces needed: ${frames
              .filter((frame) => frame.landmarkRole === "bill-of-materials")
              .map((frame) => frame.timestamp)
              .join(", ")}. Extract visible tile counts from it before estimating step counts.`
          : "No bill-of-materials frame was explicitly marked.",
        "Draft an editable first-pass encoding. Focus on subassemblies, folds/rotations, bracing, magnet alignment adjustments, and balance checks.",
        "Populate timestamps in mm:ss format using the provided frame timestamps whenever frames show a construction state change.",
        "Estimate tile counts per action whenever visible/inferable. Use zeros for manipulation-only steps like fold/adjust/balance. Always include all five tile shape keys.",
        "Set pieceEstimateConfidence high when counts are directly visible or manipulation-only, medium when inferred from symmetry/title, low when uncertain."
      ].join("\n")
    },
    ...frames.map((frame) => ({
      type: "input_image",
      image_url: frame.dataUrl,
      detail: "low"
    }))
  ];

  const requestBody: Record<string, unknown> = {
    model: modelConfig.model,
    instructions:
      "You draft human-reviewable assembly encodings for magnetic tile build videos. Use sampled video frames when available to ground timestamps, tile counts, subassemblies, and visible manipulation moves. Return structured JSON only.",
    input: [
      {
        role: "user",
        content: userContent
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "reference_build_encoding_draft",
        strict: true,
        schema: MODEL_DRAFT_SCHEMA
      }
    }
  };
  if (modelConfig.model.startsWith("gpt-5")) {
    requestBody.reasoning = {
      effort: modelConfig.reasoningEffort
    };
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI request failed: ${detail.slice(0, 240)}`);
  }

  const json = (await response.json()) as { output_text?: string; output?: unknown[] };
  const text = json.output_text ?? extractOutputText(json.output);
  if (!text) throw new Error("OpenAI response did not include output text.");

  return JSON.parse(text) as ModelDraft;
}

function toEncoding(source: ReferenceVideoSource, draft: ModelDraft): ReferenceBuildEncoding {
  return {
    source,
    status: "draft",
    buildLabel: draft.buildLabel,
    observedTechniques: draft.observedTechniques,
    steps: draft.steps.map((step, index) => ({
      ...step,
      id: `draft-${index + 1}`,
      subassemblyId: step.subassemblyId || undefined,
      learnedTechnique: step.learnedTechnique || undefined
    }))
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
