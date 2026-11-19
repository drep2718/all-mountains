"use client";

import { useState } from "react";
import MessageList, { type ChatMessage } from "./MessageList";

interface Props {
  /** Current map focus or selected peak — where "here" means for the agent's weather/hazard lookups. */
  lat: number;
  lon: number;
}

/**
 * Chat surface for SummitMind. Pure plumbing — talks to /api/summitmind/chat
 * and renders what comes back. No hazard logic lives here; if the graph
 * isn't wired up yet (graph/index.ts still throws), this will show that
 * error as a normal chat bubble, which is a fine way to smoke-test wiring.
 */
export default function ChatPanel({ lat, lon }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  async function sendMessage() {
    const query = input.trim();
    if (!query || loading) return;

    setMessages((prev) => [...prev, { role: "user", text: query }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/summitmind/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, lat, lon }),
      });
      const data = await res.json();

      if (!res.ok) {
        setMessages((prev) => [...prev, { role: "error", text: data.error ?? "Something went wrong." }]);
        return;
      }

      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: data.response, sources: data.sources, ledWithWarning: data.ledWithWarning },
      ]);
    } catch {
      setMessages((prev) => [...prev, { role: "error", text: "Couldn't reach SummitMind — check your connection." }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-full flex-col rounded-2xl border border-border bg-ground">
      <div className="border-b border-border px-4 py-3">
        <h2 className="font-display text-lg font-bold text-ink">SummitMind</h2>
        <p className="text-xs text-ink-muted">Grounded trip planning — every hazard claim is cited.</p>
      </div>

      {messages.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-ink-muted">
          Ask about conditions, a route, or a hazard check for where you&rsquo;re looking on the map.
        </div>
      ) : (
        <MessageList messages={messages} />
      )}

      <div className="flex items-center gap-2 border-t border-border p-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          placeholder="Plan a route, or ask about conditions…"
          disabled={loading}
          className="flex-1 rounded-full border border-border bg-surface-2 px-4 py-2 text-sm text-ink outline-none focus:border-pine-500 disabled:opacity-60"
        />
        <button
          onClick={sendMessage}
          disabled={loading || !input.trim()}
          className="rounded-full bg-pine-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {loading ? "…" : "Ask"}
        </button>
      </div>
    </div>
  );
}
