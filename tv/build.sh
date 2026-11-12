#!/usr/bin/env bash
# Package and sign Sofa Home with the `hideki` profile, then optionally install on the TV.
#   tv/build.sh            build + sign only
#   tv/build.sh install    build, sign, install on the TV
# Sofa Home signs in by QR code on first start; SOFA_SERVER_URL below is only its default Server address.
# Output: tv/out/SofaHome.wgt (gitignored). Launch it remotely: sdb shell 0 was_execute sofahome01.SofaHome (or tizen run -p sofahome01.SofaHome -t UE55NU8009).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDK="${TIZEN_SDK:-$HOME/tizen-studio}"
PROFILE="${TIZEN_PROFILE:-hideki}"
TV="${TV_ADDRESS:-192.168.42.54:26101}"
APP_ID="sofahome01.SofaHome"
OUT="$HERE/out"
export PATH="$SDK/tools/ide/bin:$SDK/tools:$PATH"

mkdir -p "$OUT"
# Tell the app where tools/recv.py listens (this Mac's LAN IP; LOG_URL= turns it off) and where the Server is.
LOG_URL="${LOG_URL-http://$(ipconfig getifaddr en0):8099/log}"
SOFA_SERVER_URL="${SOFA_SERVER_URL-https://sofa.familie-farkas.de}"
printf "window.SOFA_LOG_URL = '%s';\nwindow.SOFA_SERVER_URL = '%s';\n" "$LOG_URL" "$SOFA_SERVER_URL" > "$HERE/app/env.js"
# Testing the day-cycle background: SOFA_FAKE_HOUR=21 tv/build.sh install pretends it is 21:00 (0 to 23). Unset (the default) uses the clock.
[ -n "${SOFA_FAKE_HOUR-}" ] && printf "window.SOFA_FAKE_HOUR = '%s';\n" "$SOFA_FAKE_HOUR" >> "$HERE/app/env.js"
rm -f "$OUT"/*.wgt "$HERE"/app/.manifest.tmp
npm run build -w tv --prefix "$HERE/.." >/dev/null

tizen package -t wgt -s "$PROFILE" -o "$OUT" -- "$HERE/app"
# The CLI names the file after the app ("Sofa Home.wgt"); some runs write it to the SDK's own out/ instead.
mv "$OUT/Sofa Home.wgt" "$OUT/SofaHome.wgt" 2>/dev/null || mv "$SDK"/tools/ide/bin/out/*.wgt "$OUT/SofaHome.wgt"
rm -f "$HERE"/app/.manifest.tmp

python3 - "$OUT/SofaHome.wgt" "$APP_ID" <<'PY'
import sys, zipfile
import xml.etree.ElementTree as ET
archive, expected = sys.argv[1:3]
with zipfile.ZipFile(archive) as z:
    names = set(z.namelist())
    for need in ("config.xml", "author-signature.xml", "signature1.xml"):
        assert need in names, "missing " + need
    app = ET.fromstring(z.read("config.xml")).find("{http://tizen.org/ns/widgets}application")
assert app.get("id") == expected, "app id %s != %s" % (app.get("id"), expected)
assert app.get("required_version") == "4.0", "required_version is not 4.0"
print("signed ok:", app.get("id"))
PY
shasum -a 256 "$OUT/SofaHome.wgt"

if [ "${1:-}" = "install" ]; then
  sdb connect "$TV" >/dev/null
  tizen install -n "$OUT/SofaHome.wgt" -s "$TV"
  sdb -s "$TV" shell '0 applist' | grep -i sofahome || echo "not listed in applist" >&2
fi
