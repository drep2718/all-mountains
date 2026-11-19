import SourceCitation from "./SourceCitation";
import type { Source } from "@/lib/summitmind/types";

export interface ChatMessage {
  role: "user" | "assistant" | "error";
  text: string;
  sources?: Source[];
  ledWithWarning?: boolean;
}

export default function MessageList({ messages }: { messages: ChatMessage[] }) {
  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
      {messages.map((m, i) => (
        <div
          key={i}
          className={
            m.role === "user"
              ? "ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-pine-500 px-4 py-2.5 text-sm text-white"
              : m.role === "error"
                ? "max-w-[85%] rounded-2xl border border-red-300 bg-red-50 px-4 py-2.5 text-sm text-red-800"
                : `max-w-[90%] rounded-2xl rounded-bl-sm border px-4 py-2.5 text-sm text-ink ${
                    m.ledWithWarning ? "border-amber-400 bg-amber-50" : "border-border bg-ground"
                  }`
          }
        >
          {m.ledWithWarning && m.role === "assistant" && (
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-amber-700">
              Read this before you go
            </div>
          )}
          <p className="whitespace-pre-wrap leading-relaxed">{m.text}</p>
          {m.sources && m.sources.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {m.sources.map((s, j) => (
                <SourceCitation key={j} source={s} />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
