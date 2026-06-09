export type DraftModelId =
  | "gpt-5.5"
  | "gpt-5.4"
  | "gpt-5.4-mini"
  | "gpt-5.2"
  | "gpt-4.1-mini";

export type DraftReasoningEffort = "medium" | "high" | "xhigh";

export interface DraftModelOption {
  id: DraftModelId;
  label: string;
}

export interface DraftReasoningOption {
  id: DraftReasoningEffort;
  label: string;
}

export interface DraftModelConfig {
  model: DraftModelId;
  reasoningEffort: DraftReasoningEffort;
}

export const DEFAULT_DRAFT_MODEL_CONFIG: DraftModelConfig = {
  model: "gpt-5.5",
  reasoningEffort: "medium"
};

export const DRAFT_MODEL_OPTIONS: DraftModelOption[] = [
  { id: "gpt-5.5", label: "GPT-5.5" },
  { id: "gpt-5.4", label: "GPT-5.4" },
  { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
  { id: "gpt-5.2", label: "GPT-5.2" },
  { id: "gpt-4.1-mini", label: "GPT-4.1 Mini" }
];

export const DRAFT_REASONING_OPTIONS: DraftReasoningOption[] = [
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "Extra high" }
];

export function parseDraftModelConfig(input: {
  model?: unknown;
  reasoningEffort?: unknown;
}): DraftModelConfig {
  return {
    model: isDraftModelId(input.model)
      ? input.model
      : DEFAULT_DRAFT_MODEL_CONFIG.model,
    reasoningEffort: isDraftReasoningEffort(input.reasoningEffort)
      ? input.reasoningEffort
      : DEFAULT_DRAFT_MODEL_CONFIG.reasoningEffort
  };
}

export function isDraftModelId(value: unknown): value is DraftModelId {
  return (
    typeof value === "string" &&
    DRAFT_MODEL_OPTIONS.some((option) => option.id === value)
  );
}

export function isDraftReasoningEffort(value: unknown): value is DraftReasoningEffort {
  return (
    typeof value === "string" &&
    DRAFT_REASONING_OPTIONS.some((option) => option.id === value)
  );
}
