#!/usr/bin/env python3
import http.server
import socketserver
import urllib.request
import urllib.parse
import os

PORT = 8080
API_PORT = 3001
DIST_DIR = os.path.join(os.path.dirname(__file__), 'dist')

class ProxyHTTPHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/api/'):
            proxy_url = f'http://127.0.0.1:{API_PORT}{self.path}'
            try:
                req = urllib.request.urlopen(proxy_url, timeout=10)
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(req.read())
                return
            except Exception as e:
                self.send_response(502)
                self.end_headers()
                self.wfile.write(f'Proxy error: {e}'.encode())
                return
        return super().do_GET()
    
    def do_POST(self):
        if self.path.startswith('/api/'):
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length) if content_length > 0 else b''
            proxy_url = f'http://127.0.0.1:{API_PORT}{self.path}'
            try:
                req = urllib.request.Request(proxy_url, data=body, method='POST')
                req.add_header('Content-Type', 'application/json')
                req.add_header('Access-Control-Allow-Origin', '*')
                resp = urllib.request.urlopen(req, timeout=10)
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(resp.read())
                return
            except Exception as e:
                self.send_response(502)
                self.end_headers()
                self.wfile.write(f'Proxy error: {e}'.encode())
                return
        self.send_response(404)
        self.end_headers()
    
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
    
    def translate_path(self, path):
        if path == '/':
            path = '/index.html'
        return os.path.join(DIST_DIR, path.lstrip('/'))

os.chdir(DIST_DIR)
with socketserver.TCPServer(('', PORT), ProxyHTTPHandler) as httpd:
    print(f'Proxy server running on port {PORT}')
    httpd.serve_forever()
