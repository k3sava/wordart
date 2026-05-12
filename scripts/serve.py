#!/usr/bin/env python3
# Dev server that disables HTTP caching so file edits show up on a plain reload.
import http.server, socketserver, sys, os

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8766

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
with socketserver.TCPServer(('', PORT), NoCacheHandler) as httpd:
    print(f'wordart dev server on http://localhost:{PORT}/  (no cache)')
    httpd.serve_forever()
