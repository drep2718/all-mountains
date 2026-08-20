import Link from "next/link";

export const metadata = { title: "Offline — All Mountains" };

export default function OfflinePage() {
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <div className="mb-3 text-5xl">🏔️</div>
      <h1 className="font-display text-2xl font-bold text-ink">You&rsquo;re offline</h1>
      <p className="mt-2 text-sm text-ink-muted">
        This page isn&rsquo;t downloaded. Your saved trails and recorded hikes still work.
      </p>
      <div className="mt-6 flex flex-col gap-2">
        <Link
          href="/downloads"
          className="rounded-xl bg-pine-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-pine-700"
        >
          My downloads
        </Link>
        <Link
          href="/activities"
          className="rounded-xl border border-border bg-surface px-6 py-3 text-sm font-semibold text-ink transition-colors hover:bg-ground"
        >
          My activities
        </Link>
      </div>
    </div>
  );
}
