#!/usr/bin/env python3
"""
Brouwerij Admin - backend server
Serves the HTML app and stores all data as JSON files in /data/

Supports Home Assistant Ingress: requests arrive with a path prefix like
  /api/hassio_ingress/<TOKEN>/api/data/<key>
The server strips any prefix and looks for /api/data/<key> anywhere in the path.
"""
import base64
import datetime
import email.message
import email.utils
import http.server
import io
import ipaddress
import json
import os
import re
import shutil
import smtplib
import socket
import ssl
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path

DATA_DIR = Path('/data')
STATIC_FILE = Path('/app/static/index.html')
MAX_CONTENT_LENGTH = 10 * 1024 * 1024  # 10 MB — bescherming tegen DoS via grote requests
UPLOAD_DIR = DATA_DIR / 'inkoop_facturen'

BACKUP_DIR = DATA_DIR / 'backups'

DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
BACKUP_DIR.mkdir(parents=True, exist_ok=True)

API_DATA_PREFIX = '/api/data/'
BF_API_BASE = 'https://api.brewfather.app/v2'
BF_PROXY_PREFIX = '/api/brewfather/'
BF_TEST_PATH = '/api/brewfather/test'
BF_PATCH_PREFIX = '/api/brewfather/patch/'

WC_API_PATH    = '/wp-json/wc/v3'
WC_PROXY_PREFIX = '/api/woocommerce/'
WC_PING_PATH    = '/api/woocommerce/ping'
WC_TEST_PATH    = '/api/woocommerce/test'
WC_PUT_PREFIX   = '/api/woocommerce/put/'

UPLOAD_PREFIX            = '/api/upload/'
FILE_PREFIX              = '/api/file/'
DELETE_UPLOAD_PREFIX     = '/api/delete_upload/'
DOWNLOAD_BIJLAGEN_PREFIX = '/api/download_bijlagen/'
BACKUPS_PREFIX           = '/api/backups'
BACKUPS_TRIGGER_PATH     = '/api/backups/trigger'
CLAUDE_PROXY_PREFIX      = '/api/claude/'
ANTHROPIC_API_BASE       = 'https://api.anthropic.com'
CLAUDE_MAX_CONTENT       = 20 * 1024 * 1024  # 20 MB — PDF + images can be large

HA_PROXY_PREFIX          = '/api/homeassistant/'
HA_SUPERVISOR_BASE       = 'http://supervisor/core/api'

MAIL_SEND_PATH           = '/api/mail/send'
MAIL_TEST_PATH           = '/api/mail/test'
MAIL_MAX_CONTENT         = 20 * 1024 * 1024  # 20 MB — mail + attachments
MAIL_SECURITY_VALUES     = {'none', 'starttls', 'ssl'}
MAIL_EMAIL_RE            = re.compile(r'^[^@\s,;<>"]+@[^@\s,;<>"]+\.[^@\s,;<>"]+$')

# Whitelist van toegestane HA service-calls. Houdt de attack-surface klein:
# alleen schrijfacties die de UI expliciet aanbiedt zijn toegestaan. Voeg een
# nieuwe service pas toe als er ook een UI-knop of automatisering voor bestaat.
HA_ALLOWED_SERVICES = {
    ('climate', 'set_temperature'),
    ('climate', 'set_hvac_mode'),
    ('climate', 'set_preset_mode'),
    ('climate', 'turn_on'),
    ('climate', 'turn_off'),
    ('light',   'turn_on'),
    ('light',   'turn_off'),
    ('light',   'toggle'),
    ('switch',  'turn_on'),
    ('switch',  'turn_off'),
    ('switch',  'toggle'),
}

# HA-domeinen die via het list-endpoint uit te filteren zijn. Onbekende waarden
# worden afgewezen zodat de frontend niet per ongeluk (of kwaadaardig) een
# heel andere integratie kan opvragen.
HA_ALLOWED_LIST_DOMAINS = {'sensor', 'climate', 'light', 'switch', 'binary_sensor'}

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


def _retry_after(ip: str) -> int:
    # Seconden tot de oudste request in het venster vervalt (min. 1s).
    bucket = _rate_buckets.get(ip) or []
    if not bucket:
        return 1
    wait = _RATE_WINDOW - (time.monotonic() - bucket[0])
    return max(1, int(wait) + 1)


# Security headers added to every response
# X-Frame-Options: SAMEORIGIN (niet DENY) — Home Assistant ingress toont de
# addon in een iframe vanaf dezelfde origin; DENY geeft daar een wit scherm.
_SEC_HEADERS = [
    ('X-Content-Type-Options', 'nosniff'),
    ('X-Frame-Options',        'SAMEORIGIN'),
    ('Referrer-Policy',        'strict-origin-when-cross-origin'),
    ('Permissions-Policy',     'geolocation=(), microphone=(), camera=()'),
]

# Extra headers only on the HTML page. De build is volledig single-file
# (alles geïnlined door vite-plugin-singlefile), dus externe CDN's zijn niet
# nodig — alleen 'unsafe-inline' voor de bundle en blob: voor workers. Elke
# extra whitelisted host zou een XSS toestaan om willekeurige scripts na te
# laden, dus houd deze lijst leeg.
_CSP = (
    "default-src 'none'; "
    "script-src 'unsafe-inline'; "
    "style-src 'unsafe-inline'; "
    "worker-src blob:; "
    "connect-src 'self'; "
    "img-src 'self' data: blob:; "
    "frame-src blob: 'self'; "
    "frame-ancestors 'self'; "
    "font-src 'self' data:; "
    "base-uri 'self'; "
    "form-action 'self'"
)
_HTML_EXTRA = [('Content-Security-Policy', _CSP), ('Cache-Control', 'no-cache, must-revalidate')]


