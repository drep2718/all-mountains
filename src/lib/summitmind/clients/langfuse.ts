/**
 * Langfuse tracing — wraps a single graph run so every node's input/output
 * shows up as a step in one trace. This is what lets you (or anyone) click
 * into a bad answer and see exactly which source fed it.
 *
 * No-ops cleanly if keys aren't set (summitMindConfig.langfuse.enabled),
 * so this works before Phase 8's self-hosted Langfuse is even deployed —
 * point it at cloud Langfuse locally, swap the base URL later.
 */

import { Langfuse } from "langfuse";
import { summitMindConfig } from "../config";

let client: Langfuse | null = null;

function getClient(): Langfuse | null {
  if (!summitMindConfig.langfuse.enabled) return null;
  if (!client) {
    client = new Langfuse({
      publicKey: summitMindConfig.langfuse.publicKey!,
      secretKey: summitMindConfig.langfuse.secretKey!,
      baseUrl: summitMindConfig.langfuse.baseUrl,
    });
  }
  return client;
}

/** Call once per user request; pass the returned trace into each node so nodes can log their own step. */
export function startTrace(name: string, input: unknown) {
  const langfuse = getClient();
  if (!langfuse) return null;
  return langfuse.trace({ name, input: input as Record<string, unknown> });
}
