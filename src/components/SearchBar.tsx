"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Compact global search box. Submits to the unified /search page, which searches
// peaks and trails together. Used in the desktop top nav and the mobile top bar.
export default function SearchBar({ className = "" }: { className?: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const query = q.trim();
    if (query) router.push(`/search?q=${encodeURIComponent(query)}`);
    else router.push("/search");
  }

  return (
    <form onSubmit={submit} className={`relative ${className}`}>
      <svg
        className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={2}
        stroke="currentColor"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.2-5.2m0 0A7.5 7.5 0 105.2 5.2a7.5 7.5 0 0010.6 10.6z" />
      </svg>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search peaks & trails"
        aria-label="Search peaks and trails"
        className="w-full rounded-full border border-transparent bg-surface-2 py-2.5 pl-10 pr-4 text-sm text-ink placeholder:text-ink-faint transition-colors hover:bg-surface-3/70 focus:border-pine-500 focus:bg-surface focus:outline-none focus:ring-4 focus:ring-pine-500/15"
      />
    </form>
  );
}
