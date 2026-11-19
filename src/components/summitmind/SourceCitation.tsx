import type { Source } from "@/lib/summitmind/types";

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const hours = Math.round(ms / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Every hazard claim in the UI should be wrapped in one of these — staleness visible, never hidden. */
export default function SourceCitation({ source }: { source: Source }) {
  const chip = (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-1 text-xs text-ink-muted">
      <span className="font-medium text-ink">{source.label}</span>
      <span aria-hidden>·</span>
      <span>{timeAgo(source.retrievedAt)}</span>
    </span>
  );

  return source.url ? (
    <a href={source.url} target="_blank" rel="noopener noreferrer" className="hover:opacity-80">
      {chip}
    </a>
  ) : (
    chip
  );
}
