"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/peak-types";

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [radiusKm, setRadiusKm] = useState(100);
  const [message, setMessage] = useState("");
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(false);
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (cancelled) return;
        if (authError && authError.name !== "AuthSessionMissingError") throw authError;
        if (!user) { router.replace("/login"); return; }
        const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).single();
        if (error) throw error;
        if (cancelled) return;
        const p = data as Profile;
        setProfile(p);
        setDisplayName(p.display_name || "");
        setUsername(p.username || "");
        setBio(p.bio || "");
        setRadiusKm(p.search_radius_km ?? 100);
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [supabase, router, attempt]);

  const handleSave = async () => {
    if (!profile) return;
    setSaving(true);
    setMessage("");
    try {
      const { data, error } = await supabase.from("profiles").update({
        display_name: displayName.trim(), username: username.trim() || null,
        bio: bio.trim() || null, search_radius_km: radiusKm,
        updated_at: new Date().toISOString(),
      }).eq("id", profile.id).select().single();
      if (error) throw error;
      setProfile(data as Profile);
      setMessage("Profile saved!");
    } catch (e) {
      setMessage(`Error: ${e instanceof Error ? e.message : "Couldn’t save your profile. Please try again."}`);
    } finally { setSaving(false); }
  };

  const handleSetHomeLocation = () => {
    if (!navigator.geolocation || !profile) { setMessage("Error: Location isn't available on this device."); return; }
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        const { data, error } = await supabase.from("profiles").update({
          home_latitude: pos.coords.latitude, home_longitude: pos.coords.longitude,
        }).eq("id", profile.id).select().single();
        if (error) throw error;
        setProfile(data as Profile);
        setMessage("Home location set!");
      } catch { setMessage("Error: Couldn’t save your home location. Please try again."); }
    }, () => setMessage("Error: Couldn’t access your location. Check location permissions."), { timeout: 15000 });
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-700 border-t-alpine-500" />
      </div>
    );
  }

  if (loadError) return (
    <div role="alert" className="mx-auto max-w-xl px-4 py-24 text-center text-ink">
      <p>Couldn’t load your profile. Check your connection and try again.</p>
      <button onClick={() => setAttempt((n) => n + 1)} className="mt-4 font-semibold text-pine-600 underline">Retry</button>
    </div>
  );
  if (!profile) return null;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-3xl font-bold text-slate-100">Profile</h1>
      <p className="mt-2 text-slate-400">Manage your account settings</p>

      <div className="mt-8 space-y-6 rounded-2xl border border-slate-800 bg-slate-900 p-6">
        {/* Avatar */}
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-800 text-2xl">
            {profile.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt=""
                className="h-full w-full rounded-full object-cover"
              />
            ) : (
              "⛰"
            )}
          </div>
          <div>
            <div className="font-semibold text-slate-100">
              {profile.display_name || "Unnamed Climber"}
            </div>
            <div className="text-sm text-slate-400">
              {profile.username ? `@${profile.username}` : "No username set"}
            </div>
          </div>
        </div>

        {/* Fields */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-300">
            Display Name
          </label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-slate-100 outline-none focus:border-alpine-500"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-300">
            Username
          </label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="mountaineer42"
            className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-slate-100 outline-none focus:border-alpine-500"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-300">
            Bio
          </label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={3}
            placeholder="Tell us about your mountain adventures..."
            className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-slate-100 outline-none focus:border-alpine-500"
          />
        </div>

        <div>
          <label className="flex items-center justify-between text-sm font-medium text-slate-300">
            <span>Default Search Radius</span>
            <span className="text-alpine-600">{radiusKm}km</span>
          </label>
          <input
            type="range"
            min={10}
            max={500}
            step={10}
            value={radiusKm}
            onChange={(e) => setRadiusKm(Number(e.target.value))}
            className="mt-2 w-full accent-alpine-500"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-300">
            Home Location
          </label>
          <button
            onClick={handleSetHomeLocation}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-800"
          >
            📍 Use Current Location
          </button>
          {profile.home_latitude != null && (
            <span className="ml-3 text-sm text-slate-500">
              {profile.home_latitude.toFixed(2)}, {profile.home_longitude?.toFixed(2)}
            </span>
          )}
        </div>

        {message && (
          <p className={`rounded-lg px-3 py-2 text-sm ${
            message.startsWith("Error")
              ? "bg-diff-extreme/10 text-diff-extreme"
              : "bg-alpine-500/10 text-alpine-600"
          }`}>
            {message}
          </p>
        )}

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full rounded-xl bg-alpine-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-alpine-500 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </div>
  );
}
