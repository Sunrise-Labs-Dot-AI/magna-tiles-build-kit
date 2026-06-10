"use client";

import {
  Activity,
  Bot,
  Check,
  Clipboard,
  Clock,
  Images,
  Plus,
  ShieldCheck,
  Video,
  WandSparkles
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { BuildDraftSummary } from "@/lib/builder/types";
import {
  measuredStepToEncodingStep,
  stepsFromMeasuredTimeline
} from "@/lib/reference-encoder/measured-draft";
import {
  DEFAULT_DRAFT_MODEL_CONFIG,
  DRAFT_MODEL_OPTIONS,
  DRAFT_REASONING_OPTIONS,
  type DraftModelId,
  type DraftReasoningEffort
} from "@/lib/reference-encoder/model-options";
import type { ReconstructionGateResult } from "@/lib/reference-encoder/reconstruction";
import { secondsToTimestamp } from "@/lib/reference-encoder/timecode";
import {
  ASSEMBLY_ACTIONS,
  REFERENCE_SHAPES,
  TECHNIQUE_TAGS,
  type AssemblyAction,
  type MeasuredTimelinePayload,
  type MeasuredTimelineStepPayload,
  type ReferenceBuildEncoding,
  type ReferenceEncodingStep,
  type ReferenceFrameCandidate,
  type ReferenceVideoSource
} from "@/lib/reference-encoder/types";

const DEFAULT_REFERENCE_URL =
  "https://www.youtube.com/watch?v=WDtC_9se3ds&list=PLtPf1b-JzkN2fqL1G9RK_mGoVttuoNxxG";

export function ReferenceEncoder() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const nextStepIdRef = useRef(0);
  const [url, setUrl] = useState(DEFAULT_REFERENCE_URL);
  const [source, setSource] = useState<ReferenceVideoSource | null>(null);
  const [localVideoFile, setLocalVideoFile] = useState<File | null>(null);
  const [localVideoUrl, setLocalVideoUrl] = useState<string | null>(null);
  const [steps, setSteps] = useState<ReferenceEncodingStep[]>([]);
  const [techniques, setTechniques] = useState<string[]>([
    "build flat, then fold",
    "make a subassembly",
    "adjust angle for magnet alignment"
  ]);
  const [timestamp, setTimestamp] = useState("00:00");
  const [action, setAction] = useState<AssemblyAction>("build-subassembly");
  const [title, setTitle] = useState("Build a flat subassembly");
  const [notes, setNotes] = useState("");
  const [subassemblyId, setSubassemblyId] = useState("body");
  const [tileCountNote, setTileCountNote] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isDrafting, setIsDrafting] = useState(false);
  const [isCollectingFrames, setIsCollectingFrames] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftNote, setDraftNote] = useState<string | null>(null);
  const [reviewerNotes, setReviewerNotes] = useState(
    "Look for flat subassemblies, folds, small magnet-alignment nudges, and balance checks."
  );
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [draftModel, setDraftModel] = useState<DraftModelId>(
    DEFAULT_DRAFT_MODEL_CONFIG.model
  );
  const [reasoningEffort, setReasoningEffort] = useState<DraftReasoningEffort>(
    DEFAULT_DRAFT_MODEL_CONFIG.reasoningEffort
  );
  const [apiKeyOverride, setApiKeyOverride] = useState("");
  const [videoStartSeconds, setVideoStartSeconds] = useState(0);
  const [sampleFrames, setSampleFrames] = useState(true);
  const [frameSampleCount, setFrameSampleCount] = useState(8);
  const [candidateFrameCount, setCandidateFrameCount] = useState(24);
  const [introSkipTimestamp, setIntroSkipTimestamp] = useState("00:11");
  const [billOfMaterialsTimestamp, setBillOfMaterialsTimestamp] = useState("00:11");
  const [frameCandidates, setFrameCandidates] = useState<ReferenceFrameCandidate[]>([]);
  const [measuredTimeline, setMeasuredTimeline] = useState<MeasuredTimelinePayload | null>(null);
  const [isIngesting, setIsIngesting] = useState(false);
  const [ingestNote, setIngestNote] = useState<string | null>(null);
  const [draftSummaries, setDraftSummaries] = useState<BuildDraftSummary[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState("");
  const [gateVerdict, setGateVerdict] = useState<
    | (ReconstructionGateResult & { draftId: string; draftTitle: string })
    | null
  >(null);
  const [isGating, setIsGating] = useState(false);

  const encoding = useMemo<ReferenceBuildEncoding | null>(() => {
    if (!source) return null;

    return {
      source,
      status: "draft",
      buildLabel: source.title.replace(/^Magna-Tiles Idea:\s*/i, ""),
      observedTechniques: techniques,
      steps
    };
  }, [source, steps, techniques]);

  const exportJson = encoding ? JSON.stringify(encoding, null, 2) : "";
  const isLocalVideo = source?.providerName === "Local file";

  useEffect(() => {
    return () => {
      if (localVideoUrl) URL.revokeObjectURL(localVideoUrl);
    };
  }, [localVideoUrl]);

  async function loadVideo() {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/reference-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url })
      });

      if (!response.ok) {
        const body = (await response.json()) as { detail?: string };
        throw new Error(body.detail ?? "Unable to load that video.");
      }

      const body = (await response.json()) as { source: ReferenceVideoSource };
      setLocalVideoFile(null);
      setLocalVideoUrl(null);
      setSource(body.source);
      setSteps([]);
      setFrameCandidates([]);
      setMeasuredTimeline(null);
      setIngestNote(null);
      setGateVerdict(null);
      setDraftNote("Video loaded. Add watcher notes, then ask the app to draft the first pass.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setIsLoading(false);
    }
  }

  function loadLocalVideo(file: File | null) {
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    setLocalVideoFile(file);
    setLocalVideoUrl(objectUrl);
    setSource({
      url: `local:${file.name}`,
      videoId: `local-${Date.now()}`,
      embedUrl: "",
      title: file.name,
      authorName: "Local video",
      authorUrl: "",
      thumbnailUrl: "",
      providerName: "Local file"
    });
    setSteps([]);
    setFrameCandidates([]);
    setMeasuredTimeline(null);
    setIngestNote(null);
    setGateVerdict(null);
    setVideoStartSeconds(0);
    setDraftNote("Local video loaded. Collect frames from the file, review them, then draft.");
    setError(null);
  }

  async function draftEncoding() {
    if (!source) return;
    setIsDrafting(true);
    setError(null);
    setDraftNote(null);
    const selectedFrames = sampleFrames
      ? frameCandidates.filter((frame) => frame.selectedByDefault)
      : [];
    const introSkipSeconds = timestampToSeconds(introSkipTimestamp);
    const billOfMaterialsSeconds = optionalTimestampToSeconds(billOfMaterialsTimestamp);
    try {
      const response = await fetch("/api/draft-reference-encoding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source,
          reviewerNotes,
          model: draftModel,
          reasoningEffort,
          apiKeyOverride: apiKeyOverride.trim() || undefined,
          sampleFrames,
          frameSampleCount,
          selectedFrames: selectedFrames.length ? selectedFrames : undefined,
          introSkipSeconds,
          billOfMaterialsSeconds
        })
      });

      if (!response.ok) {
        const body = (await response.json()) as { detail?: string };
        throw new Error(body.detail ?? "Unable to draft an encoding.");
      }

      const body = (await response.json()) as {
        encoding: ReferenceBuildEncoding;
        draftSource: "model" | "heuristic";
        modelConfig: {
          model: DraftModelId;
          reasoningEffort: DraftReasoningEffort;
        };
        note: string;
        frameSampling: null | {
          count: number;
          timestamps: string[];
          note: string;
        };
      };
      setSteps(body.encoding.steps);
      setTechniques(body.encoding.observedTechniques);
      setDraftNote(
        [
          `${body.draftSource === "model" ? "Model" : "Heuristic"} draft: ${body.note}`,
          body.frameSampling
            ? `Sampled frames: ${body.frameSampling.timestamps.join(", ")}`
            : null
        ]
          .filter(Boolean)
          .join(" ")
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setIsDrafting(false);
    }
  }

  async function collectFrameCandidates() {
    if (!source) return;
    setIsCollectingFrames(true);
    setError(null);
    setDraftNote(null);
    const introSkipSeconds = timestampToSeconds(introSkipTimestamp);
    const billOfMaterialsSeconds = optionalTimestampToSeconds(billOfMaterialsTimestamp);
    try {
      const response =
        isLocalVideo && localVideoFile
          ? await fetch("/api/reference-file-frames", {
              method: "POST",
              body: toLocalFrameFormData(localVideoFile, {
                candidateCount: candidateFrameCount,
                selectedCount: frameSampleCount,
                introSkipSeconds,
                billOfMaterialsSeconds
              })
            })
          : await fetch("/api/reference-frames", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                source,
                candidateCount: candidateFrameCount,
                selectedCount: frameSampleCount,
                introSkipSeconds,
                billOfMaterialsSeconds
              })
            });

      if (!response.ok) {
        const body = (await response.json()) as { detail?: string };
        throw new Error(body.detail ?? "Unable to collect frame candidates.");
      }

      const body = (await response.json()) as {
        frames: ReferenceFrameCandidate[];
        note: string;
      };
      setFrameCandidates(body.frames);
      setDraftNote(body.note);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setIsCollectingFrames(false);
    }
  }

  function addStep() {
    const tileCounts = parseTileCountNote(tileCountNote);
    nextStepIdRef.current += 1;
    const nextStep: ReferenceEncodingStep = {
      id: editingStepId ?? `step-${nextStepIdRef.current}`,
      timestamp,
      action,
      title: title.trim() || actionLabel(action),
      notes: notes.trim(),
      subassemblyId: subassemblyId.trim() || undefined,
      tileCounts,
      learnedTechnique: techniqueForAction(action)
    };

    setSteps((current) =>
      editingStepId
        ? current.map((step) => (step.id === editingStepId ? nextStep : step))
        : [...current, nextStep]
    );
    clearStepForm();
  }

  function editStep(step: ReferenceEncodingStep) {
    setEditingStepId(step.id);
    setTimestamp(step.timestamp);
    setAction(step.action);
    setTitle(step.title);
    setNotes(step.notes);
    setSubassemblyId(step.subassemblyId ?? "");
    setTileCountNote(formatTileCounts(step.tileCounts));
  }

  function seekToStep(step: ReferenceEncodingStep) {
    const seconds = timestampToSeconds(step.timestamp);
    setVideoStartSeconds(seconds);
    seekLocalVideo(seconds);
    editStep(step);
  }

  function seekToFrame(frame: ReferenceFrameCandidate) {
    setVideoStartSeconds(frame.seconds);
    seekLocalVideo(frame.seconds);
    setTimestamp(frame.timestamp);
  }

  function seekLocalVideo(seconds: number) {
    if (!videoRef.current) return;
    videoRef.current.currentTime = seconds;
    videoRef.current.pause();
  }

  function removeStep(stepId: string) {
    setSteps((current) => current.filter((step) => step.id !== stepId));
    if (editingStepId === stepId) clearStepForm();
  }

  function clearStepForm() {
    setEditingStepId(null);
    setTimestamp("");
    setTitle("");
    setNotes("");
    setSubassemblyId("body");
    setTileCountNote("");
  }

  function toggleTechnique(technique: string) {
    setTechniques((current) =>
      current.includes(technique)
        ? current.filter((item) => item !== technique)
        : [...current, technique]
    );
  }

  function toggleFrameCandidate(seconds: number) {
    setFrameCandidates((current) =>
      current.map((frame) =>
        frame.seconds === seconds
          ? { ...frame, selectedByDefault: !frame.selectedByDefault }
          : frame
      )
    );
  }

  function selectTopFrameCandidates() {
    const selectedSeconds = new Set(
      [...frameCandidates]
        .sort((a, b) => b.priorityScore - a.priorityScore)
        .slice(0, frameSampleCount)
        .map((frame) => frame.seconds)
    );
    setFrameCandidates((current) =>
      current.map((frame) => ({
        ...frame,
        selectedByDefault: selectedSeconds.has(frame.seconds)
      }))
    );
  }

  async function ingestMeasuredTimeline(force = false) {
    if (!source || isLocalVideo) return;
    setIsIngesting(true);
    setError(null);
    setIngestNote(
      "Ingesting locally: yt-dlp download → ffprobe → ffmpeg frames → deterministic motion segmentation. First run can take a few minutes."
    );
    try {
      const response = await fetch("/api/reference-ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: source.url, force })
      });

      if (!response.ok) {
        const body = (await response.json()) as { detail?: string };
        throw new Error(body.detail ?? "Unable to ingest the video locally.");
      }

      const body = (await response.json()) as {
        timeline: MeasuredTimelinePayload;
        note: string;
      };
      setMeasuredTimeline(body.timeline);
      setIngestNote(body.note);
    } catch (caught) {
      setIngestNote(null);
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setIsIngesting(false);
    }
  }

  function adoptMeasuredSteps() {
    if (!measuredTimeline) return;
    setSteps(stepsFromMeasuredTimeline(measuredTimeline));
    setDraftNote(
      "Adopted all measured steps (deterministic, no model). Map each one to the real attach action and review flagged steps."
    );
  }

  function addMeasuredStep(measuredStep: MeasuredTimelineStepPayload) {
    setSteps((current) => {
      if (current.some((step) => step.id === `measured-${measuredStep.index}`)) return current;
      return [...current, measuredStepToEncodingStep(measuredStep, current.length + 1)];
    });
  }

  function toggleMeasuredReview(stepId: string) {
    setSteps((current) =>
      current.map((step) =>
        step.id === stepId && step.measured
          ? {
              ...step,
              measured: { ...step.measured, humanAccepted: !step.measured.humanAccepted }
            }
          : step
      )
    );
  }

  async function refreshDraftSummaries() {
    try {
      const response = await fetch("/api/build-drafts");
      if (!response.ok) throw new Error("Unable to list saved build drafts.");
      const body = (await response.json()) as { drafts: BuildDraftSummary[] };
      setDraftSummaries(body.drafts);
      if (body.drafts.length && !body.drafts.some((draft) => draft.id === selectedDraftId)) {
        setSelectedDraftId(body.drafts[0].id);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    }
  }

  async function gateReconstructionNow() {
    if (!encoding || !selectedDraftId) return;
    setIsGating(true);
    setError(null);
    setGateVerdict(null);
    try {
      const response = await fetch("/api/reference-reconstruction-gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: selectedDraftId, encoding })
      });

      if (!response.ok) {
        const body = (await response.json()) as { detail?: string };
        throw new Error(body.detail ?? "Unable to gate the reconstruction.");
      }

      const body = (await response.json()) as {
        result: ReconstructionGateResult;
        draftId: string;
        draftTitle: string;
      };
      setGateVerdict({ ...body.result, draftId: body.draftId, draftTitle: body.draftTitle });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setIsGating(false);
    }
  }

  const selectedFrameCount = frameCandidates.filter((frame) => frame.selectedByDefault).length;
  const flaggedMeasuredSteps = steps.filter(
    (step) => step.measured?.needsHumanReview && !step.measured.humanAccepted
  ).length;

  return (
    <details className="reference-section panel secondary-details">
      <summary className="reference-summary">
        <div>
          <h2 className="section-title">
            <Video size={17} />
            Reference build encoder
          </h2>
          <p className="muted">
            Turn real build videos into structured examples: subassemblies, folds, braces, adjustments, and balance checks.
          </p>
        </div>
        <span className="pill warn">encoder tool</span>
      </summary>

      <div className="reference-grid">
        <div className="reference-left">
          <div className="url-row">
            <input
              aria-label="YouTube reference URL"
              className="text-input"
              onChange={(event) => setUrl(event.target.value)}
              placeholder="Paste a YouTube build video URL"
              value={url}
            />
            <button className="primary-button compact" disabled={isLoading} onClick={loadVideo}>
              <WandSparkles size={16} />
              {isLoading ? "Loading" : "Load"}
            </button>
          </div>
          <label className="local-file-row">
            <span>Or use a downloaded video file</span>
            <input
              accept="video/*"
              onChange={(event) => loadLocalVideo(event.target.files?.[0] ?? null)}
              type="file"
            />
          </label>
          {error ? <p className="issue-detail">{error}</p> : null}

          <div className="video-frame">
            {isLocalVideo && localVideoUrl ? (
              <video ref={videoRef} controls src={localVideoUrl} />
            ) : source ? (
              <iframe
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                src={`${source.embedUrl}?start=${videoStartSeconds}&autoplay=${videoStartSeconds > 0 ? 1 : 0}`}
                title={source.title}
              />
            ) : (
              <div className="empty-state tight">
                <Video size={32} />
                <strong>Load a video to start encoding.</strong>
                <span className="muted">Use timestamps to capture construction moves as you watch.</span>
              </div>
            )}
          </div>

          {source ? (
            <div className="source-card">
              {source.thumbnailUrl ? (
                <img alt="" src={source.thumbnailUrl} />
              ) : (
                <div className="local-video-badge">
                  <Video size={22} />
                </div>
              )}
              <div>
                <strong>{source.title}</strong>
                <span className="muted">{source.authorName}</span>
              </div>
            </div>
          ) : null}

          <div className="draft-card">
            <h3 className="section-title">
              <Bot size={16} />
              First-pass draft
            </h3>
            <label>
              <span>Model</span>
              <select
                className="text-input"
                onChange={(event) => setDraftModel(event.target.value as DraftModelId)}
                value={draftModel}
              >
                {DRAFT_MODEL_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Reasoning</span>
              <select
                className="text-input"
                onChange={(event) =>
                  setReasoningEffort(event.target.value as DraftReasoningEffort)
                }
                value={reasoningEffort}
              >
                {DRAFT_REASONING_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Frame grounding</span>
              <button
                className={`toggle-button ${sampleFrames ? "selected" : ""}`}
                onClick={() => setSampleFrames((current) => !current)}
                type="button"
              >
                {sampleFrames ? "Use selected frames" : "Frames off"}
              </button>
            </label>
            <label>
              <span>Auto-picks</span>
              <input
                className="text-input"
                disabled={!sampleFrames}
                max={32}
                min={1}
                onChange={(event) => setFrameSampleCount(Number(event.target.value))}
                type="number"
                value={frameSampleCount}
              />
            </label>
            <label>
              <span>Candidate frames</span>
              <input
                className="text-input"
                disabled={!sampleFrames}
                max={64}
                min={4}
                onChange={(event) => setCandidateFrameCount(Number(event.target.value))}
                type="number"
                value={candidateFrameCount}
              />
            </label>
            <label>
              <span>Skip before</span>
              <input
                className="text-input"
                disabled={!sampleFrames}
                onChange={(event) => setIntroSkipTimestamp(event.target.value)}
                placeholder="00:11"
                value={introSkipTimestamp}
              />
            </label>
            <label>
              <span>Bill of materials</span>
              <input
                className="text-input"
                disabled={!sampleFrames}
                onChange={(event) => setBillOfMaterialsTimestamp(event.target.value)}
                placeholder="00:11"
                value={billOfMaterialsTimestamp}
              />
            </label>
            <button
              className="secondary-button"
              disabled={!source || !sampleFrames || isCollectingFrames}
              onClick={collectFrameCandidates}
              type="button"
            >
              <Images size={16} />
              {isCollectingFrames ? "Collecting" : "Collect frames"}
            </button>
            {sampleFrames ? (
              <p className="issue-detail wide-field">
                {frameCandidates.length
                  ? `${selectedFrameCount} of ${frameCandidates.length} frames selected for the draft.`
                  : "Collect more candidates than the model will see, then review the useful moments."}
              </p>
            ) : null}
            {frameCandidates.length ? (
              <div className="frame-review wide-field">
                <div className="frame-review-header">
                  <strong>Frame review</strong>
                  <button className="link-button" onClick={selectTopFrameCandidates} type="button">
                    Select top scores
                  </button>
                </div>
                <div className="frame-strip">
                  {frameCandidates.map((frame) => (
                    <div
                      className={`frame-card ${frame.selectedByDefault ? "selected" : ""}`}
                      key={`${frame.seconds}-${frame.timestamp}`}
                    >
                      <button
                        className="frame-thumb"
                        onClick={() => seekToFrame(frame)}
                        title="Jump video to this frame"
                        type="button"
                      >
                        <img alt={`Frame at ${frame.timestamp}`} src={frame.dataUrl} />
                      </button>
                      <div className="frame-card-meta">
                        <button
                          className="timeline-time seek-button"
                          onClick={() => seekToFrame(frame)}
                          type="button"
                        >
                          {frame.timestamp}
                        </button>
                        <span>{frame.priorityScore}</span>
                      </div>
                      <span className="frame-reason">
                        {frame.landmarkRole === "bill-of-materials"
                          ? "bill of materials"
                          : frame.selectionReason}
                      </span>
                      <button
                        className={`toggle-button frame-toggle ${frame.selectedByDefault ? "selected" : ""}`}
                        onClick={() => toggleFrameCandidate(frame.seconds)}
                        type="button"
                      >
                        {frame.selectedByDefault ? (
                          <>
                            <Check size={14} /> Selected
                          </>
                        ) : (
                          "Use frame"
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <label className="wide-field">
              <span>Temporary API key for local testing</span>
              <input
                autoComplete="off"
                className="text-input"
                onChange={(event) => setApiKeyOverride(event.target.value)}
                placeholder="Optional. Production should use OPENAI_API_KEY."
                type="password"
                value={apiKeyOverride}
              />
            </label>
            <label className="wide-field">
              <span>Watcher notes for the draft</span>
              <textarea
                className="text-area compact-area"
                onChange={(event) => setReviewerNotes(event.target.value)}
                placeholder="What should the model pay attention to while drafting?"
                value={reviewerNotes}
              />
            </label>
            <button
              className="primary-button wide-field"
              disabled={!source || isDrafting || isCollectingFrames}
              onClick={draftEncoding}
              type="button"
            >
              <Bot size={16} />
              {isDrafting
                ? "Drafting"
                : frameCandidates.length
                  ? "Draft from selected frames"
                  : "Draft timeline"}
            </button>
            {draftNote ? <p className="issue-detail wide-field">{draftNote}</p> : null}
          </div>

          <div className="draft-card">
            <h3 className="section-title">
              <Activity size={16} />
              Measured timeline (local ingestion)
            </h3>
            <p className="issue-detail wide-field">
              Downloads the video locally (yt-dlp, ≤720p), extracts frames with ffmpeg, and splits
              the build into motion vs stable spans with deterministic frame differencing. Every
              candidate step carries a real silhouette measured from the pixels — no model guesses.
              Artifacts stay in the gitignored .video-cache folder.
            </p>
            <button
              className="secondary-button wide-field"
              disabled={!source || isLocalVideo || isIngesting}
              onClick={() => ingestMeasuredTimeline(false)}
              type="button"
            >
              <Activity size={16} />
              {isIngesting ? "Ingesting (this can take minutes)" : "Ingest video + measure steps"}
            </button>
            {isLocalVideo ? (
              <p className="issue-detail wide-field">
                Measured ingestion needs the YouTube URL; load the video by URL to use it.
              </p>
            ) : null}
            {ingestNote ? <p className="issue-detail wide-field">{ingestNote}</p> : null}
            {measuredTimeline ? (
              <div className="frame-review wide-field">
                <div className="frame-review-header">
                  <strong>
                    {measuredTimeline.steps.filter((step) => !step.baseline).length} measured steps
                    · {measuredTimeline.analysisFrameCount} frames @ {measuredTimeline.analysisFps}{" "}
                    fps
                  </strong>
                  <button className="link-button" onClick={adoptMeasuredSteps} type="button">
                    Adopt all as timeline
                  </button>
                </div>
                <div className="frame-strip">
                  {measuredTimeline.steps.map((step) => (
                    <div
                      className={`frame-card ${step.needsHumanReview ? "needs-review" : ""}`}
                      key={step.index}
                    >
                      <button
                        className="frame-thumb"
                        onClick={() => {
                          setVideoStartSeconds(Math.floor(step.representativeSeconds));
                          setTimestamp(secondsToTimestamp(step.representativeSeconds));
                        }}
                        title="Jump video to this measured step"
                        type="button"
                      >
                        <img
                          alt={`Measured step at ${secondsToTimestamp(step.representativeSeconds)}`}
                          src={step.representativeFrameDataUrl}
                        />
                      </button>
                      <img
                        alt="Foreground silhouette evidence"
                        className="measured-mask"
                        src={step.silhouetteDataUrl}
                        title="Silhouette vs first stable frame (white = foreground)"
                      />
                      <div className="frame-card-meta">
                        <span>
                          {secondsToTimestamp(step.startSeconds)}–
                          {secondsToTimestamp(step.endSeconds)}
                        </span>
                        <span>{Math.round(step.confidence * 100)}%</span>
                      </div>
                      <span className="frame-reason">
                        {step.baseline
                          ? "baseline (background reference)"
                          : `stable ${step.stabilitySeconds.toFixed(1)}s · fg ${(step.foregroundRatio * 100).toFixed(1)}%`}
                      </span>
                      {step.needsHumanReview ? (
                        <span className="pill warn measured-flag">needs human review</span>
                      ) : null}
                      {!step.baseline ? (
                        <button
                          className="toggle-button frame-toggle"
                          onClick={() => addMeasuredStep(step)}
                          type="button"
                        >
                          <Plus size={14} /> Add as step
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="reference-mid">
          <h3 className="section-title">
            <Plus size={16} />
            Encode action
          </h3>
          <div className="encoder-form">
            <label>
              <span>Timestamp</span>
              <input
                className="text-input"
                onChange={(event) => setTimestamp(event.target.value)}
                placeholder="01:24"
                value={timestamp}
              />
            </label>
            <label>
              <span>Action</span>
              <select
                className="text-input"
                onChange={(event) => setAction(event.target.value as AssemblyAction)}
                value={action}
              >
                {ASSEMBLY_ACTIONS.map((item) => (
                  <option key={item} value={item}>
                    {actionLabel(item)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Subassembly</span>
              <input
                className="text-input"
                onChange={(event) => setSubassemblyId(event.target.value)}
                placeholder="wing, body, roof"
                value={subassemblyId}
              />
            </label>
            <label>
              <span>Tile counts</span>
              <input
                className="text-input"
                onChange={(event) => setTileCountNote(event.target.value)}
                placeholder="small-square:4, right-triangle:2"
                value={tileCountNote}
              />
            </label>
            <label className="wide-field">
              <span>Title</span>
              <input
                className="text-input"
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Fold the wing panel upward"
                value={title}
              />
            </label>
            <label className="wide-field">
              <span>Notes</span>
              <textarea
                className="text-area compact-area"
                onChange={(event) => setNotes(event.target.value)}
                placeholder="What changes? Which edge is the hinge? What alignment or balance trick matters?"
                value={notes}
              />
            </label>
            <button className="primary-button wide-field" disabled={!source} onClick={addStep}>
              <Plus size={16} />
              {editingStepId ? "Save encoded step" : "Add encoded step"}
            </button>
            {editingStepId ? (
              <button className="secondary-button wide-field" onClick={clearStepForm} type="button">
                Cancel edit
              </button>
            ) : null}
          </div>

          <h3 className="section-title">
            <Clipboard size={16} />
            Technique tags
          </h3>
          <div className="technique-grid">
            {TECHNIQUE_TAGS.map((technique) => (
              <button
                className={`technique-chip ${techniques.includes(technique) ? "selected" : ""}`}
                key={technique}
                onClick={() => toggleTechnique(technique)}
                type="button"
              >
                {technique}
              </button>
            ))}
          </div>
        </div>

        <div className="reference-right">
          <h3 className="section-title">
            <Clock size={16} />
            Encoded timeline
          </h3>
          <div className="timeline-list">
            {steps.length ? (
              steps.map((step, index) => (
                <div className="timeline-item" key={step.id}>
                  <div className="timeline-controls">
                    <button
                      className="timeline-time seek-button"
                      onClick={() => seekToStep(step)}
                      type="button"
                    >
                      {step.timestamp || `step ${index + 1}`}
                    </button>
                    <button className="link-button" onClick={() => editStep(step)} type="button">
                      Edit
                    </button>
                    <button className="link-button danger" onClick={() => removeStep(step.id)} type="button">
                      Remove
                    </button>
                  </div>
                  <strong>{step.title}</strong>
                  <span className="muted">
                    {actionLabel(step.action)}
                    {step.subassemblyId ? ` • ${step.subassemblyId}` : ""}
                  </span>
                  {step.tileCounts ? (
                    <span className="piece-counts">
                      {formatTileCountsForDisplay(step.tileCounts)}
                      {step.pieceEstimateConfidence ? ` • ${step.pieceEstimateConfidence}` : ""}
                    </span>
                  ) : null}
                  {step.measured ? (
                    <div className="measured-evidence">
                      {step.measured.representativeFrameDataUrl ? (
                        <img
                          alt={`Measured frame for ${step.title}`}
                          src={step.measured.representativeFrameDataUrl}
                        />
                      ) : null}
                      {step.measured.silhouetteDataUrl ? (
                        <img
                          alt="Silhouette evidence"
                          className="measured-mask"
                          src={step.measured.silhouetteDataUrl}
                          title="Background-subtraction silhouette (white = foreground)"
                        />
                      ) : null}
                      <div className="measured-evidence-meta">
                        <span className="muted">
                          measured · confidence {Math.round(step.measured.confidence * 100)}% ·
                          stable {step.measured.stabilitySeconds.toFixed(1)}s
                        </span>
                        {step.measured.needsHumanReview ? (
                          <span
                            className={`pill ${step.measured.humanAccepted ? "" : "warn"} measured-flag`}
                          >
                            {step.measured.humanAccepted ? "human reviewed" : "needs human review"}
                          </span>
                        ) : null}
                        {step.measured.needsHumanReview ? (
                          <button
                            className="link-button"
                            onClick={() => toggleMeasuredReview(step.id)}
                            type="button"
                          >
                            {step.measured.humanAccepted ? "Unmark review" : "Mark reviewed"}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  <p>{step.notes}</p>
                </div>
              ))
            ) : (
              <div className="timeline-item">
                <strong>No encoded actions yet</strong>
                <p>Load a video, then capture the real construction moves that matter.</p>
              </div>
            )}
          </div>

          <h3 className="section-title">
            <ShieldCheck size={16} />
            Buildability gate
          </h3>
          <div className="gate-panel">
            <p className="issue-detail">
              An accepted reconstruction is only &quot;buildable&quot; when every flagged step has
              been human-reviewed and the build authored from this timeline passes the engine gate
              (no overlap, valid magnetic joints, stands under simulation). The gate is law; it is
              never widened to make a build pass.
            </p>
            {flaggedMeasuredSteps > 0 ? (
              <p className="issue-detail">
                {flaggedMeasuredSteps} measured step(s) still need human review before this
                timeline can gate as buildable.
              </p>
            ) : null}
            <div className="url-row">
              <select
                aria-label="Saved build draft to gate"
                className="text-input"
                onChange={(event) => setSelectedDraftId(event.target.value)}
                onFocus={() => {
                  if (!draftSummaries.length) void refreshDraftSummaries();
                }}
                value={selectedDraftId}
              >
                <option value="">Choose a saved build draft…</option>
                {draftSummaries.map((draft) => (
                  <option key={draft.id} value={draft.id}>
                    {draft.title} ({draft.tileCount} tiles, {draft.status})
                  </option>
                ))}
              </select>
              <button
                className="secondary-button compact"
                onClick={refreshDraftSummaries}
                type="button"
              >
                Refresh
              </button>
            </div>
            <button
              className="primary-button"
              disabled={!encoding || !steps.length || !selectedDraftId || isGating}
              onClick={gateReconstructionNow}
              type="button"
            >
              <ShieldCheck size={16} />
              {isGating ? "Gating against engine" : "Gate reconstruction"}
            </button>
            {gateVerdict ? (
              <div
                className={`gate-verdict ${gateVerdict.buildable ? "gate-pass" : "gate-fail"}`}
              >
                <strong>
                  {gateVerdict.buildable
                    ? `Buildable: "${gateVerdict.draftTitle}" passes the engine gate with a review-complete timeline.`
                    : `Not buildable yet: "${gateVerdict.draftTitle}" did not clear the bar.`}
                </strong>
                <ul>
                  {gateVerdict.reasons.map((reason, index) => (
                    <li key={index}>{reason}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          <details className="json-details">
            <summary>Reference JSON</summary>
            <pre className="json-export">{exportJson || "Load a video to create a reference encoding."}</pre>
          </details>
        </div>
      </div>
    </details>
  );
}

function toLocalFrameFormData(
  file: File,
  options: {
    candidateCount: number;
    selectedCount: number;
    introSkipSeconds: number;
    billOfMaterialsSeconds?: number;
  }
): FormData {
  const formData = new FormData();
  formData.append("video", file);
  formData.append("candidateCount", String(options.candidateCount));
  formData.append("selectedCount", String(options.selectedCount));
  formData.append("introSkipSeconds", String(options.introSkipSeconds));
  if (options.billOfMaterialsSeconds !== undefined) {
    formData.append("billOfMaterialsSeconds", String(options.billOfMaterialsSeconds));
  }
  return formData;
}

function actionLabel(action: AssemblyAction): string {
  return action
    .split("-")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function techniqueForAction(action: AssemblyAction): string | undefined {
  switch (action) {
    case "build-subassembly":
      return "make a subassembly";
    case "fold":
    case "rotate":
      return "build flat, then fold";
    case "brace":
      return "brace with side returns";
    case "adjust":
      return "adjust angle for magnet alignment";
    case "balance-check":
      return "widen base for balance";
    default:
      return undefined;
  }
}

function parseTileCountNote(note: string): ReferenceEncodingStep["tileCounts"] {
  if (!note.trim()) return undefined;
  const counts: ReferenceEncodingStep["tileCounts"] = {};

  note.split(",").forEach((part) => {
    const [rawShape, rawCount] = part.split(":").map((value) => value?.trim());
    if (!rawShape || !rawCount) return;
    if (!REFERENCE_SHAPES.includes(rawShape as (typeof REFERENCE_SHAPES)[number])) return;
    const count = Number(rawCount);
    if (!Number.isFinite(count) || count <= 0) return;
    counts[rawShape as (typeof REFERENCE_SHAPES)[number]] = count;
  });

  return Object.keys(counts).length ? counts : undefined;
}

function formatTileCounts(tileCounts: ReferenceEncodingStep["tileCounts"]): string {
  if (!tileCounts) return "";

  return Object.entries(tileCounts)
    .map(([shape, count]) => `${shape}:${count}`)
    .join(", ");
}

function formatTileCountsForDisplay(tileCounts: ReferenceEncodingStep["tileCounts"]): string {
  if (!tileCounts) return "";

  return Object.entries(tileCounts)
    .filter(([, count]) => Number(count) > 0)
    .map(([shape, count]) => `${shortShapeLabel(shape)} ${count}`)
    .join(" · ") || "no new pieces";
}

function shortShapeLabel(shape: string): string {
  switch (shape) {
    case "small-square":
      return "sq";
    case "large-square":
      return "lg";
    case "equilateral-triangle":
      return "eq tri";
    case "right-triangle":
      return "rt tri";
    case "isosceles-triangle":
      return "iso tri";
    default:
      return shape;
  }
}

function timestampToSeconds(timestamp: string): number {
  const parts = timestamp
    .trim()
    .split(":")
    .map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part) || part < 0)) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

function optionalTimestampToSeconds(timestamp: string): number | undefined {
  return timestamp.trim() ? timestampToSeconds(timestamp) : undefined;
}
