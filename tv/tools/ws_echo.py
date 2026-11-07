#!/usr/bin/env python3
"""Throwaway WebSocket echo for Session 02 (stdlib only). Binds to 127.0.0.1:8099; Caddy proxies /echo to it.
   Echoes text frames, answers pings, closes cleanly. Run `ws_echo.py --selftest` to check it."""
import base64, hashlib, socketserver, struct, sys, threading

GUID = b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

def read_exact(sock, n):
    buf = b""
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk: raise EOFError
        buf += chunk
    return buf

def send_frame(sock, opcode, payload):
    n = len(payload)
    head = bytes([0x80 | opcode]) + (bytes([n]) if n < 126 else b"\x7e" + struct.pack(">H", n) if n < 65536 else b"\x7f" + struct.pack(">Q", n))
    sock.sendall(head + payload)

def read_frame(sock):
    b1, b2 = read_exact(sock, 2)
    n = b2 & 0x7F
    if n == 126: n = struct.unpack(">H", read_exact(sock, 2))[0]
    elif n == 127: n = struct.unpack(">Q", read_exact(sock, 8))[0]
    mask = read_exact(sock, 4) if b2 & 0x80 else b"\0\0\0\0"
    data = bytearray(read_exact(sock, n))
    for i in range(n): data[i] ^= mask[i % 4]
    return b1 & 0x0F, bytes(data)

class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        s = self.request
        raw = b""
        while b"\r\n\r\n" not in raw:
            chunk = s.recv(4096)
            if not chunk: return
            raw += chunk
        headers = {l.split(b":", 1)[0].strip().lower(): l.split(b":", 1)[1].strip() for l in raw.split(b"\r\n")[1:] if b":" in l}
        key = headers.get(b"sec-websocket-key")
        if not key:
            s.sendall(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n"); return
        accept = base64.b64encode(hashlib.sha1(key + GUID).digest())
        s.sendall(b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + b"\r\n\r\n")
        try:
            while True:
                op, data = read_frame(s)
                if op == 0x8: send_frame(s, 0x8, b""); return
                if op == 0x9: send_frame(s, 0xA, data)
                elif op in (0x1, 0x2): send_frame(s, op, data)
        except (EOFError, OSError):
            return

class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

def selftest():
    import socket
    srv = Server(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    c = socket.create_connection(srv.server_address)
    c.sendall(b"GET /echo HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n")
    resp = b""
    while b"\r\n\r\n" not in resp: resp += c.recv(1024)
    assert b"s3pPLMBiTxaQ9kYGzzhZRbK+xOo=" in resp, resp  # RFC 6455 example accept value
    c.sendall(bytes([0x81, 0x80 | 5]) + b"\0\0\0\0" + b"hello")
    assert read_frame(c) == (1, b"hello")
    print("selftest ok")

if __name__ == "__main__":
    if "--selftest" in sys.argv: selftest()
    else: Server(("127.0.0.1", 8099), Handler).serve_forever()
