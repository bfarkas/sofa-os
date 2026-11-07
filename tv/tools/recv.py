#!/usr/bin/env python3
"""Receives log lines POSTed by the Sofa Home skeleton and prints/appends them. Accepts the TV's IP only.
   tv/tools/recv.py            (binds to this Mac's LAN IP, port 8099; log goes to tv/out/tv.log)"""
import http.server, os, subprocess, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
TV = os.environ.get("TV_IP", "192.168.42.54")
BIND = os.environ.get("BIND_IP") or subprocess.check_output(["ipconfig", "getifaddr", "en0"], text=True).strip()
LOG = os.path.join(HERE, "..", "out", "tv.log")

class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        if self.client_address[0] != TV:
            self.send_error(403); return
        body = self.rfile.read(min(int(self.headers.get("Content-Length", 0)), 4000)).decode("utf-8", "replace")
        line = "%s %s" % (time.strftime("%H:%M:%S"), body)
        print(line, flush=True)
        with open(LOG, "a") as f: f.write(line + "\n")
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*"); self.end_headers()
    def do_OPTIONS(self):
        self.send_response(204)
        for k, v in (("Access-Control-Allow-Origin", "*"), ("Access-Control-Allow-Headers", "*"), ("Access-Control-Allow-Methods", "POST")): self.send_header(k, v)
        self.end_headers()
    def log_message(self, *a): pass

os.makedirs(os.path.dirname(LOG), exist_ok=True)
print("listening on %s:8099, accepting %s" % (BIND, TV), file=sys.stderr)
http.server.ThreadingHTTPServer((BIND, 8099), H).serve_forever()
