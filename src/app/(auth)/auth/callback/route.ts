import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// This route handles the OAuth callback from Google.
// After Google authenticates the user, it redirects here with a code.
// We exchange that code for a session, then redirect to the app.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/explore";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