_TRUSTED_ORIGINS = frozenset((
    'http://localhost:5173',   # Vite dev server
    'http://localhost:8099',   # production preview
    'http://127.0.0.1:5173',
    'http://127.0.0.1:8099',
))


def _trusted_origin(origin: str) -> str | None:
    """Return origin if it is a known dev/preview origin, else None."""
    return origin if origin in _TRUSTED_ORIGINS else None


# Wanneer de app als HA-addon draait (SUPERVISOR_TOKEN aanwezig) mag alleen de
# ingress-gateway van Home Assistant requests sturen. Zonder deze check kan
# elke andere addon/container op het interne hassio-netwerk de volledige —
# ongeauthenticeerde — API benaderen (incl. opgeslagen credentials en de
# HA service-call-proxy). Zie de HA-documentatie over ingress:
# "you must only allow connections from 172.30.32.2".
_INGRESS_GATEWAY_IP = '172.30.32.2'


def _client_allowed(ip: str) -> bool:
    """True als dit client-IP requests mag doen. Buiten HA (lokale dev,
    geen SUPERVISOR_TOKEN) is alles toegestaan; als addon alleen de
    ingress-gateway en loopback (container-interne healthchecks)."""
    if not os.environ.get('SUPERVISOR_TOKEN'):
        return True
    if ip == _INGRESS_GATEWAY_IP:
        return True
    try:
        return ipaddress.ip_address(ip).is_loopback
    except ValueError:
        return False


def _is_private_url(url: str) -> bool:
    """Block requests to private/internal IP ranges (SSRF protection)."""
    try:
        host = urllib.parse.urlparse(url).hostname or ''
        for info in socket.getaddrinfo(host, None, socket.AF_UNSPEC, socket.SOCK_STREAM):
            addr = info[4][0]
            ip = ipaddress.ip_address(addr)
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
                return True
    except Exception:
        return True  # als DNS niet lukt, blokkeer
    return False


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
    except Exception:
        return 502, json.dumps({'error': 'upstream request failed'}).encode()


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


def _load_smtp_creds() -> dict | None:
    """Read stored SMTP credentials; returns a sanitized dict or None.

    Verwacht JSON-vorm:
      {host, port, username, password, fromEmail, fromName, security, enabled}
    `security` is een van 'none', 'starttls', 'ssl'.
    """
    creds_file = DATA_DIR / 'smtp_creds.json'
    if not creds_file.exists():
        return None
    try:
        c = json.loads(creds_file.read_bytes())
    except Exception:
        return None
    host = str(c.get('host', '')).strip()
    try:
        port = int(c.get('port', 0))
    except (TypeError, ValueError):
        return None
    if not host or port < 1 or port > 65535:
        return None
    if _is_private_url(f'http://{host}'):
        # Lokale/private SMTP-hosts blokkeren we niet: een interne mailserver
        # is een legitiem scenario voor een HA-addon. Maar we geven hier wel
        # een hint terug via False voor de privacy-check zodat aanroepers
        # kunnen besluiten dit alleen tijdens een test te accepteren. In de
        # praktijk laten we het door — alleen het _send_mail-pad gebruikt deze.
        pass
    security = str(c.get('security', 'starttls')).strip().lower()
    if security not in MAIL_SECURITY_VALUES:
        security = 'starttls'
    from_email = str(c.get('fromEmail', '')).strip()
    if from_email and not MAIL_EMAIL_RE.match(from_email):
        return None
    return {
        'host':      host,
        'port':      port,
        'username':  str(c.get('username', '')),
        'password':  str(c.get('password', '')),
        'fromEmail': from_email,
        'fromName':  str(c.get('fromName', '')).strip(),
        'security':  security,
        'enabled':   bool(c.get('enabled')),
    }


def _smtp_connect(creds: dict, timeout: float = 15.0) -> smtplib.SMTP:
    """Open een SMTP-verbinding volgens de opgegeven beveiligingsmodus.
    De caller is verantwoordelijk voor .quit()."""
    host, port, security = creds['host'], creds['port'], creds['security']
    if security == 'ssl':
        ctx = ssl.create_default_context()
        client: smtplib.SMTP = smtplib.SMTP_SSL(host, port, timeout=timeout, context=ctx)
    else:
        client = smtplib.SMTP(host, port, timeout=timeout)
    client.ehlo()
    if security == 'starttls':
        ctx = ssl.create_default_context()
        client.starttls(context=ctx)
        client.ehlo()
    if creds.get('username'):
        client.login(creds['username'], creds.get('password', ''))
    return client


def _valid_recipient_list(recipients) -> list[str] | None:
    """Valideer een lijst van e-mailadressen; max 50 ontvangers per request."""
    if isinstance(recipients, str):
        recipients = [recipients]
    if not isinstance(recipients, list) or not recipients:
        return None
    if len(recipients) > 50:
        return None
    cleaned: list[str] = []
    for r in recipients:
        if not isinstance(r, str):
            return None
        addr = r.strip()
        if not addr or not MAIL_EMAIL_RE.match(addr):
            return None
        cleaned.append(addr)
    return cleaned


