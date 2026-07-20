#!/bin/zsh
# One-shot Vercel setup: link project, add env vars, connect GitHub CI/CD, deploy.
# Prereq: run `npx vercel login` once first (browser click), then: ./deploy.sh
set -e
cd "$(dirname "$0")"

echo "==> Linking project to Vercel..."
npx vercel link --yes

echo "==> Adding environment variables (from .env.local)..."
# Only the public keys — the service-role key stays local (scripts only).
grep NEXT_PUBLIC_SUPABASE_URL .env.local | cut -d= -f2- | npx vercel env add NEXT_PUBLIC_SUPABASE_URL production || true
grep NEXT_PUBLIC_SUPABASE_ANON_KEY .env.local | cut -d= -f2- | npx vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production || true
grep NEXT_PUBLIC_MAPBOX_TOKEN .env.local | cut -d= -f2- | npx vercel env add NEXT_PUBLIC_MAPBOX_TOKEN production || true

echo "==> Connecting GitHub repo (CI/CD: every push to main auto-deploys)..."
npx vercel git connect https://github.com/drep2718/all-mountains || true

echo "==> Production deploy..."
npx vercel --prod

echo ""
echo "DONE. Your live URL is printed above."
echo "Last step (so Google sign-in works on the live site):"
echo "  1. Supabase -> Authentication -> URL Configuration: add the URL to Site URL + Redirect URLs"
echo "  2. Google Cloud -> Credentials -> OAuth client: add the URL to Authorized JavaScript origins"
