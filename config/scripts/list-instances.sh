#!/usr/bin/env bash
# list-instances.sh
# Outputs a JSON array of {name, subdomain} objects from $INSTANCES_DIR
# Subdomain is read from the instance .env; falls back to name if not set.
# Excludes the "template" folder.

set -euo pipefail

INSTANCES_DIR="${INSTANCES_DIR:-/instances}"

if [ ! -d "$INSTANCES_DIR" ]; then
  echo "[]"
  exit 0
fi

entries=()
while IFS= read -r entry; do
  if [ -d "$INSTANCES_DIR/$entry" ] && [ "$entry" != "template" ] && [[ "$entry" != .* ]]; then
    entries+=("$entry")
  fi
done < <(ls -1 "$INSTANCES_DIR" 2>/dev/null)

json="["
first=true
for name in "${entries[@]+"${entries[@]}"}"; do
  # Read SUBDOMAIN from instance .env, fall back to name
  subdomain="$name"
  env_file="$INSTANCES_DIR/$name/.env"
  if [ -f "$env_file" ]; then
    val=$(grep -m1 '^SUBDOMAIN=' "$env_file" | cut -d= -f2- | tr -d '[:space:]')
    [ -n "$val" ] && subdomain="$val"
  fi

  if [ "$first" = true ]; then first=false; else json+=","; fi
  json+="{\"name\":\"${name}\",\"subdomain\":\"${subdomain}\"}"
done
json+="]"

echo "$json"
