#!/bin/zsh
# Generate all app icons from public/hero.jpg (your mountain photo),
# then commit + push (auto-deploys via Vercel).
# Usage: put the photo at public/hero.jpg, then run: ./scripts/make-icons.sh
set -e
cd "$(dirname "$0")/.."

if [ ! -f public/hero.jpg ]; then
  echo "❌ public/hero.jpg not found. Save your mountain photo there first."
  exit 1
fi

echo "==> Generating icons from public/hero.jpg..."
# Scale so the short side is 512, then center-crop a 512x512 square
sips -s format png --resampleHeight 512 public/hero.jpg --out /tmp/icon-base.png >/dev/null
sips -c 512 512 /tmp/icon-base.png --out public/icon-512.png >/dev/null
sips -z 192 192 public/icon-512.png --out public/icon-192.png >/dev/null
sips -z 180 180 public/icon-512.png --out public/apple-touch-icon.png >/dev/null
rm -f /tmp/icon-base.png
echo "    icon-512.png, icon-192.png, apple-touch-icon.png created"

echo "==> Committing and pushing (Vercel auto-deploys)..."
git add public/hero.jpg public/icon-512.png public/icon-192.png public/apple-touch-icon.png
git commit -m "Add mountain photo app icons

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push

echo ""
echo "✅ Done. In ~1 min the deploy finishes. Then on your iPhone:"
echo "   remove the old home-screen icon and re-add the site —"
echo "   iOS caches the icon, so re-adding is required to see the photo."
