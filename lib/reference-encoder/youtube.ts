import type { ReferenceVideoSource } from "./types";

interface YouTubeOEmbedResponse {
  title: string;
  author_name: string;
  author_url: string;
  provider_name: string;
  thumbnail_url: string;
}

export function extractYouTubeVideoId(input: string): string | null {
  try {
    const url = new URL(input.trim());
    if (url.hostname === "youtu.be") {
      return normalizeVideoId(url.pathname.slice(1));
    }

    if (url.hostname.includes("youtube.com")) {
      return normalizeVideoId(url.searchParams.get("v") ?? "");
    }
  } catch {
    return null;
  }

  return null;
}

export function buildYouTubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function buildYouTubeEmbedUrl(videoId: string): string {
  return `https://www.youtube.com/embed/${videoId}`;
}

export async function fetchYouTubeReference(url: string): Promise<ReferenceVideoSource> {
  const videoId = extractYouTubeVideoId(url);
  if (!videoId) {
    throw new Error("Enter a valid YouTube video URL.");
  }

  const watchUrl = buildYouTubeWatchUrl(videoId);
  const response = await fetch(
    `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`
  );

  if (!response.ok) {
    throw new Error("Could not fetch YouTube metadata for that video.");
  }

  const metadata = (await response.json()) as YouTubeOEmbedResponse;

  return {
    url: watchUrl,
    videoId,
    embedUrl: buildYouTubeEmbedUrl(videoId),
    title: metadata.title,
    authorName: metadata.author_name,
    authorUrl: metadata.author_url,
    thumbnailUrl: metadata.thumbnail_url,
    providerName: metadata.provider_name
  };
}

function normalizeVideoId(value: string): string | null {
  const trimmed = value.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  return null;
}
