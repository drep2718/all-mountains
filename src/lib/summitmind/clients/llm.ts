/**
 * Anthropic client — thin wrapper, same singleton pattern as qdrant.ts.
 * Swap models via ANTHROPIC_MODEL in .env.local, no code change needed.
 */

import Anthropic from "@anthropic-ai/sdk";
import { summitMindConfig } from "../config";

let client: Anthropic | null = null;

export function getLLMClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: summitMindConfig.anthropic.apiKey });
  }
  return client;
}

export const DEFAULT_MODEL = summitMindConfig.anthropic.model;
