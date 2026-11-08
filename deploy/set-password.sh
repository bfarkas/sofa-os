#!/usr/bin/env bash
# Sets or changes the Companion password, then restarts the Server. Run on rei3:
#   ssh -t rei3.local ~/sofa-os/deploy/set-password.sh
set -euo pipefail
cd "$(dirname "$0")"
dir="$HOME/.config/sofa-os/secrets"
mkdir -p "$dir" && chmod 700 "$dir"
read -rsp "New Companion password: " pw; echo
read -rsp "Again: " again; echo
[ "$pw" = "$again" ] || { echo "The passwords differ." >&2; exit 1; }
docker compose build -q
umask 077
printf '%s\n' "$pw" | docker run --rm -i sofa-os-server:latest node server/src/hash-password.ts > "$dir/companion_password_hash.new"
mv "$dir/companion_password_hash.new" "$dir/companion_password_hash"
docker compose up -d --force-recreate
echo "Password set. Open https://sofa.familie-farkas.de"
