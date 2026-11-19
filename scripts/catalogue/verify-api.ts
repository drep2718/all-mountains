/**
 * Read-only runtime schema checks (typechecking cannot catch PostgREST drift).
 * npx tsx --env-file=.env.local scripts/catalogue/verify-api.ts
 *
 * --exercise-account additionally creates a disposable, confirmed example.com
 * identity without sending email, verifies account CRUD/RLS, then removes that
 * identity and its test records. Service-role credentials stay in this script.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
assert(url && anon, "Missing public Supabase configuration");
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const db = createClient(url, anon, options);

async function check(name: string, query: PromiseLike<{ error: { message: string } | null; data: unknown }>) {
  const result = await query;
  assert.equal(result.error, null, `${name}: ${result.error?.message}`);
  console.log(`PASS ${name}`);
  return result.data;
}

async function accountChecks() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert(serviceKey, "--exercise-account requires the scripts-only service-role key");
  const admin = createClient(url, serviceKey, options);
  const email = `catalogue-qa-${randomUUID()}@example.com`;
  const password = randomUUID() + randomUUID();
  let userId: string | undefined;
  try {
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.equal(created.error, null, `Test identity: ${created.error?.message}`);
    userId = created.data.user!.id;
    const user = createClient(url, anon, options);
    const signed = await user.auth.signInWithPassword({ email, password });
    assert.equal(signed.error, null, `Password sign-in: ${signed.error?.message}`);
    console.log("PASS confirmed test identity and password sign-in (no email sent)");
    await check("profile trigger and load", user.from("profiles").select("*").eq("id", userId).single());
    await check("profile edit", user.from("profiles").update({ display_name: "Catalogue QA", bio: "Temporary integration check", search_radius_km: 50 }).eq("id", userId).select().single());
    const list = await check("create private list", user.from("peak_lists").insert({ user_id: userId, name: "Temporary catalogue QA", is_public: false }).select().single()) as { id: number };
    const peak = "mount-whitney-united-states";
    await check("save mountain by slug", user.from("list_items").insert({ list_id: list.id, peak_slug: peak }).select().single());
    const lists = await check("own lists with item counts", user.from("peak_lists").select("*,list_items(count)").eq("user_id", userId)) as { list_items: { count: number }[] }[];
    assert.equal(lists[0].list_items[0].count, 1);
    await check("list detail joined to peak", user.from("list_items").select("*,peak:peaks(*)").eq("list_id", list.id).single());
    const hidden = await check("anonymous private-list isolation", db.from("peak_lists").select("id").eq("id", list.id)) as unknown[];
    assert.equal(hidden.length, 0);
    await check("make test list public", user.from("peak_lists").update({ is_public: true }).eq("id", list.id).select().single());
    const visible = await check("anonymous public-list read", db.from("peak_lists").select("id").eq("id", list.id)) as unknown[];
    assert.equal(visible.length, 1);
    await check("remove saved mountain", user.from("list_items").delete().eq("list_id", list.id));
    await check("delete own test list", user.from("peak_lists").delete().eq("id", list.id));
    const review = await check("save mountain review", user.from("reviews").upsert({ user_id: userId, peak_slug: peak, rating: 4, body: "Temporary integration check", hiked_on: "2026-11-19" }, { onConflict: "user_id,peak_slug" }).select().single()) as { id: number };
    await check("read mountain ratings", user.from("peak_ratings").select("avg_rating,review_count").eq("peak_slug", peak).single());
    await check("delete own test review", user.from("reviews").delete().eq("id", review.id));
    const log = await check("log summit by slug", user.from("summit_logs").insert({ user_id: userId, peak_slug: peak, summited_at: "2026-11-19", is_public: false, notes: "Temporary integration check" }).select().single()) as { id: number };
    await check("logbook joined to peak", user.from("summit_logs").select("*,peak:peaks(*)").eq("user_id", userId).single());
    const privateLogs = await check("anonymous private-log isolation", db.from("summit_logs").select("id").eq("id", log.id)) as unknown[];
    assert.equal(privateLogs.length, 0);
    await check("delete own test summit log", user.from("summit_logs").delete().eq("id", log.id));
    await user.auth.signOut();
  } finally {
    if (userId) {
      const result = await admin.auth.admin.deleteUser(userId);
      assert.equal(result.error, null, `Test identity cleanup: ${result.error?.message}`);
      console.log("PASS removed disposable identity and cascading test records");
    }
  }
}

async function main() {
  const peaks = await check("map RPC signature", db.rpc("peaks_in_bounds", { min_lat: 39, min_lng: -107, max_lat: 40, max_lng: -105, max_rows: 400 })) as { slug: string }[];
  assert(peaks.length > 0, "Colorado viewport unexpectedly empty");
  await check("viewport routes by peak slugs", db.from("routes").select("*").in("peak_slug", peaks.map((p) => p.slug)).limit(100));
  await check("search by current peak columns", db.from("peaks").select("slug,name,elevation_m,route_count,category,prominence_m").ilike("name", "%Rainier%"));
  const routes = () => db.from("routes").select("*,peak:peaks!inner(category,difficulty)");
  await check("route summit ordering", routes().order("is_summit_route", { ascending: false }).order("distance_to_summit_m").order("id").limit(24));
  await check("route difficulty filter", routes().in("peak.difficulty", ["hike"]).limit(1));
  await check("route highpoint filter", routes().eq("peak.category", "highpoint").limit(1));
  await check("route summit filter", routes().eq("is_summit_route", true).limit(1));
  await check("route type and length filters", routes().eq("route_type", "Out & Back").lte("distance_km", 10).limit(1));
  await check("list item count relation", db.from("peak_lists").select("*,list_items(count)").limit(0));
  await check("saved peak relation", db.from("list_items").select("*,peak:peaks(*)").limit(0));
  await check("profile fields", db.from("profiles").select("id,username,display_name,bio,home_latitude,home_longitude,search_radius_km").limit(0));
  await check("summit log relation", db.from("summit_logs").select("*,peak:peaks(*)").limit(0));
  await check("reviews", db.from("reviews").select("id,peak_slug,rating,body,conditions,hiked_on").limit(0));
  if (process.argv.includes("--exercise-account")) await accountChecks();
  console.log("PASS all runtime API checks");
}

void main().catch((e) => { console.error(e instanceof Error ? e.message : "API verification failed"); process.exitCode = 1; });
