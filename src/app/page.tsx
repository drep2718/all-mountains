import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  // Signed-in users skip the marketing page and go straight to the map
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/explore");

  return <Landing />;
}

function Landing() {
  return (
    <div className="relative flex min-h-screen flex-col">
      {/* Hero section with background image */}
      <div className="absolute inset-0 -top-16">
        <div
          className="h-full w-full bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: "url('/hero.jpg')" }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-slate-950/60 via-slate-950/40 to-slate-950" />
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 text-center">
        <div className="mb-4 flex items-center gap-2 rounded-full border border-slate-700/50 bg-slate-900/50 px-4 py-1.5 text-sm text-slate-300 backdrop-blur-sm">
          <span className="h-2 w-2 rounded-full bg-alpine-500" />
          134,000+ peaks · 2,400+ trails
        </div>

        <h1 className="max-w-4xl font-display text-5xl font-bold leading-tight tracking-tight sm:text-7xl">
          Every Mountain.{" "}
          <span className="bg-gradient-to-r from-alpine-400 to-summit-400 bg-clip-text text-transparent">
            One App.
          </span>
        </h1>

        <p className="mt-6 max-w-2xl text-lg text-slate-400 sm:text-xl">
          Find your next summit, see the trails that reach it, and keep a
          logbook of every climb — across the US, Canada, the Alps, and Japan.
        </p>

        <div className="mt-10 flex flex-col gap-4 sm:flex-row">
          <Link
            href="/explore"
            className="rounded-xl bg-alpine-600 px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-alpine-600/25 transition-all hover:bg-alpine-500 hover:shadow-alpine-500/30"
          >
            Explore the Map
          </Link>
          <Link
            href="/peaks"
            className="rounded-xl border border-slate-700 bg-slate-900/50 px-8 py-3.5 text-base font-semibold text-slate-200 backdrop-blur-sm transition-all hover:border-slate-600 hover:bg-slate-800/80"
          >
            Browse Peaks
          </Link>
        </div>

        {/* Stats bar */}
        <div className="mt-20 grid grid-cols-3 gap-8 sm:gap-16">
          {[
            { value: "134K+", label: "Peaks" },
            { value: "2,400+", label: "Trails" },
            { value: "Free", label: "Forever" },
          ].map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="text-2xl font-bold text-alpine-600 sm:text-3xl">
                {stat.value}
              </div>
              <div className="mt-1 text-sm text-slate-500">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Feature cards */}
      <div className="relative z-10 mx-auto w-full max-w-6xl px-4 pb-20">
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            {
              icon: "🗺️",
              title: "Interactive Map",
              desc: "Explore peaks on a 3D terrain map. Pan anywhere and see every peak and trail around you.",
            },
            {
              icon: "📔",
              title: "Summit Logbook",
              desc: "Log every climb with photos, stats, and notes. Track your elevation gained and peaks bagged.",
            },
            {
              icon: "🏔️",
              title: "Peak Details",
              desc: "Elevation, prominence, difficulty, photos, and Wikipedia info for every peak — plus the trails that reach them.",
            },
          ].map((feature) => (
            <div
              key={feature.title}
              className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 backdrop-blur-sm transition-colors hover:border-slate-700"
            >
              <div className="mb-3 text-3xl">{feature.icon}</div>
              <h3 className="text-lg font-semibold text-slate-100">
                {feature.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">
                {feature.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
