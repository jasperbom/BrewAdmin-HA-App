#!/usr/bin/env python3
"""
Brouwerij Admin - backend server
Serves the HTML app and stores all data as JSON files in /data/

Supports Home Assistant Ingress: requests arrive with a path prefix like
  /api/hassio_ingress/<TOKEN>/api/data/<key>
The server strips any prefix and looks for /api/data/<key> anywhere in the path.
"""
import base64
import http.server
import io
import json
import os
import re
import time
import urllib.error
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path

DATA_DIR = Path('/data')
STATIC_FILE = Path('/app/static/index.html')
MAX_CONTENT_LENGTH = 10 * 1024 * 1024  # 10 MB — bescherming tegen DoS via grote requests
UPLOAD_DIR = DATA_DIR / 'inkoop_facturen'

DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

API_DATA_PREFIX = '/api/data/'
BF_API_BASE = 'https://api.brewfather.app/v2'
BF_PROXY_PREFIX = '/api/brewfather/'
BF_TEST_PATH = '/api/brewfather/test'

WC_API_PATH    = '/wp-json/wc/v3'
WC_PROXY_PREFIX = '/api/woocommerce/'
WC_PING_PATH    = '/api/woocommerce/ping'
WC_TEST_PATH    = '/api/woocommerce/test'
WC_PUT_PREFIX   = '/api/woocommerce/put/'

UPLOAD_PREFIX            = '/api/upload/'
FILE_PREFIX              = '/api/file/'
DELETE_UPLOAD_PREFIX     = '/api/delete_upload/'
DOWNLOAD_BIJLAGEN_PREFIX = '/api/download_bijlagen/'
CLAUDE_PROXY_PREFIX      = '/api/claude/'
ANTHROPIC_API_BASE       = 'https://api.anthropic.com'
CLAUDE_MAX_CONTENT       = 20 * 1024 * 1024  # 20 MB — PDF + images can be large

HA_PROXY_PREFIX          = '/api/homeassistant/'
HA_SUPERVISOR_BASE       = 'http://supervisor/core/api'

