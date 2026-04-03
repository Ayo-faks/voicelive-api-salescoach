#!/usr/bin/env bash

set -euo pipefail

base_url="${1:-https://staging-sen.wulo.ai}"
tmp_dir="$(mktemp -d)"
html_file="$tmp_dir/index.html"

cleanup() {
  rm -rf "$tmp_dir"
}

trap cleanup EXIT

markers=(
  "Session analysis"
  "Review summary"
  "Next-session plan"
  "Focus sounds"
)

echo "Fetching staging HTML from $base_url"
curl -A 'Mozilla/5.0' -L -fsS "$base_url/" -o "$html_file"

mapfile -t bundle_paths < <(grep -oE 'src="/?(static/)?js/[^"]+\.js"' "$html_file" | sed -E 's/^src="//; s/"$//' | sed -E 's#^/#/#' | head -20)

if [[ ${#bundle_paths[@]} -eq 0 ]]; then
  echo "No static JS bundles found in staging HTML"
  exit 1
fi

echo "Found ${#bundle_paths[@]} bundle references"

for bundle_path in "${bundle_paths[@]}"; do
  bundle_url="${base_url%/}${bundle_path}"
  bundle_file="$tmp_dir/$(basename "$bundle_path")"
  echo "Checking $bundle_url"
  curl -A 'Mozilla/5.0' -L -fsS "$bundle_url" -o "$bundle_file"

  matched=0
  missing=()
  for marker in "${markers[@]}"; do
    if grep -Fq "$marker" "$bundle_file"; then
      echo "Verified marker: $marker"
      matched=$((matched + 1))
    else
      missing+=("$marker")
    fi
  done

  if [[ $matched -ge 3 ]]; then
    echo "Staging dashboard bundle verification passed"
    exit 0
  fi

  echo "Missing markers for $bundle_url: ${missing[*]}"
done

echo "Staging dashboard bundle verification failed"
echo "Expected markers: ${markers[*]}"
exit 1