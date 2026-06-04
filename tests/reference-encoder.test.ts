import { describe, expect, it } from "vitest";
import {
  buildYouTubeEmbedUrl,
  buildYouTubeWatchUrl,
  extractYouTubeVideoId
} from "@/lib/reference-encoder/youtube";

describe("YouTube reference parsing", () => {
  it("extracts a video id from a standard YouTube URL with playlist params", () => {
    expect(
      extractYouTubeVideoId(
        "https://www.youtube.com/watch?v=WDtC_9se3ds&list=PLtPf1b-JzkN2fqL1G9RK_mGoVttuoNxxG"
      )
    ).toBe("WDtC_9se3ds");
  });

  it("extracts a video id from a short YouTube URL", () => {
    expect(extractYouTubeVideoId("https://youtu.be/WDtC_9se3ds")).toBe("WDtC_9se3ds");
  });

  it("rejects unsupported URLs", () => {
    expect(extractYouTubeVideoId("https://example.com/watch?v=WDtC_9se3ds")).toBeNull();
  });

  it("builds canonical watch and embed URLs", () => {
    expect(buildYouTubeWatchUrl("WDtC_9se3ds")).toBe(
      "https://www.youtube.com/watch?v=WDtC_9se3ds"
    );
    expect(buildYouTubeEmbedUrl("WDtC_9se3ds")).toBe(
      "https://www.youtube.com/embed/WDtC_9se3ds"
    );
  });
});