_ALLOWED_EXTENSIONS = {'pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'tiff', 'bmp', 'heic', 'heif'}
_CONTENT_TYPES = {
    'pdf':  'application/pdf',
    'jpg':  'image/jpeg',
    'jpeg': 'image/jpeg',
    'png':  'image/png',
    'gif':  'image/gif',
    'webp': 'image/webp',
    'tiff': 'image/tiff',
    'bmp':  'image/bmp',
    'heic': 'image/heic',
    'heif': 'image/heif',
}

# Rate limiting: max requests per window per IP
_RATE_WINDOW = 60   # seconds
_RATE_MAX    = 120  # requests per window
_rate_buckets: dict = defaultdict(list)


def _check_rate(ip: str) -> bool:
    now = time.monotonic()
    bucket = _rate_buckets[ip]
    _rate_buckets[ip] = [t for t in bucket if now - t < _RATE_WINDOW]
    if len(_rate_buckets[ip]) >= _RATE_MAX:
        return False
    _rate_buckets[ip].append(now)
    return True


# Security headers added to every response
_SEC_HEADERS = [
    ('X-Content-Type-Options', 'nosniff'),
    ('X-Frame-Options',        'DENY'),
    ('Referrer-Policy',        'strict-origin-when-cross-origin'),
    ('Permissions-Policy',     'geolocation=(), microphone=(), camera=()'),
]

# Extra headers only on the HTML page
_CSP = (
    "default-src 'none'; "
    "script-src 'unsafe-inline' 'unsafe-eval' "
        "https://unpkg.com https://cdn.tailwindcss.com https://cdn.sheetjs.com; "
    "style-src 'unsafe-inline'; "
    "worker-src blob: https://unpkg.com; "
    "connect-src 'self' https://unpkg.com; "
    "img-src 'self' data: blob:; "
    "frame-src blob: 'self'; "
    "font-src 'self' data:; "
    "base-uri 'self'; "
    "form-action 'self'"
)
_HTML_EXTRA = [('Content-Security-Policy', _CSP)]


def _trusted_origin(origin: str) -> str | None:
    """Return origin if it is localhost/loopback, else None."""
    for prefix in ('http://localhost:', 'https://localhost:',
                   'http://127.0.0.1:', 'https://127.0.0.1:',
                   'http://[::1]:', 'https://[::1]:'):
        if origin.startswith(prefix):
            return origin
    return None


def _valid_key(key: str) -> bool:
    return bool(key) and all(c.isalnum() or c == '_' for c in key)


def _valid_upload_filename(name: str) -> bool:
    """Allow only safe characters in upload filenames; extension must be allowed."""
    if not name or len(name) > 200 or name.startswith('.'):
        return False
    if '.' not in name:
        return False
    base, ext = name.rsplit('.', 1)
    ext = ext.lower()
    if ext not in _ALLOWED_EXTENSIONS:
        return False
    return bool(base) and all(c.isalnum() or c in '-_.' for c in name)


def _extract_upload_filename(path: str, prefix: str) -> str | None:
    """Extract and validate filename from an upload/file/delete_upload path."""
    idx = path.find(prefix)
    if idx < 0:
        return None
    filename = path[idx + len(prefix):].strip('/')
    return filename if _valid_upload_filename(filename) else None


def _valid_bf_path(path: str) -> bool:
    """Allow only safe characters in a Brewfather sub-path + query string."""
    return bool(path) and all(c.isalnum() or c in '-_/?=&.' for c in path)


def _valid_wc_path(path: str) -> bool:
    """Allow safe characters for a WooCommerce API sub-path + query string."""
    return bool(path) and all(c.isalnum() or c in '-_/?=&.:%+,[]@' for c in path)


def _load_wc_creds() -> dict | None:
    """Read stored WooCommerce credentials; returns dict or None."""
    creds_file = DATA_DIR / 'woocommerce_creds.json'
    if not creds_file.exists():
        return None
    try:
        creds = json.loads(creds_file.read_bytes())
        url    = str(creds.get('storeUrl', '')).strip().rstrip('/')
        key    = str(creds.get('consumerKey', '')).strip()
        secret = str(creds.get('consumerSecret', '')).strip()
        if not (url.startswith('https://') and key and secret):
            return None
        return {'url': url, 'key': key, 'secret': secret}
    except Exception:
        return None


def _wc_request(creds: dict, method: str, subpath: str, body: bytes | None = None) -> tuple[int, bytes]:
    """Make a GET or PUT request to the WooCommerce REST API."""
    auth = base64.b64encode(f'{creds["key"]}:{creds["secret"]}'.encode()).decode()
    url  = f'{creds["url"]}{WC_API_PATH}/{subpath}'
    req  = urllib.request.Request(
        url,
        data=body,
        headers={
            'Authorization': f'Basic {auth}',
            'Accept':        'application/json',
            'Content-Type':  'application/json',
        },
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read() or b'{}'
    except Exception as ex:
        return 502, json.dumps({'error': str(ex)}).encode()


def extract_key(path: str) -> str | None:
    """Extract data key from path, supporting ingress path prefixes."""
    path = path.split('?')[0]
    idx = path.find(API_DATA_PREFIX)
    if idx < 0:
        return None
    key = path[idx + len(API_DATA_PREFIX):].strip('/')
    return key if _valid_key(key) else None


def _load_claude_creds() -> str | None:
    """Read stored Claude/Anthropic API key; returns the key string or None."""
    creds_file = DATA_DIR / 'claude_creds.json'
    if not creds_file.exists():
        return None
    try:
        creds = json.loads(creds_file.read_bytes())
        key = str(creds.get('apiKey', '')).strip()
        return key if key.startswith('sk-ant-') else None
    except Exception:
        return None


def _load_bf_creds() -> tuple[str, str] | None:
    """Read stored Brewfather credentials; returns (userId, apiKey) or None."""
    creds_file = DATA_DIR / 'brewfather_creds.json'
    if not creds_file.exists():
        return None
    try:
        creds = json.loads(creds_file.read_bytes())
        uid = str(creds.get('userId', '')).strip()
        key = str(creds.get('apiKey', '')).strip()
        return (uid, key) if uid and key else None
    except Exception:
        return None


def _bf_request(uid: str, api_key: str, url: str) -> tuple[int, bytes]:
    """Make a request to the Brewfather API; returns (status, body)."""
    auth = base64.b64encode(f'{uid}:{api_key}'.encode()).decode()
    req = urllib.request.Request(
        url,
        headers={'Authorization': f'Basic {auth}', 'Accept': 'application/json'},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, b'{}'
    except Exception:
        return 502, b'{}'


class BrouwerijHandler(http.server.BaseHTTPRequestHandler):

    # ── helpers ────────────────────────────────────────────────────────────

    def _add_security_headers(self, html: bool = False) -> None:
        for name, value in _SEC_HEADERS:
            self.send_header(name, value)
        if html:
            for name, value in _HTML_EXTRA:
                self.send_header(name, value)
        # Restrict CORS to trusted origins only (removes the old wildcard *)
        origin = self.headers.get('Origin', '')
        allowed = _trusted_origin(origin)
        if allowed:
            self.send_header('Access-Control-Allow-Origin', allowed)
            self.send_header('Vary', 'Origin')

    def _rate_check(self) -> bool:
        if not _check_rate(self.client_address[0]):
            self._json(429, {'error': 'too many requests'})
            return False
        return True

    def _json(self, status: int, data) -> None:
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(body))
        self._add_security_headers()
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self, max_len: int = MAX_CONTENT_LENGTH) -> bytes | None:
        length = int(self.headers.get('Content-Length', 0))
        if length > max_len:
            self._json(413, {'error': 'request too large'})
            return None
        return self.rfile.read(length)

    # ── request routing ────────────────────────────────────────────────────

    def do_OPTIONS(self):
        origin = self.headers.get('Origin', '')
        allowed = _trusted_origin(origin)
        self.send_response(204)
        if allowed:
            self.send_header('Access-Control-Allow-Origin', allowed)
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
            self.send_header('Vary', 'Origin')
        for name, value in _SEC_HEADERS:
            self.send_header(name, value)
        self.end_headers()

    def do_GET(self):
        if not self._rate_check():
            return
        path = self.path.split('?')[0]

        if BF_PROXY_PREFIX in path:
            self._bf_proxy_get()
            return

        if WC_PING_PATH in path:
            self._json(200, {'ok': True, 'server': 'wc-ready'})
            return

        if WC_PROXY_PREFIX in path and WC_PUT_PREFIX not in path:
            self._wc_proxy_get()
            return

        if FILE_PREFIX in path:
            self._serve_upload()
            return

        if DOWNLOAD_BIJLAGEN_PREFIX in path:
            self._serve_bijlagen_zip()
            return

        if HA_PROXY_PREFIX in path:
            self._ha_proxy(path)
            return

        key = extract_key(path)
        if key is not None:
            filepath = DATA_DIR / f'{key}.json'
            if filepath.exists():
                body = filepath.read_bytes()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(body))
                self._add_security_headers()
                self.end_headers()
                self.wfile.write(body)
            else:
                self._json(404, None)
            return

        # Serve the SPA for all other GET requests
        try:
            body = STATIC_FILE.read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', len(body))
            self._add_security_headers(html=True)
            self.end_headers()
            self.wfile.write(body)
        except FileNotFoundError:
            self.send_response(500)
            self.end_headers()

    def do_POST(self):
        if not self._rate_check():
            return
        path = self.path.split('?')[0]

        # Brewfather credential test endpoint
        if BF_TEST_PATH in path:
            self._bf_test()
            return

        # WooCommerce test + PUT proxy
        if WC_TEST_PATH in path:
            self._wc_test()
            return

        if WC_PUT_PREFIX in path:
            self._wc_proxy_put()
            return

        if CLAUDE_PROXY_PREFIX in path:
            self._claude_proxy()
            return

        if HA_PROXY_PREFIX in path:
            self._ha_proxy(path)
            return

        if UPLOAD_PREFIX in path:
            self._handle_upload()
            return

        if DELETE_UPLOAD_PREFIX in path:
            self._handle_delete_upload()
            return

        key = extract_key(path)
        if key is not None:
            body = self._read_body()
            if body is None:
                return
            try:
                json.loads(body)  # validate JSON
            except json.JSONDecodeError:
                self._json(400, {'error': 'invalid json'})
                return
            filepath = DATA_DIR / f'{key}.json'
            filepath.write_bytes(body)
            self._json(200, {'ok': True})
            return

        self._json(404, {'error': 'not found'})

    # ── Brewfather proxy ───────────────────────────────────────────────────

    def _bf_proxy_get(self):
        """Proxy a GET request to the Brewfather API using stored credentials."""
        full = self.path
        idx = full.find(BF_PROXY_PREFIX)
        if idx < 0:
            self._json(400, {'error': 'invalid path'})
            return

        bf_subpath = full[idx + len(BF_PROXY_PREFIX):]  # includes query string
        if not _valid_bf_path(bf_subpath):
            self._json(400, {'error': 'invalid path'})
            return

        creds = _load_bf_creds()
        if creds is None:
            self._json(401, {'error': 'no credentials configured'})
            return

        uid, api_key = creds
        status, data = _bf_request(uid, api_key, f'{BF_API_BASE}/{bf_subpath}')

        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(data))
        self._add_security_headers()
        self.end_headers()
        self.wfile.write(data)

    def _bf_test(self):
        """Test Brewfather credentials supplied in the POST body."""
        raw = self._read_body(max_len=4096)
        if raw is None:
            return
        try:
            body = json.loads(raw)
            uid = str(body.get('userId', '')).strip()
            key = str(body.get('apiKey', '')).strip()
        except Exception:
            self._json(400, {'error': 'invalid json'})
            return

        if not uid or not key:
            self._json(400, {'error': 'missing credentials'})
            return

        # Validate userId characters to prevent header injection
        if not all(c.isalnum() or c in '-_' for c in uid):
            self._json(400, {'error': 'invalid userId'})
            return

        status, _ = _bf_request(uid, key, f'{BF_API_BASE}/batches?limit=1')
        self._json(200, {'ok': status == 200})

    # ── WooCommerce proxy ──────────────────────────────────────────────────

    def _wc_proxy_get(self):
        """Proxy a GET request to the WooCommerce REST API."""
        full = self.path
        idx  = full.find(WC_PROXY_PREFIX)
        wc_subpath = full[idx + len(WC_PROXY_PREFIX):]
        if not _valid_wc_path(wc_subpath):
            self._json(400, {'error': 'invalid path'})
            return
        creds = _load_wc_creds()
        if creds is None:
            self._json(401, {'error': 'no woocommerce credentials configured'})
            return
        status, data = _wc_request(creds, 'GET', wc_subpath)
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(data))
        self._add_security_headers()
        self.end_headers()
        self.wfile.write(data)

    def _wc_proxy_put(self):
        """Proxy a PUT request to WooCommerce, delivered as browser POST."""
        full = self.path
        idx  = full.find(WC_PUT_PREFIX)
        wc_subpath = full[idx + len(WC_PUT_PREFIX):]
        if not _valid_wc_path(wc_subpath):
            self._json(400, {'error': 'invalid path'})
            return
        creds = _load_wc_creds()
        if creds is None:
            self._json(401, {'error': 'no woocommerce credentials configured'})
            return
        body = self._read_body()
        if body is None:
            return
        try:
            json.loads(body)
        except json.JSONDecodeError:
            self._json(400, {'error': 'invalid json'})
            return
        status, data = _wc_request(creds, 'PUT', wc_subpath, body)
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(data))
        self._add_security_headers()
        self.end_headers()
        self.wfile.write(data)

    def _wc_test(self):
        """Test WooCommerce credentials from POST body."""
        raw = self._read_body(max_len=4096)
        if raw is None:
            return
        try:
            body   = json.loads(raw)
            url    = str(body.get('storeUrl', '')).strip().rstrip('/')
            key    = str(body.get('consumerKey', '')).strip()
            secret = str(body.get('consumerSecret', '')).strip()
        except Exception:
            self._json(400, {'error': 'invalid json'})
            return
        if not (url and key and secret):
            self._json(400, {'error': 'missing credentials'})
            return
        if not url.startswith('https://') and not url.startswith('http://'):
            self._json(400, {'error': 'storeUrl must start with https:// or http://'})
            return
        creds = {'url': url, 'key': key, 'secret': secret}
        # Use products endpoint — works with any read-capable API key (no admin required)
        status, body = _wc_request(creds, 'GET', 'products?per_page=1&_fields=id')
        detail = ''
        try:
            parsed = json.loads(body)
            if isinstance(parsed, dict) and parsed.get('message'):
                detail = parsed['message']
        except Exception:
            pass
        self._json(200, {'ok': status in (200, 201), 'status': status, 'detail': detail})

    # ── Bijlagen (file uploads) ────────────────────────────────────────────

    def _serve_upload(self):
        """Serve an uploaded attachment from UPLOAD_DIR."""
        filename = _extract_upload_filename(self.path.split('?')[0], FILE_PREFIX)
        if filename is None:
            self._json(400, {'error': 'invalid filename'})
            return
        filepath = UPLOAD_DIR / filename
        if not filepath.exists():
            self._json(404, {'error': 'not found'})
            return
        body = filepath.read_bytes()
        ext = filename.rsplit('.', 1)[-1].lower()
        ct = _CONTENT_TYPES.get(ext, 'application/octet-stream')
        self.send_response(200)
        self.send_header('Content-Type', ct)
        self.send_header('Content-Length', len(body))
        self.send_header('Content-Disposition', f'inline; filename="{filename}"')
        self._add_security_headers()
        self.end_headers()
        self.wfile.write(body)

    def _ha_proxy(self, path: str):
        """Proxy request to Home Assistant Supervisor API to fetch entity state."""
        idx = path.find(HA_PROXY_PREFIX)
        entity_id = path[idx + len(HA_PROXY_PREFIX):].split('?')[0].strip('/')
        if not entity_id:
            self._json(400, {'error': 'entity_id required'})
            return
        if not re.match(r'^[a-z][a-z0-9_]*\.[a-z0-9][a-z0-9_-]*$', entity_id):
            self._json(400, {'error': f'Ongeldig entity_id formaat. Gebruik bijv. sensor.tank1_temperatuur (alleen kleine letters, cijfers en underscores, met een punt als scheiding)'})
            return
        token = os.environ.get('SUPERVISOR_TOKEN', '')
        if not token:
            self._json(503, {'error': 'SUPERVISOR_TOKEN not available — app must run as HA addon'})
            return
        try:
            req = urllib.request.Request(
                f'{HA_SUPERVISOR_BASE}/states/{entity_id}',
                headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}
            )
            with urllib.request.urlopen(req, timeout=5) as r:
                data = json.loads(r.read())
                self._json(200, {'state': data.get('state'), 'unit': data.get('attributes', {}).get('unit_of_measurement', ''), 'attributes': data.get('attributes', {})})
        except urllib.error.HTTPError as e:
            try:
                err_body = json.loads(e.read().decode())
                msg = err_body.get('message') or err_body.get('error') or f'HA API returned {e.code}'
            except Exception:
                msg = f'HA API returned {e.code}'
            self._json(e.code, {'error': msg})
        except Exception as e:
            self._json(502, {'error': str(e)})

    def _handle_upload(self):
        """Accept a base64-encoded file upload and save it to UPLOAD_DIR."""
        filename = _extract_upload_filename(self.path.split('?')[0], UPLOAD_PREFIX)
        if filename is None:
            self._json(400, {'error': 'invalid filename'})
            return
        body = self._read_body(max_len=MAX_CONTENT_LENGTH)
        if body is None:
            return
        try:
            data = json.loads(body)
            b64 = data.get('data', '')
            content = base64.b64decode(b64)
        except Exception:
            self._json(400, {'error': 'invalid data'})
            return
        (UPLOAD_DIR / filename).write_bytes(content)
        self._json(200, {'ok': True})

    def _handle_delete_upload(self):
        """Delete an uploaded attachment from UPLOAD_DIR."""
        filename = _extract_upload_filename(self.path.split('?')[0], DELETE_UPLOAD_PREFIX)
        if filename is None:
            self._json(400, {'error': 'invalid filename'})
            return
        body = self._read_body(max_len=256)
        if body is None:
            return
        filepath = UPLOAD_DIR / filename
        if filepath.exists():
            filepath.unlink()
        self._json(200, {'ok': True})

    def _claude_proxy(self):
        """Proxy a POST request to the Anthropic Claude messages API."""
        api_key = _load_claude_creds()
        if api_key is None:
            self._json(401, {'error': 'no Claude credentials configured'})
            return
        body = self._read_body(max_len=CLAUDE_MAX_CONTENT)
        if body is None:
            return
        try:
            json.loads(body)  # validate JSON
        except json.JSONDecodeError:
            self._json(400, {'error': 'invalid json'})
            return
        req = urllib.request.Request(
            f'{ANTHROPIC_API_BASE}/v1/messages',
            data=body,
            headers={
                'x-api-key': api_key,
                'anthropic-version': '2023-06-01',
                'anthropic-beta': 'pdfs-2024-09-25',
                'content-type': 'application/json',
            },
            method='POST',
        )
        try:
            with urllib.request.urlopen(req, timeout=90) as resp:
                data = resp.read()
                status = resp.status
        except urllib.error.HTTPError as e:
            status, data = e.code, e.read() or b'{}'
        except Exception as ex:
            status, data = 502, json.dumps({'error': str(ex)}).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(data))
        self._add_security_headers()
        self.end_headers()
        self.wfile.write(data)

    def _serve_bijlagen_zip(self):
        """Serve a ZIP of all invoice attachments for the requested year."""
        path = self.path.split('?')[0]
        idx = path.find(DOWNLOAD_BIJLAGEN_PREFIX)
        year_str = path[idx + len(DOWNLOAD_BIJLAGEN_PREFIX):].strip('/')
        if not re.match(r'^\d{4}$', year_str):
            self._json(400, {'error': 'invalid year'})
            return

        facturen_file = DATA_DIR / 'inkoop_facturen.json'
        try:
            facturen = json.loads(facturen_file.read_bytes()) if facturen_file.exists() else []
        except Exception:
            self._json(500, {'error': 'failed to read facturen'})
            return

        buf = io.BytesIO()
        count = 0
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
            for f in facturen:
                datum = str(f.get('datum', ''))
                if not datum.startswith(year_str):
                    continue
                bijlage = f.get('bijlage')
                if not bijlage or not bijlage.get('bestand'):
                    continue
                bestand = bijlage['bestand']
                if not _valid_upload_filename(bestand):
                    continue
                filepath = UPLOAD_DIR / bestand
                if not filepath.exists():
                    continue
                # Build a human-readable name inside the zip
                leverancier = re.sub(r'[^\w\s-]', '', str(f.get('leverancier', ''))).strip()[:40]
                factuur_nr  = re.sub(r'[^\w\s-]', '', str(f.get('factuurnummer', ''))).strip()[:30]
                ext = bestand.rsplit('.', 1)[-1] if '.' in bestand else 'bin'
                parts = [p for p in [datum, leverancier, factuur_nr] if p]
                zip_name = '_'.join(parts) + '.' + ext
                zf.write(filepath, zip_name)
                count += 1

        if count == 0:
            self._json(200, {'ok': False, 'error': 'no_bijlagen'})
            return

        body = buf.getvalue()
        self.send_response(200)
        self.send_header('Content-Type', 'application/zip')
        self.send_header('Content-Length', len(body))
        self.send_header('Content-Disposition',
                         f'attachment; filename="bijlagen_{year_str}.zip"')
        self._add_security_headers()
        self.end_headers()
        self.wfile.write(body)

    # ── logging ────────────────────────────────────────────────────────────

    def log_message(self, format, *args):
        # Only log non-routine status codes
        if args and len(args) >= 2 and str(args[1]) not in ('200', '404', '204'):
            print(f'{self.address_string()} {format % args}', flush=True)


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8099))
    print(f'Brouwerij Admin gestart op poort {port}', flush=True)
    print(f'Data opgeslagen in {DATA_DIR}', flush=True)
    server = http.server.HTTPServer(('0.0.0.0', port), BrouwerijHandler)
    server.serve_forever()
