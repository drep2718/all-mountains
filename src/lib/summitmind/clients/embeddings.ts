/**
 * Text embeddings via Voyage AI (Anthropic's recommended embedding partner —
 * no separate OpenAI account needed). Plumbing only: same model must be used
 * here and in scripts/summitmind/ingest-trail-context.ts, or similarity
 * search silently returns garbage (different models don't share a vector
 * space). voyage-3 = 1024 dims — keep VECTOR_SIZE in clients/qdrant.ts in sync
 * if you change it.
 *
 * https://docs.voyageai.com/docs/embeddings
 */

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";

export async function embedText(text: string, inputType: "query" | "document"): Promise<number[]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error("Missing VOYAGE_API_KEY in .env.local");

  const res = await fetch(VOYAGE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input: [text], model: "voyage-3", input_type: inputType }),
  });

  if (!res.ok) {
    throw new Error(`Voyage embeddings request failed: ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  return json.data[0].embedding;
}
