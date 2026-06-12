import {
  createOpenAiAskClient,
  createOpenAiPictureClient,
  createOpenAiQuicklogClient,
  createOpenAiReviewClient,
  type FetchLike,
} from "./openai";
import type {
  AskClient,
  PictureClient,
  QuicklogParseClient,
  ReviewClient,
} from "./types";

// The single gate in front of the provider (invariant #6). A missing key
// resolves HERE, before any provider code could run — callers get a disabled
// marker, never a client that might call out.

export type AskClientResult =
  | { ok: true; client: AskClient }
  | { ok: false; reason: "no-key" };

export function getAskClient(opts: {
  apiKey: string | undefined;
  fetchImpl?: FetchLike;
}): AskClientResult {
  if (!opts.apiKey) return { ok: false, reason: "no-key" };
  return {
    ok: true,
    client: createOpenAiAskClient({
      apiKey: opts.apiKey,
      fetchImpl: opts.fetchImpl,
    }),
  };
}

// Same gate for the review analyst: a missing key resolves here, and
// the caller falls back to a deterministic-only review — the scheduled
// cadence never depends on the provider being reachable.
export type ReviewClientResult =
  | { ok: true; client: ReviewClient }
  | { ok: false; reason: "no-key" };

export function getReviewClient(opts: {
  apiKey: string | undefined;
  fetchImpl?: FetchLike;
}): ReviewClientResult {
  if (!opts.apiKey) return { ok: false, reason: "no-key" };
  return {
    ok: true,
    client: createOpenAiReviewClient({
      apiKey: opts.apiKey,
      fetchImpl: opts.fetchImpl,
    }),
  };
}

// Same gate for the picture (the standing reassurance narrative): a missing
// key resolves here, and the caller falls back to the deterministic floor —
// the page never depends on the provider being reachable.
export type PictureClientResult =
  | { ok: true; client: PictureClient }
  | { ok: false; reason: "no-key" };

export function getPictureClient(opts: {
  apiKey: string | undefined;
  fetchImpl?: FetchLike;
}): PictureClientResult {
  if (!opts.apiKey) return { ok: false, reason: "no-key" };
  return {
    ok: true,
    client: createOpenAiPictureClient({
      apiKey: opts.apiKey,
      fetchImpl: opts.fetchImpl,
    }),
  };
}

// Same gate for the natural-language quick-log parser: a missing key resolves
// here, and /log quietly shows the manual forms only — input never depends on
// the provider.
export type QuicklogClientResult =
  | { ok: true; client: QuicklogParseClient }
  | { ok: false; reason: "no-key" };

export function getQuicklogClient(opts: {
  apiKey: string | undefined;
  fetchImpl?: FetchLike;
}): QuicklogClientResult {
  if (!opts.apiKey) return { ok: false, reason: "no-key" };
  return {
    ok: true,
    client: createOpenAiQuicklogClient({
      apiKey: opts.apiKey,
      fetchImpl: opts.fetchImpl,
    }),
  };
}