def _build_email(creds: dict, payload: dict) -> tuple[email.message.EmailMessage, list[str]] | None:
    """Bouw een EmailMessage uit de request-payload. Returns (msg, recipients)
    of None bij invalide input."""
    to_list  = _valid_recipient_list(payload.get('to'))
    if not to_list:
        return None
    cc_list  = _valid_recipient_list(payload.get('cc')) if payload.get('cc') else []
    bcc_list = _valid_recipient_list(payload.get('bcc')) if payload.get('bcc') else []
    if payload.get('cc') and cc_list is None:
        return None
    if payload.get('bcc') and bcc_list is None:
        return None

    subject = str(payload.get('subject', '')).strip()
    if not subject or len(subject) > 500:
        return None
    text_body = str(payload.get('text', ''))
    html_body = payload.get('html')
    if html_body is not None and not isinstance(html_body, str):
        return None

    msg = email.message.EmailMessage()
    from_name  = creds.get('fromName', '')
    from_email = creds.get('fromEmail') or creds.get('username', '')
    if not MAIL_EMAIL_RE.match(from_email or ''):
        return None
    msg['From']    = email.utils.formataddr((from_name, from_email)) if from_name else from_email
    msg['To']      = ', '.join(to_list)
    if cc_list:
        msg['Cc']  = ', '.join(cc_list)
    msg['Subject'] = subject
    msg['Date']    = email.utils.formatdate(localtime=True)
    msg['Message-ID'] = email.utils.make_msgid()

    reply_to = str(payload.get('replyTo', '')).strip()
    if reply_to:
        if not MAIL_EMAIL_RE.match(reply_to):
            return None
        msg['Reply-To'] = reply_to

    msg.set_content(text_body or ' ')
    if html_body:
        msg.add_alternative(html_body, subtype='html')

    # Bijlagen: lijst van {filename, contentBase64, mimeType?}
    attachments = payload.get('attachments') or []
    if not isinstance(attachments, list):
        return None
    if len(attachments) > 10:
        return None
    total_size = 0
    for att in attachments:
        if not isinstance(att, dict):
            return None
        fname = str(att.get('filename', '')).strip()
        if not fname or len(fname) > 200:
            return None
        # Voorkom path-componenten in de bijlagenaam — naam mag geen / of \ bevatten.
        if '/' in fname or '\\' in fname or fname.startswith('.'):
            return None
        b64 = att.get('contentBase64', '')
        if not isinstance(b64, str):
            return None
        try:
            content = base64.b64decode(b64, validate=True)
        except Exception:
            return None
        total_size += len(content)
        if total_size > 15 * 1024 * 1024:  # 15 MB totaal aan bijlagen
            return None
        mt = str(att.get('mimeType', 'application/octet-stream'))
        if '/' not in mt:
            mt = 'application/octet-stream'
        maintype, _, subtype = mt.partition('/')
        msg.add_attachment(content, maintype=maintype, subtype=subtype, filename=fname)

    # Inline images: lijst van {filename, contentBase64, mimeType, contentId}.
    # Worden via add_related op de HTML-alternative gekoppeld zodat het de
    # standaard multipart/related-structuur krijgt (Gmail, Outlook, Apple Mail).
    inline_imgs = payload.get('inlineImages') or []
    if not isinstance(inline_imgs, list):
        return None
    if len(inline_imgs) > 10:
        return None
    if inline_imgs and not html_body:
        # Inline images zonder HTML-body hebben geen verwijzingspunt.
        return None
    for img in inline_imgs:
        if not isinstance(img, dict):
            return None
        cid = str(img.get('contentId', '')).strip()
        # CID moet veilig zijn voor in een header — strikt alfanum + . _ -
        if not cid or not re.match(r'^[A-Za-z0-9._-]{1,80}$', cid):
            return None
        ifname = str(img.get('filename', '')).strip() or f'{cid}.png'
        if len(ifname) > 200 or '/' in ifname or '\\' in ifname or ifname.startswith('.'):
            return None
        ib64 = img.get('contentBase64', '')
        if not isinstance(ib64, str):
            return None
        try:
            icontent = base64.b64decode(ib64, validate=True)
        except Exception:
            return None
        total_size += len(icontent)
        if total_size > 15 * 1024 * 1024:
            return None
        imt = str(img.get('mimeType', 'image/png'))
        if not imt.startswith('image/') or '/' not in imt:
            return None
        imaintype, _, isubtype = imt.partition('/')
        html_part = msg.get_body(preferencelist=('html',))
        if html_part is None:
            return None
        # `disposition='inline'` zorgt dat strikte mailclients het beeld
        # daadwerkelijk in de body renderen i.p.v. als losse download tonen.
        html_part.add_related(icontent, maintype=imaintype, subtype=isubtype,
                              cid=f'<{cid}>', filename=ifname, disposition='inline')

    return msg, to_list + cc_list + bcc_list


