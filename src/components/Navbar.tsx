"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import SearchBar from "./SearchBar";

const navItems = [
  { href: "/explore", label: "Explore", icon: MapIcon },
  { href: "/peaks", label: "Peaks", icon: MountainIcon },
  { href: "/routes", label: "Trails", icon: TrailIcon },
  { href: "/record", label: "Record", icon: RecordIcon },
  { href: "/lists", label: "Lists", icon: HeartIcon },
  { href: "/profile", label: "Profile", icon: UserIcon },
];

// Secondary destinations — desktop nav only, to keep the mobile tab bar to six.
const secondaryItems = [
  { href: "/activities", label: "Activities" },
  { href: "/downloads", label: "Downloads" },
  { href: "/logbook", label: "Logbook" },
];

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUser(user));
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => setUser(session?.user ?? null)
    );
    return () => subscription.unsubscribe();
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/");
  };

  // The full-bleed map on /explore has its own location search, so the mobile
  // top search bar is suppressed there to keep the map edge-to-edge.
  const showMobileSearch = !pathname.startsWith("/explore");

  return (
    <>
      {/* Mobile top search bar — in normal flow (sticky) so it reserves its own
          space and pushes page content down; hidden on desktop and on /explore. */}
      {showMobileSearch && (
        <div className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/85 px-3 py-2 backdrop-blur-xl md:hidden pt-[max(0.5rem,env(safe-area-inset-top))]">
          <SearchBar />
        </div>
      )}

      {/* Desktop top nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 hidden border-b border-slate-800 bg-slate-950/80 backdrop-blur-xl md:block">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
          <Link href="/" className="flex shrink-0 items-center gap-2">
            <span className="text-2xl">⛰</span>
            <span className="font-display text-lg font-bold tracking-tight text-ink">
              All Mountains
            </span>
          </Link>

          <SearchBar className="mx-4 w-full max-w-xs" />

          <div className="flex items-center gap-1">
            {navItems.map(({ href, label, icon: Icon }) => {
              const active = pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ${
                    active
                      ? "bg-alpine-500/10 text-alpine-600"
                      : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{label}</span>
                </Link>
              );
            })}
          </div>

          <div className="flex items-center gap-3">
            {secondaryItems.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={`hidden text-sm font-medium transition-colors lg:block ${
                  pathname.startsWith(href)
                    ? "text-alpine-600"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {label}
              </Link>
            ))}
            {user ? (
              <button
                onClick={handleSignOut}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
              >
                Sign Out
              </button>
            ) : (
              <Link
                href="/login"
                className="rounded-lg bg-alpine-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-alpine-500"
              >
                Sign In
              </Link>
            )}
          </div>
        </div>
      </nav>

      {/* Mobile bottom tab bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-slate-800 bg-slate-950/95 backdrop-blur-xl md:hidden pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-stretch justify-around">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors ${
                  active ? "text-alpine-600" : "text-slate-500"
                }`}
              >
                <Icon className="h-5 w-5" />
                <span>{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}

function MapIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" />
    </svg>
  );
}

function RecordIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function MountainIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 20l5.5-11L12 14l3-6 6 12H3z" />
    </svg>
  );
}

function TrailIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v1.5M3 21v-6m0 0l2.77-.693a9 9 0 016.208.682l.108.054a9 9 0 006.086.71l3.114-.732a48.524 48.524 0 01-.005-10.499l-3.11.732a9 9 0 01-6.085-.711l-.108-.054a9 9 0 00-6.208-.682L3 4.5M3 15V4.5" />
    </svg>
  );
}

function HeartIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
    </svg>
  );
}

function BookIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
    </svg>
  );
}

function UserIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
    </svg>
  );
}
