#!/bin/bash
# Build the static GitHub Pages demo into docs/.
# Requires the Flask server running on localhost:5050 (it renders index.html).
# The demo runs entirely client-side: coin tap and motion work locally,
# ratings/stats don't persist (they need the real server).
set -euo pipefail
cd "$(dirname "$0")/.."

# macOS occasionally fails rm -rf on freshly-written trees (Spotlight
# holding files); retry a couple of times before giving up
for attempt in 1 2 3; do
  rm -rf docs 2>/dev/null && break
  sleep 1
done
[ -e docs ] && { echo "could not clear docs/"; exit 1; }
mkdir -p docs/api

# 1. static assets (audio, art, fonts, css, js)
cp -R software/static docs/static

# 2. rendered page, with a STATIC_DEMO flag injected before app.js
curl -sf http://localhost:5050/ -o docs/index.html
sed -i '' 's|/static/|static/|g' docs/index.html
sed -i '' 's|<script src="static/app.js">|<script>window.STATIC_DEMO=true</script><script src="static/app.js">|' docs/index.html

# 3. the two GET endpoints the frontend needs, as plain files
cp software/jokes.json docs/api/jokes
cat > docs/api/session-context << 'JSON'
{"ratings": {}, "recent": {}, "settings": {"volume": 1.0, "free_play": false, "disabled_jokes": [], "disabled_categories": []}}
JSON

# 4. keep GitHub Pages from running Jekyll over it
touch docs/.nojekyll

echo "docs/ built: $(du -sh docs | cut -f1)"