def _bf_request(uid: str, api_key: str, url: str, method: str = 'GET', data: bytes | None = None) -> tuple[int, bytes]:
    """Make a request to the Brewfather API; returns (status, body)."""
    auth = base64.b64encode(f'{uid}:{api_key}'.encode()).decode()
    headers = {'Authorization': f'Basic {auth}', 'Accept': 'application/json'}
    if data is not None:
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(
        url, data=data, headers=headers, method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, b'{}'
    except Exception:
        return 502, b'{}'


# ── Backup system (AGP 7-year retention) ──────────────────────────────────

def _run_backup() -> str:
    """Copy all /data/*.json files into /data/backups/YYYY-MM-DD/.
    Returns the backup date string."""
    today = datetime.date.today().isoformat()
    dest = BACKUP_DIR / today
    dest.mkdir(parents=True, exist_ok=True)
    for f in DATA_DIR.glob('*.json'):
        shutil.copy2(f, dest / f.name)
    return today


def _should_keep_backup(backup_date: datetime.date, today: datetime.date) -> bool:
    """Determine whether a backup should be retained based on AGP policy.
    - Daily backups: keep for 30 days
    - Weekly (Monday) backups: keep for 1 year
    - Monthly (1st of month) backups: keep for 7 years
    """
    age = (today - backup_date).days
    # Monthly backups (1st of month): keep 7 years
    if backup_date.day == 1 and age <= 7 * 365:
        return True
    # Weekly backups (Monday): keep 1 year
    if backup_date.weekday() == 0 and age <= 365:
        return True
    # Daily backups: keep 30 days
    if age <= 30:
        return True
    return False


def _cleanup_backups() -> None:
    """Remove backup directories that no longer meet the retention policy."""
    today = datetime.date.today()
    for entry in sorted(BACKUP_DIR.iterdir()):
        if not entry.is_dir():
            continue
        try:
            backup_date = datetime.date.fromisoformat(entry.name)
        except ValueError:
            continue
        if not _should_keep_backup(backup_date, today):
            shutil.rmtree(entry, ignore_errors=True)


def _backup_loop(interval: float = 86400.0) -> None:
    """Background loop: run backup + cleanup once per day."""
    while True:
        try:
            _run_backup()
            _cleanup_backups()
        except Exception as exc:
            print(f'[backup] error: {exc}', flush=True)
        time.sleep(interval)


# ── Automatische gistmetingen ─────────────────────────────────────────────

_data_lock = threading.Lock()


def _read_json(key: str, default=None):
    """Lees een JSON-databestand uit /data/. Geeft default terug als bestand niet bestaat."""
    filepath = DATA_DIR / f'{key}.json'
    if not filepath.exists():
        return default
    try:
        return json.loads(filepath.read_text(encoding='utf-8'))
    except (json.JSONDecodeError, OSError):
        return default


def _atomic_write_bytes(filepath: Path, data: bytes) -> None:
    """Schrijf atomair: eerst naar een tempbestand in dezelfde map, dan
    os.replace. Een crash mid-write kan zo nooit een half/corrupt JSON-bestand
    achterlaten (relevant voor de 7-jaars AGP-retentie)."""
    tmp = filepath.with_name(f'.{filepath.name}.tmp')
    tmp.write_bytes(data)
    os.replace(tmp, filepath)


def _write_json(key: str, data) -> None:
    """Schrijf data als JSON naar /data/ (atomair)."""
    filepath = DATA_DIR / f'{key}.json'
    _atomic_write_bytes(filepath, json.dumps(data, ensure_ascii=False).encode('utf-8'))


def _ha_fetch_state(entity_id: str) -> float | None:
    """Haal de huidige waarde van een HA-entiteit op. Geeft None terug bij fout."""
    token = os.environ.get('SUPERVISOR_TOKEN', '')
    if not token:
        return None
    try:
        req = urllib.request.Request(
            f'{HA_SUPERVISOR_BASE}/states/{entity_id}',
            headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}
        )
        with urllib.request.urlopen(req, timeout=5) as r:
            data = json.loads(r.read())
            val = float(data.get('state', ''))
            return val
    except (urllib.error.URLError, ValueError, TypeError, OSError):
        return None


def _ha_fetch_climate_setpoint(entity_id: str) -> float | None:
    """Haal het huidige setpoint (`attributes.temperature`) van een climate-entity op."""
    token = os.environ.get('SUPERVISOR_TOKEN', '')
    if not token:
        return None
    try:
        req = urllib.request.Request(
            f'{HA_SUPERVISOR_BASE}/states/{entity_id}',
            headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}
        )
        with urllib.request.urlopen(req, timeout=5) as r:
            data = json.loads(r.read())
            attrs = data.get('attributes', {}) or {}
            sp = attrs.get('temperature')
            return float(sp) if sp is not None else None
    except (urllib.error.URLError, ValueError, TypeError, OSError):
        return None


def _ha_set_climate_temperature(entity_id: str, temperature: float) -> bool:
    """Stuur een climate.set_temperature service-call naar HA. Return True bij success."""
    token = os.environ.get('SUPERVISOR_TOKEN', '')
    if not token:
        return False
    if not re.match(r'^climate\.[a-z0-9][a-z0-9_-]*$', entity_id):
        return False
    try:
        payload = json.dumps({'entity_id': entity_id, 'temperature': temperature}).encode('utf-8')
        req = urllib.request.Request(
            f'{HA_SUPERVISOR_BASE}/services/climate/set_temperature',
            data=payload,
            headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'},
            method='POST',
        )
        with urllib.request.urlopen(req, timeout=10):
            return True
    except (urllib.error.URLError, OSError):
        return False


def _auto_metingen_loop(interval: float = 600.0) -> None:
    """Achtergrondloop: haal elke 10 minuten temperatuurmetingen op van HA sensoren
    voor batches in status Vergisten of Conditioneren, en sla deze op."""
    time.sleep(30)  # wacht even tot server volledig opgestart is
    while True:
        try:
            _auto_metingen_tick()
        except Exception as exc:
            print(f'[auto-metingen] error: {exc}', flush=True)
        time.sleep(interval)


def _cold_crash_loop(interval: float = 60.0) -> None:
    """Achtergrondloop: check elke minuut of er een cold-crash-batch is die
    een stap naar beneden moet. De daadwerkelijke stap gebeurt alleen als er
    >= 1 uur is verstreken sinds de vorige stap — dit interval bepaalt slechts
    hoe snel de app na dat uur reageert."""
    time.sleep(20)  # kort wachten zodat eerste tick snel na start draait
    while True:
        try:
            _cold_crash_tick()
        except Exception as exc:
            print(f'[cold-crash] error: {exc}', flush=True)
        time.sleep(interval)


def _auto_metingen_tick() -> None:
    """Eén ronde automatische metingen: check HA-instellingen, lees batches,
    haal temperatuur op voor elke actieve batch met sensor, en sla metingen op."""
    with _data_lock:
        ha_inst = _read_json('ha_instellingen', {})
    if not ha_inst.get('enabled'):
        return
    sensors = ha_inst.get('sensors', [])
    if not sensors:
        return

    with _data_lock:
        batches = _read_json('batches', [])
    active = [b for b in batches
              if b.get('tank') and b.get('status') in ('Vergisten', 'Conditioneren')]
    if not active:
        return

    new_entries = []
    now = datetime.datetime.now()
    datum = now.strftime('%Y-%m-%d')
    tijd = now.strftime('%H:%M')

    for batch in active:
        sensor = next((s for s in sensors if s.get('tank') == batch.get('tank')), None)
        if not sensor or not sensor.get('entity'):
            continue
        val = _ha_fetch_state(sensor['entity'])
        if val is None:
            continue
        new_entries.append({
            'batch_id': batch['id'],
            'datum': datum,
            'tijd': tijd,
            'temp': val,
            'auto': True,
        })

    if not new_entries:
        return

    with _data_lock:
        metingen = _read_json('gist_metingen', [])
        max_id = max((m.get('id', 0) for m in metingen), default=0)
        for entry in new_entries:
            max_id += 1
            entry['id'] = max_id
            metingen.append(entry)
        _write_json('gist_metingen', metingen)

    print(f'[auto-metingen] {len(new_entries)} meting(en) opgeslagen', flush=True)


def _cold_crash_tick() -> None:
    """Zet voor elke batch in Conditioneren met een actieve cold-crash de
    climate-setpoint één ramp-stap naar beneden zodra er minstens een uur is
    verstreken sinds de vorige stap. Stopt wanneer het target is bereikt."""
    with _data_lock:
        batches = _read_json('batches', []) or []
    active = [b for b in batches
              if b.get('status') == 'Conditioneren' and b.get('cold_crash_datum')]
    if not active:
        return  # niets te doen — blijf stil in de logs

    with _data_lock:
        ha_inst = _read_json('ha_instellingen', {}) or {}
    if not ha_inst.get('climates_enabled'):
        print(f"[cold-crash] {len(active)} actieve batch(es), maar climates_enabled=false in ha_instellingen — skip", flush=True)
        return
    climates = ha_inst.get('climates', []) or []
    if not climates:
        print(f"[cold-crash] {len(active)} actieve batch(es), maar geen climates geconfigureerd — skip", flush=True)
        return

    # Gebruik UTC met tzinfo: de frontend slaat `new Date().toISOString()` op
    # (altijd UTC met `Z`), dus `last_dt` is offset-aware. Een naive `now()`
    # zou `can't subtract offset-naive and offset-aware datetimes` opleveren.
    now = datetime.datetime.now(datetime.timezone.utc)
    updated: list[dict] = []

    for batch in active:
        batch_id = batch.get('id')
        # cold_crash_target blijft leidend: zonder target weten we niet waar
        # heen te stappen, dus die batch slaan we over.
        try:
            target = float(batch.get('cold_crash_target'))
        except (TypeError, ValueError):
            print(f"[cold-crash] batch {batch_id}: ongeldig cold_crash_target — skip", flush=True)
            continue
        try:
            batch_ramp = float(batch.get('cold_crash_ramp') or 1)
        except (TypeError, ValueError):
            batch_ramp = 1.0
        if batch_ramp <= 0:
            print(f"[cold-crash] batch {batch_id}: ramp<=0 — skip", flush=True)
            continue

        climate = next((c for c in climates if c.get('tank') == batch.get('tank') and c.get('entity')), None)
        if not climate:
            print(f"[cold-crash] batch {batch_id}: geen climate gekoppeld aan tank {batch.get('tank')!r} — skip", flush=True)
            continue
        entity_id = climate['entity']

        # Tijdstip van de laatste stap: bij de allereerste tick is dat het
        # moment dat de cold-crash werd gestart (frontend heeft dan al één
        # stap lager gezet). Pas daarna volgen uurlijkse stappen.
        last_iso = batch.get('cold_crash_laatste_stap') or batch.get('cold_crash_datum')
        try:
            # `Z`-suffix expliciet vervangen — Python <3.11 slikt dat niet in
            # fromisoformat, en ook oudere records zonder offset normaliseren
            # we naar UTC zodat arithmetiek met `now` (aware) werkt.
            iso_norm = (last_iso or '').replace('Z', '+00:00')
            last_dt = datetime.datetime.fromisoformat(iso_norm)
            if last_dt.tzinfo is None:
                last_dt = last_dt.replace(tzinfo=datetime.timezone.utc)
        except (TypeError, ValueError):
            print(f"[cold-crash] batch {batch_id}: ongeldig timestamp {last_iso!r} — skip", flush=True)
            continue
        elapsed_h = (now - last_dt).total_seconds() / 3600.0
        if elapsed_h < 1.0:
            # Geen ruis in de logs: alleen één keer per 10 minuten melden dat
            # we wachten. (int(min) % 10 == 0)
            mins = int((now - last_dt).total_seconds() / 60)
            if mins > 0 and mins % 10 == 0:
                print(f"[cold-crash] batch {batch_id}: wacht op volgend uur (elapsed {mins} min)", flush=True)
            continue

        current_sp = _ha_fetch_climate_setpoint(entity_id)
        if current_sp is None:
            print(f"[cold-crash] batch {batch_id}: kon setpoint van {entity_id} niet lezen — skip", flush=True)
            continue
        if current_sp <= target + 1e-6:
            print(f"[cold-crash] batch {batch_id}: setpoint {current_sp}°C <= target {target}°C — klaar", flush=True)
            continue

        # Doe zoveel hele uur-stappen als mogelijk in één tick — voorkomt
        # dat een korte serveronderbreking de ramp uit de pas laat lopen.
        steps = int(elapsed_h)
        if steps < 1:
            continue
        new_sp = max(target, current_sp - batch_ramp * steps)
        # Rond af op één decimaal om gekke floats te vermijden.
        new_sp = round(new_sp, 2)

        if not _ha_set_climate_temperature(entity_id, new_sp):
            print(f"[cold-crash] batch {batch_id}: set_temperature({entity_id}, {new_sp}) faalde — skip", flush=True)
            continue

        # Verplaats de "laatste stap"-ijkpunt vooruit per hele uur, zodat
        # fracties van het uur bewaard blijven voor de volgende tick.
        next_last = (last_dt + datetime.timedelta(hours=steps)).isoformat()
        updated.append({
            'id': batch.get('id'),
            'new_sp': new_sp,
            'steps': steps,
            'next_last': next_last,
        })

    if not updated:
        return

    # Her-lees batches onder de lock en merge alleen het cold-crash-tijdpunt
    # terug, zodat we gelijktijdige UI-schrijfacties niet overschrijven.
    step_map = {u['id']: u['next_last'] for u in updated}
    with _data_lock:
        current = _read_json('batches', []) or []
        for b in current:
            nl = step_map.get(b.get('id'))
            if nl is not None:
                b['cold_crash_laatste_stap'] = nl
        _write_json('batches', current)

    for u in updated:
        print(f"[cold-crash] batch {u['id']}: setpoint → {u['new_sp']}°C ({u['steps']} stap(pen))", flush=True)


def _list_backups() -> list[dict]:
    """Return list of available backups with date and file count."""
    result = []
    for entry in sorted(BACKUP_DIR.iterdir()):
        if not entry.is_dir():
            continue
        try:
            datetime.date.fromisoformat(entry.name)
        except ValueError:
            continue
        files = list(entry.glob('*.json'))
        result.append({'date': entry.name, 'file_count': len(files)})
    return result


def _backup_to_zip(date_str: str) -> bytes | None:
    """Create a ZIP archive of a backup directory. Returns bytes or None."""
    backup_path = BACKUP_DIR / date_str
    if not backup_path.is_dir():
        return None
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        for f in sorted(backup_path.iterdir()):
            if f.is_file():
                zf.write(f, f.name)
    return buf.getvalue()


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
        ip = self.client_address[0]
        if not _client_allowed(ip):
            self._json(403, {'error': 'forbidden'})
            return False
        if not _check_rate(ip):
            self._json(429, {'error': 'too many requests'}, extra_headers=[('Retry-After', str(_retry_after(ip)))])
            return False
        return True

    def _json(self, status: int, data, extra_headers: list | None = None) -> None:
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(body))
        self.send_header('Cache-Control', 'no-store')
        if extra_headers:
            for name, value in extra_headers:
                self.send_header(name, value)
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
        if not _client_allowed(self.client_address[0]):
            self._json(403, {'error': 'forbidden'})
            return
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

        if BACKUPS_PREFIX in path and BACKUPS_TRIGGER_PATH not in path:
            self._handle_backups_get()
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
                self.send_header('Cache-Control', 'no-store')
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

        # Brewfather PATCH proxy (voorraad push)
        if BF_PATCH_PREFIX in path:
            self._bf_proxy_patch()
            return

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

        if MAIL_TEST_PATH in path:
            self._mail_test()
            return

        if MAIL_SEND_PATH in path:
            self._mail_send()
            return

        if HA_PROXY_PREFIX in path:
            self._ha_proxy(path)
            return

        if BACKUPS_TRIGGER_PATH in path:
            self._handle_backup_trigger()
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
            # Onder _data_lock zodat de achtergrondthreads (cold-crash,
            # auto-metingen) die read-modify-write doen op dezelfde bestanden
            # geen halve merge overschrijven; atomair tegen corruptie.
            with _data_lock:
                _atomic_write_bytes(filepath, body)
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

    def _bf_proxy_patch(self):
        """Proxy a PATCH request to Brewfather, delivered as browser POST."""
        full = self.path
        idx = full.find(BF_PATCH_PREFIX)
        bf_subpath = full[idx + len(BF_PATCH_PREFIX):]
        if not _valid_bf_path(bf_subpath):
            self._json(400, {'error': 'invalid path'})
            return
        creds = _load_bf_creds()
        if creds is None:
            self._json(401, {'error': 'no credentials configured'})
            return
        body = self._read_body()
        if body is None:
            return
        try:
            json.loads(body)
        except json.JSONDecodeError:
            self._json(400, {'error': 'invalid json'})
            return
        uid, api_key = creds
        status, data = _bf_request(uid, api_key, f'{BF_API_BASE}/{bf_subpath}', 'PATCH', body)
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
        if _is_private_url(url):
            self._json(400, {'error': 'storeUrl must not point to a private/internal address'})
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
        """Router voor /api/homeassistant/* requests:
          GET  <prefix>_list?domain=<x>             → lijst entity-states
          POST <prefix>_service/<domain>/<service>  → service-call
          GET  <prefix><entity_id>                  → enkele entity-state
        """
        idx = path.find(HA_PROXY_PREFIX)
        tail = path[idx + len(HA_PROXY_PREFIX):]
        qs = ''
        if '?' in tail:
            tail, qs = tail.split('?', 1)
        tail = tail.strip('/')

        if not tail:
            self._json(400, {'error': 'entity_id required'})
            return

        # Listing endpoint (vereist HA-token, bevat alleen gefilterde domeinen).
        if tail == '_list':
            if self.command != 'GET':
                self._json(405, {'error': 'method not allowed'})
                return
            domain = ''
            for part in qs.split('&'):
                if part.startswith('domain='):
                    domain = part[len('domain='):]
                    break
            self._ha_list_states(domain)
            return

        # Service-call endpoint.
        if tail.startswith('_service/'):
            if self.command != 'POST':
                self._json(405, {'error': 'method not allowed'})
                return
            parts = tail[len('_service/'):].split('/')
            if len(parts) != 2 or not parts[0] or not parts[1]:
                self._json(400, {'error': 'expected _service/<domain>/<service>'})
                return
            self._ha_call_service(parts[0], parts[1])
            return

        # Anders: enkele entity-state ophalen.
        entity_id = tail
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
        except Exception:
            self._json(502, {'error': 'could not reach Home Assistant API'})

    def _ha_list_states(self, domain: str):
        """Haalt alle HA-states op en filtert optioneel op domein. Wordt door de
        Instellingen-pagina gebruikt om entity-dropdowns te vullen. Geeft alleen
        `entity_id`, `state`, `attributes.friendly_name` en `unit_of_measurement`
        terug — ruwe attributes worden niet doorgestuurd om payloads klein te
        houden en lekken van onnodige metadata te voorkomen."""
        if domain and domain not in HA_ALLOWED_LIST_DOMAINS:
            self._json(400, {'error': f'domain not allowed: {domain}'})
            return
        token = os.environ.get('SUPERVISOR_TOKEN', '')
        if not token:
            self._json(503, {'error': 'SUPERVISOR_TOKEN not available — app must run as HA addon'})
            return
        try:
            req = urllib.request.Request(
                f'{HA_SUPERVISOR_BASE}/states',
                headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}
            )
            with urllib.request.urlopen(req, timeout=10) as r:
                raw = json.loads(r.read())
        except urllib.error.HTTPError as e:
            self._json(e.code, {'error': f'HA API returned {e.code}'})
            return
        except Exception:
            self._json(502, {'error': 'could not reach Home Assistant API'})
            return

        result = []
        for st in raw if isinstance(raw, list) else []:
            eid = st.get('entity_id') or ''
            if '.' not in eid:
                continue
            if domain and not eid.startswith(domain + '.'):
                continue
            attrs = st.get('attributes') or {}
            result.append({
                'entity_id': eid,
                'state': st.get('state'),
                'friendly_name': attrs.get('friendly_name', ''),
                'unit': attrs.get('unit_of_measurement', ''),
                # Domein-specifieke attributen die de UI nodig heeft om
                # slim te kunnen renderen (min/max temp, beschikbare modes,
                # brightness-ondersteuning). Laat lege waarden weg.
                'hvac_modes':     attrs.get('hvac_modes') or [],
                'preset_modes':   attrs.get('preset_modes') or [],
                'min_temp':       attrs.get('min_temp'),
                'max_temp':       attrs.get('max_temp'),
                'current_temperature': attrs.get('current_temperature'),
                'temperature':    attrs.get('temperature'),
                'supported_color_modes': attrs.get('supported_color_modes') or [],
                'brightness':     attrs.get('brightness'),
                'device_class':   attrs.get('device_class', ''),
            })
        self._json(200, {'states': result})

    def _ha_call_service(self, domain: str, service: str):
        """Voert een whitelisted HA service-call uit. Body = JSON met minimaal
        `entity_id` plus service-specifieke velden (bv. `temperature`,
        `brightness_pct`, `hvac_mode`). Het entity_id wordt gevalideerd tegen
        hetzelfde regex-patroon als bij de state-ophaling."""
        if (domain, service) not in HA_ALLOWED_SERVICES:
            self._json(403, {'error': f'service not allowed: {domain}.{service}'})
            return
        body = self._read_body(max_len=8 * 1024)
        if body is None:
            return
        try:
            payload = json.loads(body) if body else {}
        except Exception:
            self._json(400, {'error': 'invalid JSON body'})
            return
        if not isinstance(payload, dict):
            self._json(400, {'error': 'body must be a JSON object'})
            return
        entity_id = payload.get('entity_id', '')
        if not isinstance(entity_id, str) or not re.match(r'^[a-z][a-z0-9_]*\.[a-z0-9][a-z0-9_-]*$', entity_id):
            self._json(400, {'error': 'invalid or missing entity_id'})
            return
        # Domein van entity_id moet overeenkomen met service-domein — voorkomt
        # bv. een `light.turn_on` op een switch-entity.
        if not entity_id.startswith(domain + '.'):
            self._json(400, {'error': f'entity_id domain mismatch: expected {domain}.*'})
            return
        token = os.environ.get('SUPERVISOR_TOKEN', '')
        if not token:
            self._json(503, {'error': 'SUPERVISOR_TOKEN not available — app must run as HA addon'})
            return
        try:
            req = urllib.request.Request(
                f'{HA_SUPERVISOR_BASE}/services/{domain}/{service}',
                data=json.dumps(payload).encode('utf-8'),
                headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'},
                method='POST',
            )
            with urllib.request.urlopen(req, timeout=10) as r:
                try:
                    resp = json.loads(r.read())
                except Exception:
                    resp = []
                self._json(200, {'ok': True, 'result': resp})
        except urllib.error.HTTPError as e:
            try:
                err_body = json.loads(e.read().decode())
                msg = err_body.get('message') or err_body.get('error') or f'HA API returned {e.code}'
            except Exception:
                msg = f'HA API returned {e.code}'
            self._json(e.code, {'error': msg})
        except Exception:
            self._json(502, {'error': 'could not reach Home Assistant API'})

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
        except Exception:
            status, data = 502, json.dumps({'error': 'upstream request failed'}).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(data))
        self._add_security_headers()
        self.end_headers()
        self.wfile.write(data)

    # ── Mail (SMTP) ────────────────────────────────────────────────────

    def _mail_test(self):
        """Test SMTP-credentials uit POST body. Probeert te verbinden + inloggen."""
        raw = self._read_body(max_len=8 * 1024)
        if raw is None:
            return
        try:
            body = json.loads(raw)
        except Exception:
            self._json(400, {'error': 'invalid json'})
            return
        # Bouw tijdelijke creds op uit de body (sla nog niets op).
        host = str(body.get('host', '')).strip()
        try:
            port = int(body.get('port', 0))
        except (TypeError, ValueError):
            self._json(400, {'error': 'invalid port'})
            return
        if not host or port < 1 or port > 65535:
            self._json(400, {'error': 'missing host or invalid port'})
            return
        security = str(body.get('security', 'starttls')).strip().lower()
        if security not in MAIL_SECURITY_VALUES:
            security = 'starttls'
        creds = {
            'host':     host,
            'port':     port,
            'username': str(body.get('username', '')),
            'password': str(body.get('password', '')),
            'security': security,
        }
        try:
            client = _smtp_connect(creds, timeout=10.0)
            client.quit()
            self._json(200, {'ok': True})
        except smtplib.SMTPAuthenticationError:
            self._json(200, {'ok': False, 'detail': 'auth'})
        except (smtplib.SMTPException, ssl.SSLError, socket.timeout, OSError) as e:
            # Stuur korte foutclassificatie terug — geen volledige traceback,
            # geen credentials.
            kind = type(e).__name__
            self._json(200, {'ok': False, 'detail': kind})

    def _mail_send(self):
        """Verstuur een e-mail via de opgeslagen SMTP-credentials."""
        creds = _load_smtp_creds()
        if creds is None:
            self._json(401, {'error': 'no smtp credentials configured'})
            return
        if not creds.get('enabled'):
            self._json(403, {'error': 'smtp not enabled'})
            return
        body = self._read_body(max_len=MAIL_MAX_CONTENT)
        if body is None:
            return
        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            self._json(400, {'error': 'invalid json'})
            return
        if not isinstance(payload, dict):
            self._json(400, {'error': 'body must be a JSON object'})
            return
        built = _build_email(creds, payload)
        if built is None:
            self._json(400, {'error': 'invalid mail payload'})
            return
        msg, recipients = built
        try:
            client = _smtp_connect(creds, timeout=30.0)
            try:
                client.send_message(msg, to_addrs=recipients)
            finally:
                try: client.quit()
                except Exception: pass
            self._json(200, {'ok': True})
        except smtplib.SMTPAuthenticationError:
            self._json(502, {'ok': False, 'detail': 'auth'})
        except smtplib.SMTPRecipientsRefused:
            self._json(400, {'ok': False, 'detail': 'recipients_refused'})
        except (smtplib.SMTPException, ssl.SSLError, socket.timeout, OSError) as e:
            self._json(502, {'ok': False, 'detail': type(e).__name__})

    # ── Backup endpoints ────────────────────────────────────────────────

    def _handle_backups_get(self):
        """GET /api/backups — list backups; GET /api/backups/<date> — download ZIP."""
        path = self.path.split('?')[0]
        idx = path.find(BACKUPS_PREFIX)
        suffix = path[idx + len(BACKUPS_PREFIX):].strip('/')
        if not suffix:
            # List all available backups
            self._json(200, _list_backups())
            return
        # Expect a date like YYYY-MM-DD
        if not re.match(r'^\d{4}-\d{2}-\d{2}$', suffix):
            self._json(400, {'error': 'invalid date format, use YYYY-MM-DD'})
            return
        data = _backup_to_zip(suffix)
        if data is None:
            self._json(404, {'error': 'backup not found'})
            return
        self.send_response(200)
        self.send_header('Content-Type', 'application/zip')
        self.send_header('Content-Length', len(data))
        self.send_header('Content-Disposition',
                         f'attachment; filename="backup_{suffix}.zip"')
        self._add_security_headers()
        self.end_headers()
        self.wfile.write(data)

    def _handle_backup_trigger(self):
        """POST /api/backups/trigger — run an immediate manual backup."""
        # Read (and discard) body if any
        self._read_body(max_len=256)
        try:
            date_str = _run_backup()
            self._json(200, {'ok': True, 'date': date_str})
        except Exception:
            self._json(500, {'error': 'backup failed'})

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

    # Start background backup thread (AGP 7-year retention)
    _backup_thread = threading.Thread(target=_backup_loop, daemon=True)
    _backup_thread.start()
    print(f'Backup thread gestart (dagelijks naar {BACKUP_DIR})', flush=True)

    # Start background auto-measurement thread (every 10 minutes)
    _metingen_thread = threading.Thread(target=_auto_metingen_loop, daemon=True)
    _metingen_thread.start()
    print('Auto-metingen thread gestart (elke 10 minuten)', flush=True)

    # Start background cold-crash thread (every minute — ramp-steps are hourly)
    _coldcrash_thread = threading.Thread(target=_cold_crash_loop, daemon=True)
    _coldcrash_thread.start()
    print('Cold-crash thread gestart (elke minuut)', flush=True)

    # ThreadingHTTPServer: één trage upstream-call (Claude 90s, Brewfather 30s,
    # SMTP 30s) mag niet alle andere requests — UI laden, data-saves — blokkeren.
    server = http.server.ThreadingHTTPServer(('0.0.0.0', port), BrouwerijHandler)
    server.serve_forever()
