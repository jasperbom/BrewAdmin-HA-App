#!/usr/bin/env python3
"""
Brouwerij Admin - backend server
Serves the HTML app and stores all data in a SQLite database at
/data/brewadmin.db (ERP-plan 4.1); legacy /data/<key>.json files are
migrated into the database on first start.

Supports Home Assistant Ingress: requests arrive with a path prefix like
  /api/hassio_ingress/<TOKEN>/api/data/<key>
The server strips any prefix and looks for /api/data/<key> anywhere in the path.
"""
import base64
import datetime
import email.message
import email.utils
import hashlib
import http.cookies
import http.server
import io
import ipaddress
import json
import logging
import os
import sys
import re
import secrets
import shutil
import smtplib
import socket
import sqlite3
import ssl
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path

# Overridebaar via env voor tests/dev zonder schrijfrechten op /data
# (bv. GitHub Actions-runners draaien niet als root). In de addon blijft
# dit gewoon /data.
DATA_DIR = Path(os.environ.get('BREWADMIN_DATA_DIR', '/data'))
STATIC_FILE = Path('/app/static/index.html')
MAX_CONTENT_LENGTH = 10 * 1024 * 1024  # 10 MB — bescherming tegen DoS via grote requests
UPLOAD_DIR = DATA_DIR / 'inkoop_facturen'

BACKUP_DIR = DATA_DIR / 'backups'
AUDIT_DIR = DATA_DIR / 'server_audit'

DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
BACKUP_DIR.mkdir(parents=True, exist_ok=True)
AUDIT_DIR.mkdir(parents=True, exist_ok=True)


# ── Gestructureerde logging (ERP-plan 3.6) ────────────────────────────────
# Eén JSON-regel per gebeurtenis naar stdout (machine-leesbaar in de
# HA-addon-logs), met een vast `bron`-veld per subsysteem. Vervangt de losse
# print()-regels.

class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        regel = {
            'ts': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
            'level': record.levelname.lower(),
            'msg': record.getMessage(),
        }
        velden = getattr(record, 'velden', None)
        if isinstance(velden, dict):
            regel.update(velden)
        return json.dumps(regel, ensure_ascii=False)


def _maak_logger() -> logging.Logger:
    lg = logging.getLogger('brewadmin')
    lg.setLevel(logging.INFO)
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(_JsonFormatter())
    lg.addHandler(handler)
    lg.propagate = False
    return lg


_logger = _maak_logger()


def _log(bron: str, msg: str, level: int = logging.INFO, **velden) -> None:
    _logger.log(level, msg, extra={'velden': {'bron': bron, **velden}})


# Referenties naar de achtergrondthreads, gezet in __main__ zodat /api/health
# hun status kan rapporteren. Leeg wanneer de server niet via __main__ draait
# (bv. onder pytest) — health meldt de threads dan als niet-gestart.
_threads: dict = {}
_start_tijd = time.monotonic()


def _laatste_backup_datum():
    """Datum (YYYY-MM-DD) van de nieuwste lokale backupmap, of None."""
    try:
        datums = sorted(d.name for d in BACKUP_DIR.iterdir() if d.is_dir())
        return datums[-1] if datums else None
    except OSError:
        return None

API_DATA_PREFIX = '/api/data/'
HEALTH_PATH = '/api/health'
WHOAMI_PATH = '/api/whoami'
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
NEXTNR_PATH              = '/api/nextnr'
COMMIT_PATH              = '/api/commit'
DELTA_PREFIX             = '/api/delta/'
COMMIT_MAX_KEYS          = 50
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
    creds = _read_json('woocommerce_creds')
    if not isinstance(creds, dict):
        return None
    try:
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
    creds = _read_json('claude_creds')
    if not isinstance(creds, dict):
        return None
    try:
        key = str(creds.get('apiKey', '')).strip()
        return key if key.startswith('sk-ant-') else None
    except Exception:
        return None


def _load_bf_creds() -> tuple[str, str] | None:
    """Read stored Brewfather credentials; returns (userId, apiKey) or None."""
    creds = _read_json('brewfather_creds')
    if not isinstance(creds, dict):
        return None
    try:
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
    c = _read_json('smtp_creds')
    if not isinstance(c, dict):
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

# Off-volume kopie (ERP-plan 0.5): /backup is een ándere HA-map dan /data
# (config.yaml map: backup:rw). Gaat het data-volume verloren, dan zijn de
# ZIP-backups daar nog. Bestaat de map niet (addon zonder mapping, lokale
# dev), dan wordt de off-volume stap stil overgeslagen.
OFFSITE_BACKUP_DIR = Path('/backup/brewadmin')


def _run_backup() -> str:
    """Exporteer alle data-keys als JSON-bestanden (zelfde vorm als vóór de
    SQLite-migratie — leesbaar en restore-baar zonder tooling) plus een
    consistente kopie van de database zelf naar /data/backups/YYYY-MM-DD/,
    samen met de upload-map met factuurbijlagen, en schrijf dezelfde snapshot
    als ZIP naar de off-volume /backup-map. Returns the backup date string."""
    today = datetime.date.today().isoformat()
    dest = BACKUP_DIR / today
    dest.mkdir(parents=True, exist_ok=True)
    conn = _db()
    # Onder _data_lock: geen schrijver halverwege de export, zodat de
    # JSON-bestanden en de db-kopie hetzelfde consistente moment vastleggen.
    with _data_lock:
        keys = [r[0] for r in conn.execute('SELECT key FROM versies ORDER BY key')]
        for key in keys:
            gelezen = _lees_key_bytes(key)
            if gelezen is not None:
                _atomic_write_bytes(dest / f'{key}.json', gelezen[0])
        # sqlite-backup-API: consistente kopie, ook met een open WAL.
        kopie = sqlite3.connect(str(dest / DB_NAAM))
        try:
            conn.backup(kopie)
        finally:
            kopie.close()
    try:
        os.chmod(dest / DB_NAAM, 0o600)
    except OSError:
        pass
    # Upload-bijlagen (factuur-PDF's/afbeeldingen) horen bij de administratie
    # en vallen onder dezelfde bewaarplicht — meenemen in de backup.
    if UPLOAD_DIR.is_dir():
        shutil.copytree(UPLOAD_DIR, dest / UPLOAD_DIR.name, dirs_exist_ok=True)
    # Server-audit (ERP-plan 1.5) hoort óók bij de administratie.
    if AUDIT_DIR.is_dir():
        shutil.copytree(AUDIT_DIR, dest / AUDIT_DIR.name, dirs_exist_ok=True)
    _offsite_backup(dest, today)
    return today


def _offsite_backup(dest: Path, today: str) -> None:
    """Schrijf de dag-backup als ZIP naar de HA /backup-map (ander volume).
    Atomair via tmp+rename; fouten alleen loggen zodat de lokale backup
    nooit faalt door een ontbrekende/volle backup-map."""
    if not OFFSITE_BACKUP_DIR.parent.is_dir():
        return
    try:
        OFFSITE_BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        tmp = OFFSITE_BACKUP_DIR / f'.brewadmin_backup_{today}.zip.tmp'
        with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zf:
            for f in sorted(dest.rglob('*')):
                if f.is_file():
                    zf.write(f, str(f.relative_to(dest)))
        os.replace(tmp, OFFSITE_BACKUP_DIR / f'brewadmin_backup_{today}.zip')
    except OSError as exc:
        _log('backup', f'offsite backup failed: {exc}', level=logging.ERROR)


def _cleanup_offsite_backups() -> None:
    """Zelfde retentiebeleid als de lokale backups, toegepast op de
    off-volume ZIP's."""
    if not OFFSITE_BACKUP_DIR.is_dir():
        return
    today = datetime.date.today()
    for f in OFFSITE_BACKUP_DIR.glob('brewadmin_backup_*.zip'):
        datum = f.name[len('brewadmin_backup_'):-len('.zip')]
        try:
            backup_date = datetime.date.fromisoformat(datum)
        except ValueError:
            continue
        if not _should_keep_backup(backup_date, today):
            try:
                f.unlink()
            except OSError:
                pass


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
            _cleanup_offsite_backups()
            _cleanup_audit()
        except Exception as exc:
            _log('backup', f'error: {exc}', level=logging.ERROR)
        time.sleep(interval)


# ── Automatische gistmetingen ─────────────────────────────────────────────

_data_lock = threading.Lock()


# ── SQLite-opslaglaag (ERP-plan 4.1) ──────────────────────────────────────
# Alle app-data leeft in één SQLite-database (stdlib — past binnen de
# "stdlib only"-constraint) i.p.v. losse JSON-bestanden. De /api/data-API
# blijft ongewijzigd: GET/POST werken nog steeds met complete JSON-payloads
# en dezelfde X-Data-Version-headers. Wat de database toevoegt:
#   - échte transacties: /api/commit is één BEGIN…COMMIT i.p.v. de
#     twee-fasen tempfile+rename-aanpak van plan 1.1;
#   - WAL-concurrency: lezers blokkeren nooit op de (enkele) schrijver;
#   - rij-per-record voor array-keys (tabel `records`) — de fundering voor
#     delta-sync en deelset-query's (plan 4.3).
# Bewuste afwijkingen van het plan: één generieke `records`-tabel i.p.v.
# ~85 losse tabellen (zelfde doel, geen dynamische DDL nodig) en geen
# SQL-foreign-keys — records blijven generieke JSON-documenten, dus
# referentiële integriteit blijft app-side (checkIntegriteit, plan 1.3).
# Bestaande /data/*.json-bestanden worden bij de eerste start automatisch
# geïmporteerd en als veiligheidskopie verplaatst naar /data/json_voor_sqlite/.

DB_NAAM = 'brewadmin.db'
JSON_MIGRATIE_DIRNAAM = 'json_voor_sqlite'

_db_local = threading.local()
_db_init_lock = threading.Lock()
_db_geinitialiseerd: set[str] = set()


def _db_pad() -> Path:
    return DATA_DIR / DB_NAAM


def _chmod_db_bestanden() -> None:
    """0600 op de database en de WAL/SHM-sidecars — zelfde afscherming als
    de vroegere losse creds-bestanden (ERP-plan 0.6), nu voor de hele opslag
    omdat de credentials mee in de database zitten."""
    basis = _db_pad()
    for pad in (basis, Path(f'{basis}-wal'), Path(f'{basis}-shm')):
        if pad.exists():
            try:
                os.chmod(pad, 0o600)
            except OSError:
                pass


def _maak_schema(conn: sqlite3.Connection) -> None:
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS records(
            key       TEXT    NOT NULL,
            seq       INTEGER NOT NULL,
            record_id TEXT,
            data      TEXT    NOT NULL,
            PRIMARY KEY(key, seq)
        );
        CREATE INDEX IF NOT EXISTS idx_records_key_id ON records(key, record_id);
        CREATE TABLE IF NOT EXISTS kv(
            key  TEXT PRIMARY KEY,
            data TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS versies(
            key    TEXT PRIMARY KEY,
            versie TEXT NOT NULL,
            soort  TEXT NOT NULL
        );
    ''')
    conn.commit()


def _json_compact(waarde) -> str:
    """Compacte, deterministische JSON-serialisatie (zelfde vorm als
    JSON.stringify in de frontend)."""
    return json.dumps(waarde, ensure_ascii=False, separators=(',', ':'))


def _schrijf_key(conn: sqlite3.Connection, key: str, waarde) -> tuple[str, int]:
    """Schrijf één key binnen de lopende transactie van `conn`. Arrays worden
    rij-per-record opgeslagen (tabel `records`), al het andere als één
    JSON-document (tabel `kv`). Retourneert (versie, payload_bytes).
    De versie is de hash over exact de bytes die _lees_key_bytes later weer
    samenstelt, zodat de optimistic-locking-headers blijven kloppen."""
    payload = _json_compact(waarde).encode('utf-8')
    versie = hashlib.sha256(payload).hexdigest()[:16]
    conn.execute('DELETE FROM records WHERE key=?', (key,))
    conn.execute('DELETE FROM kv WHERE key=?', (key,))
    if isinstance(waarde, list):
        rows = []
        for seq, el in enumerate(waarde):
            rid = None
            if isinstance(el, dict) and el.get('id') is not None:
                rid = str(el['id'])
            rows.append((key, seq, rid, _json_compact(el)))
        conn.executemany(
            'INSERT INTO records(key, seq, record_id, data) VALUES(?,?,?,?)', rows)
        soort = 'array'
    else:
        conn.execute('INSERT INTO kv(key, data) VALUES(?,?)',
                     (key, payload.decode('utf-8')))
        soort = 'kv'
    conn.execute(
        'INSERT INTO versies(key, versie, soort) VALUES(?,?,?) '
        'ON CONFLICT(key) DO UPDATE SET versie=excluded.versie, soort=excluded.soort',
        (key, versie, soort))
    return versie, len(payload)


def _migreer_json_bestanden(conn: sqlite3.Connection) -> None:
    """Eenmalige migratie: importeer bestaande /data/<key>.json-bestanden in
    de database en verplaats ze daarna als veiligheidskopie naar
    json_voor_sqlite/ (buiten de data-API en de reguliere backups om).
    Idempotent: een key die al in de database staat wordt niet opnieuw
    geïmporteerd; onleesbare bestanden blijven staan en worden gelogd."""
    # options.json is van de Supervisor (addon-opties), geen app-data —
    # nooit migreren of verplaatsen.
    bestanden = [f for f in sorted(DATA_DIR.glob('*.json'))
                 if f.is_file() and _valid_key(f.stem) and f.stem != 'options']
    if not bestanden:
        return
    doel = DATA_DIR / JSON_MIGRATIE_DIRNAAM
    geimporteerd = verplaatst = 0
    for f in bestanden:
        key = f.stem
        try:
            waarde = json.loads(f.read_text(encoding='utf-8'))
        except (OSError, json.JSONDecodeError) as exc:
            _log('sqlite', f'migratie: {f.name} onleesbaar, blijft staan: {exc}',
                 level=logging.ERROR)
            continue
        if conn.execute('SELECT 1 FROM versies WHERE key=?', (key,)).fetchone() is None:
            with conn:
                _schrijf_key(conn, key, waarde)
            geimporteerd += 1
        doel.mkdir(exist_ok=True)
        bestemming = doel / f.name
        if bestemming.exists():
            bestemming = doel / f'{f.stem}.{int(time.time())}.json'
        shutil.move(str(f), str(bestemming))
        try:
            # De veiligheidskopieën kunnen credentials bevatten — zelfde
            # 0600-afscherming als de database zelf.
            os.chmod(bestemming, 0o600)
        except OSError:
            pass
        verplaatst += 1
    _log('sqlite', f'JSON-migratie: {geimporteerd} key(s) geïmporteerd, '
                   f'{verplaatst} bestand(en) verplaatst naar {doel.name}/')


def _db() -> sqlite3.Connection:
    """Thread-lokale verbinding met de database van de huidige DATA_DIR.
    De eerste verbinding per database maakt het schema aan en draait de
    JSON-migratie. Schrijvers serialiseren via _data_lock (zoals voorheen);
    dankzij WAL wachten lezers daar nooit op."""
    pad = str(_db_pad())
    conn = getattr(_db_local, 'conn', None)
    if conn is not None and getattr(_db_local, 'pad', None) == pad:
        return conn
    if conn is not None:
        try:
            conn.close()
        except sqlite3.Error:
            pass
    with _db_init_lock:
        eerste = pad not in _db_geinitialiseerd
        conn = sqlite3.connect(pad, timeout=30)
        conn.execute('PRAGMA journal_mode=WAL')
        # FULL: elke commit fsynct de WAL — financiële data mag ook bij
        # stroomuitval geen bevestigde commit verliezen.
        conn.execute('PRAGMA synchronous=FULL')
        if eerste:
            _maak_schema(conn)
            _migreer_json_bestanden(conn)
            _chmod_db_bestanden()
            _db_geinitialiseerd.add(pad)
    _db_local.conn = conn
    _db_local.pad = pad
    return conn


def _lees_key_bytes(key: str) -> tuple[bytes, str] | None:
    """Lees één key als (JSON-bytes, versie), of None wanneer de key niet
    bestaat. De array-vorm wordt uit de record-rijen samengesteld en is
    byte-identiek aan wat _schrijf_key hashte — de versie-header klopt dus
    altijd met de geserveerde inhoud."""
    conn = _db()
    rij = conn.execute('SELECT versie, soort FROM versies WHERE key=?', (key,)).fetchone()
    if rij is None:
        return None
    versie, soort = rij
    if soort == 'array':
        delen = [r[0] for r in conn.execute(
            'SELECT data FROM records WHERE key=? ORDER BY seq', (key,))]
        return ('[' + ','.join(delen) + ']').encode('utf-8'), versie
    kv = conn.execute('SELECT data FROM kv WHERE key=?', (key,)).fetchone()
    return (kv[0] if kv else 'null').encode('utf-8'), versie


def _read_json(key: str, default=None):
    """Lees een data-key uit de SQLite-opslag. Geeft default terug als de key niet bestaat."""
    gelezen = _lees_key_bytes(key)
    if gelezen is None:
        return default
    try:
        return json.loads(gelezen[0])
    except json.JSONDecodeError:
        return default


# ── Append-only server-audit (ERP-plan 1.5) ──────────────────────────────
# De client-side audit_log is via de gewone data-API herschrijfbaar en dus
# niet bewijskrachtig. De server logt daarom élke mutatie (data-POST,
# commit, nummeruitgifte) naar maandelijkse JSONL-bestanden in
# /data/server_audit/. Die map is bewust NIET bereikbaar via de data-API
# (keys kennen geen pad-scheidingstekens) — alleen te lezen op de host en
# via de backup. Audit-schrijffouten blokkeren nooit de eigenlijke write.

_audit_lock = threading.Lock()


def _audit_write(actie: str, key: str, **velden) -> None:
    entry = {
        'ts': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
        'actie': actie,
        'key': key,
        **velden,
    }
    bestand = AUDIT_DIR / f'audit_{datetime.date.today().strftime("%Y-%m")}.jsonl'
    try:
        with _audit_lock, open(bestand, 'a', encoding='utf-8') as f:
            f.write(json.dumps(entry, ensure_ascii=False) + '\n')
    except OSError:
        pass


def _cleanup_audit() -> None:
    """Verwijder audit-maandbestanden ouder dan 7 jaar (zelfde AGP-horizon
    als de backups)."""
    grens = datetime.date.today() - datetime.timedelta(days=7 * 365)
    for f in AUDIT_DIR.glob('audit_*.jsonl'):
        try:
            maand = datetime.datetime.strptime(f.name[len('audit_'):-len('.jsonl')], '%Y-%m').date()
        except ValueError:
            continue
        if maand < grens.replace(day=1):
            try:
                f.unlink()
            except OSError:
                pass


# ── Lichte schemavalidatie (ERP-plan 1.4) ────────────────────────────────
# De server accepteerde elke geldige JSON onder elke key; één verkeerd
# POST-je (bv. een object waar een array hoort) maakte de app-data kapot.
# Per bekende key wordt nu minimaal het containertype afgedwongen (422 bij
# afwijking). Onbekende keys blijven vrij (voorwaartse compatibiliteit).

_KEY_TYPES = {
    # arrays (records)
    **{k: 'array' for k in (
        'ingredienten', 'lots', 'batches', 'batch_ingredienten', 'afvullingen',
        'uitslagen', 'uitleveringen', 'accijns', 'verpakkingen', 'onderdelen',
        'voorraad_log', 'voorraad_archief', 'voorraad_gesloten_bieren',
        'recepten', 'recepten_verborgen', 'recepten_gearchiveerde_tags',
        'recepten_tag_volgorde', 'recepten_gesloten_groepen', 'tanks',
        'tank_reinigingslog', 'artikelen', 'hygiene_items', 'hygiene_groups',
        'brouwdag_checklist', 'botteldag_checklist', 'batch_taken_items',
        'batch_taken_groepen', 'inkoop_facturen', 'scan_correcties',
        'verkoop_facturen', 'bestellingen', 'bestelling_picks', 'afboekingen',
        'klanten', 'gist_metingen', 'carbonatie_sessies', 'verlies_registraties',
        'brouwdag_stappen', 'water_addities', 'water_profielen',
        'water_doelprofielen', 'hop_addities', 'dry_hops', 'koel_logs',
        'batch_notities', 'kapitaal_boekingen', 'alt_rekeningen',
        'inventarisaties', 'audit_log', 'accijns_aangiftes', 'btw_aangiftes',
        'journaal', 'jaarafsluitingen',
        'producten', 'product_artikelen', 'haccp_schoonmaak_taken',
        'haccp_schoonmaak_log', 'haccp_ccp_definities', 'haccp_ccp_metingen',
        'haccp_capa', 'haccp_waterkwaliteit', 'haccp_ongedierte',
        'haccp_opleidingen', 'locaties', 'verplaatsingen', 'btw_tarieven',
        'ing_types', 'kosten_soorten', 'gn_codes',
    )},
    # objecten (instellingen/koppeltabellen)
    **{k: 'object' for k in (
        'accijns_instellingen', 'btw_instellingen', 'ing_type_btw',
        'brewery_details', 'mail_templates', 'factuur_counter',
        'nummer_reeksen', 'ha_instellingen', 'notificatie_instellingen',
        'coldcrash_instellingen', 'planning_instellingen',
        'brouwproces_instellingen', 'bank_koppelingen', 'bank_saldi',
        'tank_statussen', 'gebruikers_rollen', 'login_instellingen',
        'brewfather_creds', 'woocommerce_creds', 'claude_creds', 'smtp_creds',
    )},
    # scalars
    'app_name':     'string',
    'nav_theme':    'string',
    'app_logo':     'string_or_null',
    'factuur_logo': 'string_or_null',
}


def _payload_geldig(key: str, parsed) -> bool:
    """True wanneer de payload het verwachte containertype heeft (of de key
    onbekend is)."""
    verwacht = _KEY_TYPES.get(key)
    if verwacht is None:
        return True
    if verwacht == 'array':
        return isinstance(parsed, list)
    if verwacht == 'object':
        return isinstance(parsed, dict)
    if verwacht == 'string':
        return isinstance(parsed, str)
    if verwacht == 'string_or_null':
        return parsed is None or isinstance(parsed, str)
    return True


# ── Append-only keys (ERP-plan 2.1) ──────────────────────────────────────
# Het journaal is de onveranderlijke financiële vastlegging: bestaande regels
# mogen nooit gewijzigd of verwijderd worden, alleen aangevuld (correcties
# gaan via storno-regels). De server dwingt dat af: een POST/commit die een
# bestaande regel mist of wijzigt wordt met 422 geweigerd. Aanroepen onder
# _data_lock (leest de huidige inhoud uit de database).

_APPEND_ONLY = ('journaal',)


def _append_only_ok(key: str, parsed) -> bool:
    """True wanneer de nieuwe payload alle bestaande regels ongewijzigd bevat
    (vergelijking per id). Alleen relevant voor keys in _APPEND_ONLY."""
    if key not in _APPEND_ONLY or not isinstance(parsed, list):
        return True
    huidig = _read_json(key)
    if not isinstance(huidig, list):
        return True  # onbestaande/afwijkende inhoud nooit een reden om een write te blokkeren
    nieuw_per_id = {r.get('id'): r for r in parsed if isinstance(r, dict)}
    for regel in huidig:
        if not isinstance(regel, dict):
            continue
        nieuw = nieuw_per_id.get(regel.get('id'))
        if nieuw is None:
            return False
        if json.dumps(nieuw, sort_keys=True) != json.dumps(regel, sort_keys=True):
            return False
    return True


# ── Secrets afschermen (ERP-plan 0.6) ────────────────────────────────────
# Credentials staan als JSON in /data, maar de gevoelige velden mogen nooit
# plaintext terug naar de browser. GET maskeert ze met een sentinel; POST
# vervangt de sentinel weer door de opgeslagen waarde (zodat de UI kan
# opslaan zonder het geheim ooit te kennen). Bestanden krijgen mode 0600.

_SECRET_SENTINEL = '__SECRET__'
_SECURE_FIELDS = {
    'brewfather_creds':  ('apiKey',),
    'woocommerce_creds': ('consumerKey', 'consumerSecret'),
    'claude_creds':      ('apiKey',),
    'smtp_creds':        ('password',),
}


def _mask_secrets(key: str, data):
    """Vervang gevoelige velden door de sentinel vóór verzending naar de client."""
    velden = _SECURE_FIELDS.get(key)
    if not velden or not isinstance(data, dict):
        return data
    masked = dict(data)
    for veld in velden:
        if masked.get(veld):
            masked[veld] = _SECRET_SENTINEL
    return masked


def _unmask_secrets(key: str, data):
    """Vervang sentinel-waarden door de eerder opgeslagen geheimen (bij POST)."""
    velden = _SECURE_FIELDS.get(key)
    if not velden or not isinstance(data, dict):
        return data
    if not any(data.get(v) == _SECRET_SENTINEL for v in velden):
        return data
    stored = _read_json(key, {})
    if not isinstance(stored, dict):
        stored = {}
    result = dict(data)
    for veld in velden:
        if result.get(veld) == _SECRET_SENTINEL:
            result[veld] = stored.get(veld, '')
    return result


def _harden_secure_files() -> None:
    """Zet bestandsrechten 0600 op de database (bevat o.a. de credentials) en
    op eventueel nog aanwezige legacy creds-JSON-bestanden (eenmalig bij start)."""
    _chmod_db_bestanden()
    for key in _SECURE_FIELDS:
        f = DATA_DIR / f'{key}.json'
        if f.exists():
            try:
                os.chmod(f, 0o600)
            except OSError:
                pass


# ── Directe toegang met HA-login (tweede poort) ──────────────────────────
# Naast de HA-ingress (poort 8099, alleen bereikbaar via de ingress-gateway)
# luistert de server op een tweede poort voor directe toegang, bv. vanaf een
# tablet in de brouwerij zonder HA-frontend. Die poort is standaard NIET
# gepubliceerd (config.yaml `ports: 8098/tcp: null`) — de gebruiker zet hem
# bewust aan in de addon-netwerkconfig. Beveiliging:
#   - login met het échte HA-account: de Supervisor valideert
#     gebruikersnaam/wachtwoord via POST http://supervisor/auth
#     (config.yaml `auth_api: true`);
#   - na login een HttpOnly/SameSite=Strict sessiecookie (in-memory,
#     verlopen na inactiviteit; addon-herstart = opnieuw inloggen);
#   - X-Remote-User-headers worden op deze poort volledig genegeerd
#     (die zijn daar spoofbaar) — de sessiegebruiker telt als gebruiker
#     voor het rollenmodel (4.2) en de audit;
#   - strenge login-rate-limit per IP tegen brute force, pogingen worden
#     geauditeerd (zonder wachtwoord).
# Buiten HA (geen SUPERVISOR_TOKEN) antwoordt login met 503 — de directe
# poort is dan onbruikbaar (lokale dev gebruikt gewoon de hoofdpoort).

DIRECT_PORT = int(os.environ.get('BREWADMIN_DIRECT_PORT', 8098))
# HA-conventie: certificaten (Let's Encrypt-/DuckDNS-addon) staan in /ssl.
SSL_DIR = Path(os.environ.get('BREWADMIN_SSL_DIR', '/ssl'))
LOGIN_PATH = '/api/login'
LOGOUT_PATH = '/api/logout'
SESSIE_COOKIE = 'brewadmin_sessie'
SESSIE_DUUR = 24 * 3600  # 24 uur, glijdend verlengd bij gebruik

_LOGIN_RATE_WINDOW = 300  # 5 minuten
_LOGIN_RATE_MAX = 5       # max mislukte pogingen per IP per venster
_login_pogingen: dict = defaultdict(list)

_sessies: dict = {}
_sessie_lock = threading.Lock()


def _login_rate_ok(ip: str) -> bool:
    now = time.monotonic()
    _login_pogingen[ip] = [t for t in _login_pogingen[ip]
                           if now - t < _LOGIN_RATE_WINDOW]
    return len(_login_pogingen[ip]) < _LOGIN_RATE_MAX


def _login_poging_registreer(ip: str) -> None:
    _login_pogingen[ip].append(time.monotonic())


def _sessie_maak(gebruiker: str) -> str:
    token = secrets.token_urlsafe(32)
    with _sessie_lock:
        _sessies[token] = {'gebruiker': gebruiker,
                           'verloopt': time.monotonic() + SESSIE_DUUR}
    return token


def _sessie_gebruiker(token: str) -> str | None:
    """Gebruiker bij dit sessietoken, of None. Geldige sessies worden
    glijdend verlengd; verlopen sessies worden opgeruimd."""
    if not token:
        return None
    now = time.monotonic()
    with _sessie_lock:
        sessie = _sessies.get(token)
        if sessie is None:
            return None
        if sessie['verloopt'] < now:
            del _sessies[token]
            return None
        sessie['verloopt'] = now + SESSIE_DUUR
        return sessie['gebruiker']


def _sessie_verwijder(token: str) -> None:
    with _sessie_lock:
        _sessies.pop(token, None)


def _addon_opties() -> dict:
    """Addon-opties zoals de Supervisor die in /data/options.json zet
    (ssl/certfile/keyfile). Leeg dict buiten HA of bij leesfouten."""
    try:
        opties = json.loads((DATA_DIR / 'options.json').read_text(encoding='utf-8'))
        return opties if isinstance(opties, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _valid_certnaam(naam: str) -> bool:
    """Alleen kale bestandsnamen binnen /ssl — geen padcomponenten."""
    return bool(naam) and '/' not in naam and '\\' not in naam and not naam.startswith('.')


def _ssl_context(certfile: str, keyfile: str) -> ssl.SSLContext | None:
    """TLS-context voor de directe poort met certificaten uit /ssl
    (bv. van de Let's Encrypt-addon voor je eigen domein). None wanneer de
    bestanden ontbreken of ongeldig zijn — de aanroeper start de poort dan
    NIET (fail-closed: nooit stil terugvallen op onversleuteld)."""
    if not _valid_certnaam(certfile) or not _valid_certnaam(keyfile):
        _log('ssl', f'ongeldige certfile/keyfile-naam: {certfile!r}/{keyfile!r}',
             level=logging.ERROR)
        return None
    cert_pad = SSL_DIR / certfile
    key_pad = SSL_DIR / keyfile
    try:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.minimum_version = ssl.TLSVersion.TLSv1_2
        ctx.load_cert_chain(str(cert_pad), str(key_pad))
        return ctx
    except (OSError, ssl.SSLError) as exc:
        _log('ssl', f'certificaat laden mislukt ({cert_pad}): {exc}',
             level=logging.ERROR)
        return None


def _ssl_reload_loop(ctx: ssl.SSLContext, certfile: str, keyfile: str,
                     interval: float = 86400.0) -> None:
    """Herlaad het certificaat dagelijks op de bestaande context: nieuwe
    verbindingen gebruiken dan het vernieuwde Let's Encrypt-certificaat
    zonder addon-herstart. Fouten alleen loggen (oude cert blijft werken)."""
    while True:
        time.sleep(interval)
        try:
            ctx.load_cert_chain(str(SSL_DIR / certfile), str(SSL_DIR / keyfile))
            _log('ssl', 'certificaat herladen')
        except (OSError, ssl.SSLError) as exc:
            _log('ssl', f'certificaat herladen mislukt: {exc}', level=logging.ERROR)


def _ha_auth_check(gebruiker: str, wachtwoord: str) -> str:
    """Valideer HA-credentials via de Supervisor-auth-API (vereist
    `auth_api: true` in config.yaml). Retourneert:
      'ok'        — credentials kloppen;
      'ongeldig'  — Supervisor zegt 401: verkeerde gebruikersnaam/wachtwoord
                    (let op: de HA-gebruikersnaam, niet de weergavenaam);
      'geweigerd' — Supervisor zegt 403: de addon mag de auth-API (nog) niet
                    gebruiken — auth_api-recht niet actief, herstart/update
                    de addon volledig;
      'fout'      — Supervisor onbereikbaar of onverwacht antwoord.
    De niet-401-gevallen worden gelogd (nooit de invoer zelf) zodat het
    addon-logboek de echte oorzaak toont i.p.v. een generieke loginfout."""
    token = os.environ.get('SUPERVISOR_TOKEN', '')
    if not token or not gebruiker or not wachtwoord:
        return 'fout'
    try:
        req = urllib.request.Request(
            'http://supervisor/auth',
            data=json.dumps({'username': gebruiker, 'password': wachtwoord}).encode('utf-8'),
            headers={'Authorization': f'Bearer {token}',
                     'Content-Type': 'application/json'},
            method='POST',
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            if 200 <= r.status < 300:
                return 'ok'
            _log('login', f'supervisor-auth gaf onverwacht {r.status}',
                 level=logging.ERROR, status=r.status)
            return 'fout'
    except urllib.error.HTTPError as e:
        if e.code == 401:
            return 'ongeldig'
        _log('login', f'supervisor-auth weigerde met {e.code}'
                      f'{" — auth_api-recht niet actief? Herstart/update de addon" if e.code == 403 else ""}',
             level=logging.ERROR, status=e.code)
        return 'geweigerd' if e.code == 403 else 'fout'
    except (urllib.error.URLError, OSError) as exc:
        _log('login', f'supervisor-auth onbereikbaar: {exc}', level=logging.ERROR)
        return 'fout'


# Minimale loginpagina voor de directe poort. Bewust server-side en
# zelfstandig (de SPA is hier nog niet geladen); inline CSS/JS valt binnen
# de bestaande CSP ('unsafe-inline'). De pagina is stylebaar via de
# `login_instellingen`-key (Instellingen → App → Loginpagina): titel,
# ondertitel, knoptekst, accent-/achtergrondkleur, achtergrondafbeelding en
# het app-logo. LET OP: dit is een pre-auth-pagina — alle teksten worden
# ge-escaped en kleuren/afbeeldingen strikt gevalideerd (fallback naar de
# defaults), anders zou een beheerd veld hier XSS kunnen injecteren.

_KLEUR_RE = re.compile(r'^#[0-9a-fA-F]{3,8}$')
_DATA_IMG_RE = re.compile(r'^data:image/(png|jpe?g|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=\s]+$')
_LOGIN_AFB_MAX = 1_500_000  # ~1,1 MB afbeelding als base64


def _login_pagina() -> bytes:
    """Render de loginpagina met de opgeslagen styling (of de defaults)."""
    import html as _html
    inst = _read_json('login_instellingen', {})
    if not isinstance(inst, dict):
        inst = {}
    app_name = _read_json('app_name', '')

    titel = _html.escape(str(inst.get('titel') or app_name or 'BrewAdmin')[:60])
    ondertitel = _html.escape(str(inst.get('ondertitel')
                                  or 'Log in met je Home Assistant-account')[:120])
    knop = _html.escape(str(inst.get('knop_tekst') or 'Inloggen')[:40])

    def kleur(veld: str, standaard: str) -> str:
        w = inst.get(veld)
        return w if isinstance(w, str) and _KLEUR_RE.match(w) else standaard

    accent = kleur('accent', '#b45309')
    achtergrond = kleur('achtergrond', '#1c1917')
    # CSS-shorthand: kleur als laatste; afbeelding alleen wanneer die het
    # strikte data-url-patroon volgt (nooit ruwe invoer in de CSS).
    body_bg = achtergrond
    afb = inst.get('achtergrond_afbeelding')
    if isinstance(afb, str) and len(afb) <= _LOGIN_AFB_MAX and _DATA_IMG_RE.match(afb):
        body_bg = f'url("{afb}") center/cover no-repeat fixed {achtergrond}'

    logo_html = ''
    if inst.get('logo_tonen', True):
        logo = _read_json('app_logo')
        if isinstance(logo, str) and len(logo) <= _LOGIN_AFB_MAX and _DATA_IMG_RE.match(logo):
            logo_html = f'<img src="{logo}" alt="" class="logo">'

    pagina = (_LOGIN_PAGE
              .replace('__TITEL__', titel)
              .replace('__ONDERTITEL__', ondertitel)
              .replace('__KNOP__', knop)
              .replace('__ACCENT__', accent)
              .replace('__BODY_BG__', body_bg)
              .replace('__LOGO__', logo_html))
    return pagina.encode('utf-8')


_LOGIN_PAGE = """<!doctype html>
<html lang="nl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>__TITEL__ — inloggen</title>
<style>
body{font-family:system-ui,sans-serif;background:__BODY_BG__;color:#e7e5e4;
display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
form{background:rgba(41,37,36,.92);padding:2rem;border-radius:1rem;width:20rem;
box-shadow:0 8px 30px rgba(0,0,0,.4)}
.logo{display:block;max-height:4.5rem;max-width:12rem;object-fit:contain;
margin:0 auto 1rem}
h1{font-size:1.15rem;margin:0 0 .25rem;color:__ACCENT__;filter:brightness(1.4);
text-align:center}
p{font-size:.8rem;color:#a8a29e;margin:0 0 1.25rem;text-align:center}
label{display:block;font-size:.7rem;text-transform:uppercase;
letter-spacing:.05em;color:#a8a29e;margin-bottom:.25rem}
input{width:100%;box-sizing:border-box;padding:.55rem .7rem;margin-bottom:1rem;
border-radius:.5rem;border:1px solid #44403c;background:#1c1917;color:#e7e5e4}
button{width:100%;padding:.6rem;border:none;border-radius:.5rem;
background:__ACCENT__;color:#fff;font-weight:600;cursor:pointer}
button:hover{filter:brightness(.85)}
#fout{color:#f87171;font-size:.8rem;min-height:1.2rem;margin:.5rem 0 0}
</style></head><body>
<form id="f">
__LOGO__
<h1>__TITEL__</h1>
<p>__ONDERTITEL__</p>
<label for="u">Gebruikersnaam</label>
<input id="u" autocomplete="username" required>
<label for="w">Wachtwoord</label>
<input id="w" type="password" autocomplete="current-password" required>
<button type="submit">__KNOP__</button>
<div id="fout"></div>
</form>
<script>
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fout = document.getElementById('fout');
  fout.textContent = '';
  try {
    const r = await fetch('api/login', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        username: document.getElementById('u').value,
        password: document.getElementById('w').value,
      }),
    });
    if (r.ok) { location.reload(); return; }
    if (r.status === 429) { fout.textContent = 'Te veel pogingen \\u2014 wacht even en probeer opnieuw.'; return; }
    if (r.status === 503) { fout.textContent = 'HA-authenticatie niet beschikbaar (draait de app als addon?).'; return; }
    if (r.status === 502) { fout.textContent = 'HA-authenticatie geweigerd voor deze addon \\u2014 herstart de addon volledig en kijk in het addon-logboek (auth_api).'; return; }
    fout.textContent = 'Inloggen mislukt \\u2014 gebruik je HA-gebruikersnaam (waarmee je in Home Assistant inlogt, niet je weergavenaam) en controleer het wachtwoord.';
  } catch (err) {
    fout.textContent = 'Server niet bereikbaar.';
  }
});
</script></body></html>"""


# ── Gebruikers & rollen (ERP-plan 4.2) ───────────────────────────────────
# HA-ingress geeft de ingelogde gebruiker door (X-Remote-User-Name/-Id;
# sinds plan 1.5 al per mutatie geauditeerd). Daar bovenop nu simpele
# autorisatie: de beheerder wijst per gebruiker een rol toe in de
# `gebruikers_rollen`-key ({gebruikers: {naam: rol}, standaard_rol}).
# Rollen:
#   beheer       — alles (ook instellingen, credentials en rollenbeheer)
#   boekhouding  — financiële + gedeelde keys, geen beheer-instellingen
#   productie    — productie-/gedeelde keys, geen financiële vastlegging
#   alleen_lezen — alleen GET
# Zonder rollenconfiguratie — en buiten HA, waar geen ingress-user bestaat —
# geldt voor iedereen `beheer`: identiek aan het oude gedrag. De headers
# zijn betrouwbaar omdat als addon alleen de ingress-gateway requests mag
# sturen (_client_allowed) en die de X-Remote-User-headers zelf zet.
# Afdwinging is server-side (403 + audit); de UI leest de eigen rol via
# GET /api/whoami.

ROLLEN = ('beheer', 'boekhouding', 'productie', 'alleen_lezen')

# Keys die alleen `beheer` mag schrijven: app-instellingen, integraties,
# credentials en het rollenbeheer zelf.
_BEHEER_KEYS = frozenset((
    'gebruikers_rollen', 'ha_instellingen', 'notificatie_instellingen',
    'coldcrash_instellingen', 'planning_instellingen',
    'brouwproces_instellingen', 'brewery_details', 'mail_templates',
    'app_logo', 'factuur_logo', 'app_name', 'nav_theme', 'login_instellingen',
    'brewfather_creds', 'woocommerce_creds', 'claude_creds', 'smtp_creds',
))

# Financiële vastlegging: alleen `boekhouding` (en `beheer`).
_FINANCIELE_KEYS = frozenset((
    'inkoop_facturen', 'verkoop_facturen', 'scan_correcties', 'journaal',
    'jaarafsluitingen', 'bank_saldi', 'bank_koppelingen',
    'kapitaal_boekingen', 'accijns', 'accijns_aangiftes',
    'accijns_instellingen', 'btw_aangiftes', 'btw_instellingen',
    'btw_tarieven', 'ing_type_btw', 'alt_rekeningen', 'kosten_soorten',
    'gn_codes', 'klanten', 'factuur_counter', 'nummer_reeksen',
))
# Alle overige keys (batches, voorraad, recepten, bestellingen, picks,
# HACCP, …) zijn gedeeld: `boekhouding` én `productie` mogen ze schrijven —
# productiewerk (afvullen, uitslag, picken) raakt onvermijdelijk dezelfde
# stores als de administratie erachter.


def _gebruiker_rol(gebruiker: str) -> str:
    """Rol van deze ingress-gebruiker. Buiten HA (geen ingress-user) en
    zonder rollenconfiguratie geldt `beheer` (het oude gedrag). Een
    ongeldige rolwaarde in de config valt terug op `alleen_lezen`
    (fail-closed) — al voorkomt de schrijfvalidatie dat die er ooit komt."""
    if not gebruiker:
        return 'beheer'
    conf = _read_json('gebruikers_rollen')
    if not isinstance(conf, dict):
        return 'beheer'
    rollen = conf.get('gebruikers')
    rol = rollen.get(gebruiker) if isinstance(rollen, dict) else None
    if rol is None:
        rol = conf.get('standaard_rol') or 'beheer'
    return rol if rol in ROLLEN else 'alleen_lezen'


def _rol_mag_key(rol: str, key: str) -> bool:
    """Mag deze rol de gegeven data-key schrijven?"""
    if rol == 'beheer':
        return True
    if rol == 'alleen_lezen':
        return False
    if key in _BEHEER_KEYS:
        return False
    if key in _FINANCIELE_KEYS:
        return rol == 'boekhouding'
    return True  # gedeelde keys: boekhouding én productie


def _rollen_config_geldig(conf) -> bool:
    """Valideer de vorm van gebruikers_rollen strikt: een typfout in een
    rolnaam mag nooit stilletjes rechten geven of afpakken."""
    if not isinstance(conf, dict):
        return False
    if conf.get('standaard_rol') is not None and conf['standaard_rol'] not in ROLLEN:
        return False
    gebruikers = conf.get('gebruikers') or {}
    if not isinstance(gebruikers, dict):
        return False
    return all(isinstance(naam, str) and naam and rol in ROLLEN
               for naam, rol in gebruikers.items())


def _rollen_lockout(gebruiker: str, conf) -> bool:
    """True wanneer deze nieuwe rollenconfig de schrijvende gebruiker zelf
    uit `beheer` zou zetten — dat zou het rollenbeheer op slot gooien.
    Buiten HA (geen ingress-user) is er geen lockout-risico."""
    if not gebruiker or not isinstance(conf, dict):
        return False
    rollen = conf.get('gebruikers') if isinstance(conf.get('gebruikers'), dict) else {}
    rol = rollen.get(gebruiker) or conf.get('standaard_rol') or 'beheer'
    return rol != 'beheer'


# ── Factuurnummering (ERP-plan 0.2) ──────────────────────────────────────
# Doorlopende, unieke nummers per reeks/jaar worden server-side uitgegeven
# onder _data_lock — de client mag nooit zelf nummeren (race tussen twee
# kassa's/tabs gaf voorheen dubbele nummers; verwijderen gaf hergebruik).

_NUMMER_REEKSEN = {
    'factuur':    'F{jaar}-',
    'creditnota': 'CN-{jaar}-',
}


def _max_bestaand_nummer(prefix: str) -> int:
    """Hoogste al uitgegeven nummer met dit prefix in verkoop_facturen.json.
    Vangnet tegen dubbele nummers na een backup-restore of handmatige edit
    waarbij de tellerstand achterloopt op de werkelijk bestaande facturen."""
    facturen = _read_json('verkoop_facturen', [])
    hoogste = 0
    if isinstance(facturen, list):
        for f in facturen:
            nummer = f.get('factuurnummer') if isinstance(f, dict) else None
            if isinstance(nummer, str) and nummer.startswith(prefix):
                try:
                    hoogste = max(hoogste, int(nummer[len(prefix):]))
                except ValueError:
                    pass
    return hoogste


def _legacy_counter(reeks: str, jaar: int) -> int:
    """Tellerstand uit het oude client-side factuur_counter.json.
    Facturen: {jaar, nr}; creditnota's (statiegeld) sloegen per jaar op
    onder de jaar-key zelf."""
    legacy = _read_json('factuur_counter', {})
    if not isinstance(legacy, dict):
        return 0
    try:
        if reeks == 'factuur':
            return int(legacy.get('nr') or 0) if legacy.get('jaar') == jaar else 0
        return int(legacy.get(str(jaar)) or 0)
    except (TypeError, ValueError):
        return 0


def _volgend_nummer(reeks: str, jaar: int) -> dict:
    """Geef atomair het volgende nummer in de reeks uit (aanroepen ZONDER
    _data_lock; deze functie pakt de lock zelf)."""
    prefix = _NUMMER_REEKSEN[reeks].format(jaar=jaar)
    with _data_lock:
        reeksen = _read_json('nummer_reeksen', {})
        if not isinstance(reeksen, dict):
            reeksen = {}
        entry = reeksen.get(reeks) or {}
        try:
            opgeslagen = int(entry.get('nr') or 0) if entry.get('jaar') == jaar else 0
        except (TypeError, ValueError):
            opgeslagen = 0
        basis = max(opgeslagen, _legacy_counter(reeks, jaar), _max_bestaand_nummer(prefix))
        nr = basis + 1
        reeksen[reeks] = {'jaar': jaar, 'nr': nr}
        _write_json('nummer_reeksen', reeksen)
    return {'jaar': jaar, 'nr': nr, 'nummer': f'{prefix}{nr:04d}'}


def _data_version(key: str) -> str:
    """Versie-hash van een data-key voor optimistic locking (ERP-plan 0.1).
    De client krijgt deze hash bij GET mee (X-Data-Version) en stuurt hem bij
    POST terug; komt hij niet overeen met de opgeslagen versie, dan heeft
    een andere client/thread tussentijds geschreven en volgt een 409.
    '0' = key bestaat (nog) niet."""
    conn = _db()
    rij = conn.execute('SELECT versie FROM versies WHERE key=?', (key,)).fetchone()
    return rij[0] if rij else '0'


def _atomic_write_bytes(filepath: Path, data: bytes) -> None:
    """Schrijf atomair: eerst naar een tempbestand in dezelfde map, dan
    os.replace. Een crash mid-write kan zo nooit een half/corrupt bestand
    achterlaten (gebruikt voor de JSON-export in de backups)."""
    tmp = filepath.with_name(f'.{filepath.name}.tmp')
    tmp.write_bytes(data)
    os.replace(tmp, filepath)


def _write_json(key: str, data) -> str:
    """Schrijf een data-key naar de SQLite-opslag (eigen transactie).
    Retourneert de nieuwe versie-hash."""
    conn = _db()
    with conn:
        versie, _ = _schrijf_key(conn, key, data)
    return versie


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


def _ha_notify(service: str, title: str, message: str) -> bool:
    """Stuur een notificatie via een HA notify-service (notify.<service>).
    `service` is het deel ná `notify.` (bv. `mobile_app_iphone`). Return True
    bij success. De service-naam wordt streng gevalideerd zodat er geen ander
    domein/pad geïnjecteerd kan worden."""
    token = os.environ.get('SUPERVISOR_TOKEN', '')
    if not token:
        return False
    if not isinstance(service, str) or not re.match(r'^[a-z0-9_]+$', service):
        return False
    try:
        payload = json.dumps({'title': title, 'message': message}).encode('utf-8')
        req = urllib.request.Request(
            f'{HA_SUPERVISOR_BASE}/services/notify/{service}',
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
            _log('auto-metingen', f'error: {exc}', level=logging.ERROR)
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
            _log('cold-crash', f'error: {exc}', level=logging.ERROR)
        time.sleep(interval)


def _carbonatie_co2_loop(interval: float = 60.0) -> None:
    """Achtergrondloop: volg elke minuut het gewicht van de CO₂-cilinder voor
    actieve carbonisatie-sessies met bewaking, en stuur een melding zodra het
    berekende CO₂-verbruik bereikt is. Draait ook als de browser dicht is."""
    time.sleep(25)  # kort wachten zodat de server volledig opgestart is
    while True:
        try:
            _carbonatie_co2_tick()
        except Exception as exc:
            _log('carb-co2', f'error: {exc}', level=logging.ERROR)
        time.sleep(interval)


def _carbonatie_co2_tick() -> None:
    """Lees de CO₂-weegsensor en werk elke actieve sessie met `co2_monitoring`
    bij. Berekent verbruik = startgewicht − huidig gewicht (in gram). Wanneer
    het verbruik `doel_co2_gram_verbruik` haalt, wordt de sessie gemarkeerd en
    eenmalig een HA-melding gestuurd (indien ingeschakeld)."""
    with _data_lock:
        ha_inst = _read_json('ha_instellingen', {}) or {}
    if not ha_inst.get('co2_enabled') or not ha_inst.get('co2_entity'):
        return
    entity = ha_inst['co2_entity']
    unit = ha_inst.get('co2_unit') or 'kg'

    with _data_lock:
        sessies = _read_json('carbonatie_sessies', []) or []
    actief = [s for s in sessies
              if s.get('status') == 'actief' and s.get('co2_monitoring')]
    if not actief:
        return

    raw = _ha_fetch_state(entity)
    if raw is None:
        _log('carb-co2', f'kon sensor {entity} niet lezen — skip')
        return
    huidig_gram = raw * 1000.0 if unit == 'kg' else raw
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()

    with _data_lock:
        notif = _read_json('notificatie_instellingen', {}) or {}
        batches = _read_json('batches', []) or []

    updates: dict[int, dict] = {}
    notify_jobs: list[tuple[str, str, str]] = []

    for s in actief:
        patch: dict = {
            'huidig_cilinder_gram': round(huidig_gram, 1),
            'laatste_meting_op': now_iso,
        }
        # Schrijf alleen terug bij een betekenisvolle verandering, anders blijft
        # het databestand elke minuut churnen (en her-rendert de UI onnodig).
        prev = s.get('huidig_cilinder_gram')
        changed = prev is None or abs(huidig_gram - float(prev)) >= 1.0

        start = s.get('start_cilinder_gram')
        # Geen startgewicht (sensor lag bij start plat): leg de eerste meting
        # vast als nulpunt en wacht op de volgende ronde.
        if start is None:
            patch['start_cilinder_gram'] = round(huidig_gram, 1)
            patch['verbruikt_co2_gram_live'] = 0.0
            updates[s['id']] = patch
            continue

        # Fles zwaarder dan bij start (> 50 g): tijdens carboniseren onmogelijk —
        # duidt op een verwisselde/bijgevulde fles of een eenheid-mismatch bij
        # start (bv. start in gram, sensor nu in kg). Herijk het nulpunt naar de
        # huidige meting zodat de bewaking zichzelf herstelt zonder herstart.
        if huidig_gram > float(start) + 50:
            patch['start_cilinder_gram'] = round(huidig_gram, 1)
            patch['verbruikt_co2_gram_live'] = 0.0
            updates[s['id']] = patch
            continue

        verbruikt = float(start) - huidig_gram
        if verbruikt < 0:
            verbruikt = 0.0  # kleine meetruis
        patch['verbruikt_co2_gram_live'] = round(verbruikt, 1)

        doel = float(s.get('doel_co2_gram_verbruik') or 0)
        doel_nu_bereikt = doel > 0 and verbruikt >= doel and not s.get('genotificeerd')
        if doel_nu_bereikt:
            patch['doel_bereikt_op'] = now_iso
            patch['genotificeerd'] = True
            if notif.get('enabled') and notif.get('notify_service'):
                batch = next((b for b in batches if b.get('id') == s.get('batch_id')), {}) or {}
                bnaam = batch.get('naam') or batch.get('biernaam') or f"batch {s.get('batch_id')}"
                titel = 'BrewAdmin — carbonisatie gereed'
                bericht = (f"{bnaam}: CO₂-doel bereikt — {round(verbruikt)} g toegevoegd "
                           f"(doel {round(doel)} g). Sluit de carbonisatie af.")
                notify_jobs.append((notif['notify_service'], titel, bericht))

        # Sla over wanneer er niets noemenswaardigs veranderde (sensor stabiel,
        # doel niet net bereikt) — voorkomt schrijf-churn.
        if changed or doel_nu_bereikt:
            updates[s['id']] = patch

    if updates:
        # Her-lees onder lock en merge alleen de bewakingsvelden terug, zodat we
        # gelijktijdige UI-schrijfacties (start/voltooien) niet overschrijven.
        with _data_lock:
            current = _read_json('carbonatie_sessies', []) or []
            for c in current:
                p = updates.get(c.get('id'))
                if p:
                    c.update(p)
            _write_json('carbonatie_sessies', current)

    for service, titel, bericht in notify_jobs:
        ok = _ha_notify(service, titel, bericht)
        _log('carb-co2', f"notify {service}: {'ok' if ok else 'mislukt'}", level=logging.ERROR)


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

    _log('auto-metingen', f'{len(new_entries)} meting(en) opgeslagen')


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
        _log('cold-crash', f"{len(active)} actieve batch(es), maar climates_enabled=false in ha_instellingen — skip")
        return
    climates = ha_inst.get('climates', []) or []
    if not climates:
        _log('cold-crash', f"{len(active)} actieve batch(es), maar geen climates geconfigureerd — skip")
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
            _log('cold-crash', f"batch {batch_id}: ongeldig cold_crash_target — skip")
            continue
        try:
            batch_ramp = float(batch.get('cold_crash_ramp') or 1)
        except (TypeError, ValueError):
            batch_ramp = 1.0
        if batch_ramp <= 0:
            _log('cold-crash', f"batch {batch_id}: ramp<=0 — skip")
            continue

        climate = next((c for c in climates if c.get('tank') == batch.get('tank') and c.get('entity')), None)
        if not climate:
            _log('cold-crash', f"batch {batch_id}: geen climate gekoppeld aan tank {batch.get('tank')!r} — skip")
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
            _log('cold-crash', f"batch {batch_id}: ongeldig timestamp {last_iso!r} — skip")
            continue
        elapsed_h = (now - last_dt).total_seconds() / 3600.0
        if elapsed_h < 1.0:
            # Geen ruis in de logs: alleen één keer per 10 minuten melden dat
            # we wachten. (int(min) % 10 == 0)
            mins = int((now - last_dt).total_seconds() / 60)
            if mins > 0 and mins % 10 == 0:
                _log('cold-crash', f"batch {batch_id}: wacht op volgend uur (elapsed {mins} min)")
            continue

        current_sp = _ha_fetch_climate_setpoint(entity_id)
        if current_sp is None:
            _log('cold-crash', f"batch {batch_id}: kon setpoint van {entity_id} niet lezen — skip")
            continue
        if current_sp <= target + 1e-6:
            _log('cold-crash', f"batch {batch_id}: setpoint {current_sp}°C <= target {target}°C — klaar")
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
            _log('cold-crash', f"batch {batch_id}: set_temperature({entity_id}, {new_sp}) faalde — skip", level=logging.ERROR)
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
        _log('cold-crash', f"batch {u['id']}: setpoint → {u['new_sp']}°C ({u['steps']} stap(pen))")


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
        # rglob: sinds de upload-map wordt meegeback-upt bevat de snapshot
        # ook een submap met bijlagen — die moet mee in de download-ZIP.
        for f in sorted(backup_path.rglob('*')):
            if f.is_file():
                zf.write(f, str(f.relative_to(backup_path)))
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
            self.send_header('Access-Control-Expose-Headers', 'X-Data-Version, Retry-After')
            self.send_header('Vary', 'Origin')

    def _is_direct(self) -> bool:
        """True wanneer dit request via de directe-toegangspoort binnenkwam
        (HA-login met sessiecookie i.p.v. ingress)."""
        return bool(getattr(self.server, 'brewadmin_direct', False))

    def _sessie_token(self) -> str:
        """Sessietoken uit het Cookie-header, of ''."""
        try:
            jar = http.cookies.SimpleCookie(self.headers.get('Cookie', ''))
            morsel = jar.get(SESSIE_COOKIE)
            return morsel.value if morsel else ''
        except http.cookies.CookieError:
            return ''

    def _ingress_user(self) -> str:
        """Gebruikersnaam van dit request. Via ingress: de door de
        HA-ingress-proxy meegegeven headers. Via de directe poort: de
        sessiegebruiker — de X-Remote-User-headers zijn daar spoofbaar en
        worden volledig genegeerd. Leeg buiten HA of zonder sessie."""
        if self._is_direct():
            return _sessie_gebruiker(self._sessie_token()) or ''
        return (self.headers.get('X-Remote-User-Name')
                or self.headers.get('X-Remote-User-Id')
                or '')

    def _rol(self) -> str:
        """Rol van de huidige gebruiker (ERP-plan 4.2)."""
        return _gebruiker_rol(self._ingress_user())

    def _rol_geweigerd(self, rol: str, key: str = '') -> None:
        """403 + audit-regel voor een door de rol geweigerde actie."""
        _audit_write('rol_geweigerd', key or self.path.split('?')[0][:120],
                     ip=self.client_address[0], rol=rol,
                     gebruiker=self._ingress_user())
        antwoord = {'error': 'forbidden', 'reden': 'rol', 'rol': rol}
        if key:
            antwoord['key'] = key
        self._json(403, antwoord)

    def _rate_check(self) -> bool:
        ip = self.client_address[0]
        # De directe poort accepteert per definitie clients buiten de
        # ingress-gateway — daar beschermt de sessielogin (_direct_auth);
        # de algemene rate-limit blijft ook daar gelden.
        if not self._is_direct() and not _client_allowed(ip):
            self._json(403, {'error': 'forbidden'})
            return False
        if not _check_rate(ip):
            self._json(429, {'error': 'too many requests'}, extra_headers=[('Retry-After', str(_retry_after(ip)))])
            return False
        return True

    def _direct_auth(self, path: str) -> bool:
        """Poortwachter voor de directe-toegangspoort. True = request mag
        door naar de normale routing; False = er is al geantwoord (login-
        pagina, login-/logout-afhandeling of 401)."""
        if LOGIN_PATH in path:
            if self.command == 'POST':
                self._handle_login()
            else:
                self._json(405, {'error': 'method not allowed'})
            return False
        if _sessie_gebruiker(self._sessie_token()):
            if LOGOUT_PATH in path:
                self._handle_logout()
                return False
            return True
        # Geen (geldige) sessie: API-calls krijgen 401, elke andere GET de
        # loginpagina; mutaties zijn hoe dan ook geblokkeerd.
        if '/api/' in path or self.command != 'GET':
            self._json(401, {'error': 'login required'})
            return False
        body = _login_pagina()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', len(body))
        self._add_security_headers(html=True)
        self.end_headers()
        self.wfile.write(body)
        return False

    def _handle_login(self):
        """POST /api/login (alleen directe poort) — valideer HA-credentials
        via de Supervisor en geef een sessiecookie uit."""
        ip = self.client_address[0]
        raw = self._read_body(max_len=4096)
        if raw is None:
            return
        try:
            body = json.loads(raw)
            gebruiker = str(body.get('username', '')).strip()
            wachtwoord = str(body.get('password', ''))
        except (json.JSONDecodeError, AttributeError):
            self._json(400, {'error': 'invalid json'})
            return
        if not gebruiker or not wachtwoord:
            self._json(400, {'error': 'missing credentials'})
            return
        if not _login_rate_ok(ip):
            _audit_write('login_geblokkeerd', '-', ip=ip, gebruiker=gebruiker)
            self._json(429, {'error': 'too many attempts'},
                       extra_headers=[('Retry-After', str(_LOGIN_RATE_WINDOW))])
            return
        if not os.environ.get('SUPERVISOR_TOKEN'):
            self._json(503, {'error': 'HA auth not available'})
            return
        uitkomst = _ha_auth_check(gebruiker, wachtwoord)
        if uitkomst != 'ok':
            _audit_write('login_mislukt', '-', ip=ip, gebruiker=gebruiker,
                         reden=uitkomst)
            if uitkomst == 'ongeldig':
                # Alleen échte verkeerde credentials tellen mee voor de
                # brute-force-limiet; backend-fouten niet.
                _login_poging_registreer(ip)
                self._json(401, {'error': 'invalid credentials'})
            else:
                # Backend-probleem (auth_api niet actief / Supervisor
                # onbereikbaar) — duidelijk onderscheiden van een verkeerd
                # wachtwoord zodat de gebruiker weet wáár hij moet kijken.
                self._json(502, {'error': 'auth backend', 'detail': uitkomst})
            return
        token = _sessie_maak(gebruiker)
        _audit_write('login', '-', ip=ip, gebruiker=gebruiker,
                     rol=_gebruiker_rol(gebruiker))
        # Secure-vlag zodra de poort HTTPS draait: de browser stuurt de
        # sessiecookie dan nooit over onversleuteld verkeer mee.
        secure = '; Secure' if getattr(self.server, 'brewadmin_ssl', False) else ''
        cookie = (f'{SESSIE_COOKIE}={token}; Path=/; HttpOnly; '
                  f'SameSite=Strict; Max-Age={SESSIE_DUUR}{secure}')
        self._json(200, {'ok': True, 'gebruiker': gebruiker,
                         'rol': _gebruiker_rol(gebruiker)},
                   extra_headers=[('Set-Cookie', cookie)])

    def _handle_logout(self):
        """POST /api/logout (alleen directe poort) — beëindig de sessie."""
        token = self._sessie_token()
        gebruiker = _sessie_gebruiker(token) or ''
        _sessie_verwijder(token)
        _audit_write('logout', '-', ip=self.client_address[0], gebruiker=gebruiker)
        cookie = f'{SESSIE_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'
        self._json(200, {'ok': True}, extra_headers=[('Set-Cookie', cookie)])

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
        if not self._is_direct() and not _client_allowed(self.client_address[0]):
            self._json(403, {'error': 'forbidden'})
            return
        origin = self.headers.get('Origin', '')
        allowed = _trusted_origin(origin)
        self.send_response(204)
        if allowed:
            self.send_header('Access-Control-Allow-Origin', allowed)
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Data-Version')
            self.send_header('Vary', 'Origin')
        for name, value in _SEC_HEADERS:
            self.send_header(name, value)
        self.end_headers()

    def do_GET(self):
        if not self._rate_check():
            return
        path = self.path.split('?')[0]

        if self._is_direct() and not self._direct_auth(path):
            return

        if HEALTH_PATH in path:
            self._handle_health()
            return

        if WHOAMI_PATH in path:
            gebruiker = self._ingress_user()
            # `sessie: true` = ingelogd via de directe poort (HA-login met
            # sessiecookie) — de UI toont dan een uitlogknop.
            self._json(200, {'gebruiker': gebruiker,
                             'rol': _gebruiker_rol(gebruiker),
                             'sessie': self._is_direct()})
            return

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
            # Backup-ZIP's bevatten de complete administratie inclusief
            # (onmaskeerde) credentials — alleen beheer mag ze ophalen.
            rol = self._rol()
            if rol != 'beheer':
                self._rol_geweigerd(rol)
                return
            self._handle_backups_get()
            return

        if FILE_PREFIX in path:
            self._serve_upload()
            return

        if DOWNLOAD_BIJLAGEN_PREFIX in path:
            rol = self._rol()
            if rol not in ('beheer', 'boekhouding'):
                self._rol_geweigerd(rol)
                return
            self._serve_bijlagen_zip()
            return

        if HA_PROXY_PREFIX in path:
            self._ha_proxy(path)
            return

        key = extract_key(path)
        if key is not None:
            gelezen = _lees_key_bytes(key)
            if gelezen is not None:
                # Versie altijd die van de RUWE opgeslagen inhoud, ook wanneer
                # gemaskeerd wordt geserveerd — de POST-conflictcheck vergelijkt
                # met dezelfde ruwe inhoud.
                body, version = gelezen
                if key in _SECURE_FIELDS:
                    try:
                        masked = _mask_secrets(key, json.loads(body))
                        body = json.dumps(masked, ensure_ascii=False).encode('utf-8')
                    except (json.JSONDecodeError, UnicodeDecodeError):
                        pass
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(body))
                self.send_header('Cache-Control', 'no-store')
                self.send_header('X-Data-Version', version)
                self._add_security_headers()
                self.end_headers()
                self.wfile.write(body)
            else:
                self._json(404, None, extra_headers=[('X-Data-Version', '0')])
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

        if self._is_direct() and not self._direct_auth(path):
            return

        # Rollen (ERP-plan 4.2): alleen-lezen mag geen enkel mutatie-endpoint
        # aanraken; test-/backup-endpoints zijn beheer-only en nummeruitgifte
        # + factuurbijlagen horen bij boekhouding. Data-keys worden verderop
        # per key gecontroleerd (_rol_mag_key).
        rol = self._rol()
        if rol == 'alleen_lezen':
            self._rol_geweigerd(rol)
            return
        if rol != 'beheer' and any(p in path for p in (
                MAIL_TEST_PATH, BF_TEST_PATH, WC_TEST_PATH, BACKUPS_TRIGGER_PATH)):
            self._rol_geweigerd(rol)
            return
        if rol not in ('beheer', 'boekhouding') and any(p in path for p in (
                NEXTNR_PATH, UPLOAD_PREFIX, DELETE_UPLOAD_PREFIX)):
            self._rol_geweigerd(rol)
            return

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

        if NEXTNR_PATH in path:
            self._handle_nextnr()
            return

        if COMMIT_PATH in path:
            self._handle_commit()
            return

        if DELTA_PREFIX in path:
            self._handle_delta()
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
                parsed = json.loads(body)  # validate JSON
            except json.JSONDecodeError:
                self._json(400, {'error': 'invalid json'})
                return
            if not _payload_geldig(key, parsed):
                self._json(422, {'error': 'invalid payload', 'key': key,
                                 'expected': _KEY_TYPES.get(key)})
                return
            if not _rol_mag_key(rol, key):
                self._rol_geweigerd(rol, key)
                return
            if key == 'gebruikers_rollen':
                if not _rollen_config_geldig(parsed):
                    self._json(422, {'error': 'invalid payload', 'key': key,
                                     'expected': 'rollen'})
                    return
                if _rollen_lockout(self._ingress_user(), parsed):
                    # De beheerder mag zichzelf niet uit `beheer` zetten —
                    # daarna zou niemand het rollenbeheer meer kunnen wijzigen.
                    self._json(422, {'error': 'rollen-lockout', 'key': key})
                    return
            # Onder _data_lock zodat de achtergrondthreads (cold-crash,
            # auto-metingen) die read-modify-write doen op dezelfde keys
            # geen halve merge overschrijven.
            # Optimistic locking: stuurt de client een X-Data-Version mee die
            # niet overeenkomt met de opgeslagen versie, dan heeft een
            # andere client tussentijds geschreven → 409, niets overschrijven.
            # Zonder header (oude frontend) blijft het gedrag last-write-wins.
            expected = self.headers.get('X-Data-Version')
            with _data_lock:
                conn = _db()
                vorige = _data_version(key)
                if expected is not None and expected != vorige:
                    self._json(409, {'error': 'conflict', 'version': vorige})
                    return
                if not _append_only_ok(key, parsed):
                    self._json(422, {'error': 'append-only', 'key': key})
                    return
                if key in _SECURE_FIELDS:
                    # Sentinel-waarden terugvervangen door de opgeslagen
                    # geheimen (de client kent die bewust niet).
                    parsed = _unmask_secrets(key, parsed)
                try:
                    with conn:
                        nieuwe_versie, nbytes = _schrijf_key(conn, key, parsed)
                except sqlite3.Error:
                    self._json(500, {'error': 'write failed'})
                    return
                if key in _SECURE_FIELDS:
                    _chmod_db_bestanden()
            _audit_write('data_post', key, ip=self.client_address[0],
                         bytes=nbytes, versie_van=vorige,
                         versie_naar=nieuwe_versie, gebruiker=self._ingress_user())
            self._json(200, {'ok': True, 'version': nieuwe_versie})
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
            body = _unmask_secrets('brewfather_creds', json.loads(raw))
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
            body   = _unmask_secrets('woocommerce_creds', json.loads(raw))
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

        # Lijst van beschikbare notify-services (voor de meldingsinstellingen).
        if tail == '_notify_list':
            if self.command != 'GET':
                self._json(405, {'error': 'method not allowed'})
                return
            self._ha_notify_list()
            return

        # Verstuur een notify-melding (test-knop / app-trigger).
        if tail == '_notify':
            if self.command != 'POST':
                self._json(405, {'error': 'method not allowed'})
                return
            self._ha_notify_endpoint()
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

    def _ha_notify_list(self):
        """Haal de beschikbare notify-services op (domein `notify`) zodat de
        meldingsinstellingen een keuzelijst kunnen tonen. Geeft alleen de
        service-namen terug (zonder `notify.`-prefix)."""
        token = os.environ.get('SUPERVISOR_TOKEN', '')
        if not token:
            self._json(503, {'error': 'SUPERVISOR_TOKEN not available — app must run as HA addon'})
            return
        try:
            req = urllib.request.Request(
                f'{HA_SUPERVISOR_BASE}/services',
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
        services: list[str] = []
        for dom in raw if isinstance(raw, list) else []:
            if dom.get('domain') == 'notify':
                services = sorted((dom.get('services') or {}).keys())
                break
        self._json(200, {'services': services})

    def _ha_notify_endpoint(self):
        """Verstuur een notify-melding op verzoek van de frontend. Body = JSON
        met `service` (zonder prefix), `title` en `message`."""
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
        service = payload.get('service', '')
        if not isinstance(service, str) or not re.match(r'^[a-z0-9_]+$', service):
            self._json(400, {'error': 'invalid or missing service'})
            return
        title = str(payload.get('title', ''))[:200]
        message = str(payload.get('message', ''))[:1000]
        if _ha_notify(service, title, message):
            self._json(200, {'ok': True})
        else:
            self._json(502, {'error': 'notify failed'})

    def _handle_health(self):
        """GET /api/health — status van server, achtergrondthreads en backup
        (ERP-plan 3.6). `threads` is None wanneer de server niet via __main__
        draait (dan zijn er geen threads gestart, bv. onder pytest)."""
        threads = {naam: t.is_alive() for naam, t in _threads.items()} or None
        data_ok = DATA_DIR.is_dir()
        ok = data_ok and (threads is None or all(threads.values()))
        self._json(200, {
            'ok': ok,
            'threads': threads,
            'laatste_backup': _laatste_backup_datum(),
            'data_dir': data_ok,
            'uptime_s': int(time.monotonic() - _start_tijd),
        })

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
            body = _unmask_secrets('smtp_creds', json.loads(raw))
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

    def _handle_nextnr(self):
        """POST /api/nextnr — geef atomair het volgende factuur-/creditnota-
        nummer uit. Body: {"reeks": "factuur"|"creditnota", "jaar": 2026}.
        Antwoord: {"jaar", "nr", "nummer"} (bv. "F2026-0012")."""
        body = self._read_body(max_len=1024)
        if body is None:
            return
        try:
            req = json.loads(body)
        except json.JSONDecodeError:
            self._json(400, {'error': 'invalid json'})
            return
        reeks = req.get('reeks') if isinstance(req, dict) else None
        jaar = req.get('jaar') if isinstance(req, dict) else None
        if reeks not in _NUMMER_REEKSEN or not isinstance(jaar, int) or not 2000 <= jaar <= 2200:
            self._json(400, {'error': 'invalid reeks/jaar'})
            return
        try:
            resultaat = _volgend_nummer(reeks, jaar)
            _audit_write('nextnr', 'nummer_reeksen', ip=self.client_address[0],
                         reeks=reeks, nummer=resultaat['nummer'],
                         gebruiker=self._ingress_user())
            self._json(200, resultaat)
        except OSError:
            self._json(500, {'error': 'could not persist counter'})

    def _handle_commit(self):
        """POST /api/commit — schrijf meerdere data-keys atomair (ERP-plan 1.1).
        Body: {"data": {key: waarde, ...}, "versions": {key: versie, ...}}.
        Alle meegegeven versies moeten kloppen (optimistic locking), anders
        409 met de conflicterende keys en niets geschreven. Het schrijven is
        één SQLite-transactie (ERP-plan 4.1): een fout halverwege rolt
        volledig terug en laat nooit een half-toegepaste commit achter."""
        body = self._read_body()
        if body is None:
            return
        try:
            req = json.loads(body)
        except json.JSONDecodeError:
            self._json(400, {'error': 'invalid json'})
            return
        data = req.get('data') if isinstance(req, dict) else None
        versions = req.get('versions') if isinstance(req, dict) else None
        if not isinstance(data, dict) or not data:
            self._json(400, {'error': 'invalid commit: data ontbreekt'})
            return
        if not isinstance(versions, dict):
            versions = {}
        if len(data) > COMMIT_MAX_KEYS:
            self._json(400, {'error': f'too many keys (max {COMMIT_MAX_KEYS})'})
            return
        rol = self._rol()
        for key, value in data.items():
            if not _valid_key(key):
                self._json(400, {'error': f'invalid key: {key}'})
                return
            if not _payload_geldig(key, value):
                self._json(422, {'error': 'invalid payload', 'key': key,
                                 'expected': _KEY_TYPES.get(key)})
                return
            if not _rol_mag_key(rol, key):
                self._rol_geweigerd(rol, key)
                return
            if key == 'gebruikers_rollen':
                if not _rollen_config_geldig(value):
                    self._json(422, {'error': 'invalid payload', 'key': key,
                                     'expected': 'rollen'})
                    return
                if _rollen_lockout(self._ingress_user(), value):
                    self._json(422, {'error': 'rollen-lockout', 'key': key})
                    return
        with _data_lock:
            conn = _db()
            conflicts = {}
            vorige_versies = {}
            for key in data:
                current = _data_version(key)
                vorige_versies[key] = current
                expected = versions.get(key)
                if expected is not None and expected != current:
                    conflicts[key] = current
            if conflicts:
                self._json(409, {'error': 'conflict', 'conflicts': conflicts})
                return
            for key, value in data.items():
                if not _append_only_ok(key, value):
                    self._json(422, {'error': 'append-only', 'key': key})
                    return
            # Eén databasetransactie: alles-of-niets. Een sqlite-fout rolt
            # alle keys terug (verving de twee-fasen tempfile-aanpak).
            resultaten: dict[str, tuple[str, int]] = {}
            try:
                with conn:
                    for key, value in data.items():
                        if key in _SECURE_FIELDS:
                            value = _unmask_secrets(key, value)
                        resultaten[key] = _schrijf_key(conn, key, value)
            except sqlite3.Error:
                self._json(500, {'error': 'commit failed'})
                return
            if any(k in _SECURE_FIELDS for k in data):
                _chmod_db_bestanden()
            new_versions = {key: versie for key, (versie, _n) in resultaten.items()}
        commit_id = hashlib.sha256(repr(sorted(new_versions.items())).encode()).hexdigest()[:12]
        for key, (versie, nbytes) in resultaten.items():
            _audit_write('commit', key, ip=self.client_address[0],
                         commit=commit_id, bytes=nbytes,
                         versie_van=vorige_versies.get(key),
                         versie_naar=versie,
                         gebruiker=self._ingress_user())
        self._json(200, {'ok': True, 'versions': new_versions})

    def _handle_delta(self):
        """POST /api/delta/<key> — delta-sync per record (ERP-plan 4.3).
        Body: {"upsert": [records], "delete": [ids]}; X-Data-Version verplicht.
        Werkt alleen op array-keys waarvan elk record een id heeft (de
        rij-per-record-opslag uit 4.1). Alles wat delta niet aankan
        beantwoordt de server met 400/404 — de client valt dan stil terug op
        de volledige POST, die het laatste woord houdt. 409 blijft een echt
        versieconflict (zelfde afhandeling als bij een volledige POST)."""
        path = self.path.split('?')[0]
        idx = path.find(DELTA_PREFIX)
        key = path[idx + len(DELTA_PREFIX):].strip('/')
        if not _valid_key(key):
            self._json(400, {'error': 'invalid key'})
            return
        rol = self._rol()
        if not _rol_mag_key(rol, key):
            self._rol_geweigerd(rol, key)
            return
        # Rollenbeheer heeft extra validatie (lockout) — alleen via volledige POST.
        if key == 'gebruikers_rollen':
            self._json(400, {'error': 'delta not supported for this key'})
            return
        body = self._read_body()
        if body is None:
            return
        try:
            req = json.loads(body)
        except json.JSONDecodeError:
            self._json(400, {'error': 'invalid json'})
            return
        upserts = req.get('upsert') if isinstance(req, dict) else None
        deletes = req.get('delete') if isinstance(req, dict) else None
        if not isinstance(upserts, list) or not isinstance(deletes, list):
            self._json(400, {'error': 'invalid delta: upsert/delete ontbreekt'})
            return
        for rec in upserts:
            if not isinstance(rec, dict) or rec.get('id') is None:
                self._json(400, {'error': 'invalid delta: record zonder id'})
                return
        if any(isinstance(d, (dict, list)) or d is None for d in deletes):
            self._json(400, {'error': 'invalid delta: ongeldige delete-id'})
            return
        expected = self.headers.get('X-Data-Version')
        if expected is None:
            # Zonder basisversie zijn delta-semantiek en conflictdetectie
            # niet te garanderen — volledige POST gebruiken.
            self._json(400, {'error': 'X-Data-Version required for delta'})
            return
        with _data_lock:
            conn = _db()
            rij = conn.execute('SELECT versie, soort FROM versies WHERE key=?',
                               (key,)).fetchone()
            if rij is None or rij[1] != 'array':
                # Onbekende key of geen array: client valt terug op volledige
                # POST (zelfde fallback als een oude server zonder dit endpoint).
                self._json(404, {'error': 'not found'})
                return
            if expected != rij[0]:
                self._json(409, {'error': 'conflict', 'version': rij[0]})
                return
            # Delta vereist unieke, aanwezige record-id's in de opslag.
            tellers = conn.execute(
                'SELECT COUNT(*), COUNT(record_id), COUNT(DISTINCT record_id) '
                'FROM records WHERE key=?', (key,)).fetchone()
            if tellers[0] != tellers[1] or tellers[0] != tellers[2]:
                self._json(400, {'error': 'delta not supported for this key'})
                return
            bestaand = {r[0] for r in conn.execute(
                'SELECT record_id FROM records WHERE key=?', (key,))}
            if key in _APPEND_ONLY:
                # Append-only: alleen nieuwe records; wijzigen/verwijderen
                # loopt via de volledige POST die het canonieke 422 geeft.
                if deletes or any(str(rec['id']) in bestaand for rec in upserts):
                    self._json(400, {'error': 'append-only'})
                    return
            try:
                with conn:
                    for d in deletes:
                        conn.execute('DELETE FROM records WHERE key=? AND record_id=?',
                                     (key, str(d)))
                    volgende_seq = conn.execute(
                        'SELECT COALESCE(MAX(seq), -1) + 1 FROM records WHERE key=?',
                        (key,)).fetchone()[0]
                    for rec in upserts:
                        rid = str(rec['id'])
                        data_json = _json_compact(rec)
                        if rid in bestaand and rid not in {str(d) for d in deletes}:
                            conn.execute(
                                'UPDATE records SET data=? WHERE key=? AND record_id=?',
                                (data_json, key, rid))
                        else:
                            conn.execute(
                                'INSERT INTO records(key, seq, record_id, data) '
                                'VALUES(?,?,?,?)', (key, volgende_seq, rid, data_json))
                            volgende_seq += 1
                    delen = [r[0] for r in conn.execute(
                        'SELECT data FROM records WHERE key=? ORDER BY seq', (key,))]
                    payload = ('[' + ','.join(delen) + ']').encode('utf-8')
                    nieuwe_versie = hashlib.sha256(payload).hexdigest()[:16]
                    conn.execute('UPDATE versies SET versie=? WHERE key=?',
                                 (nieuwe_versie, key))
            except sqlite3.Error:
                self._json(500, {'error': 'delta failed'})
                return
        _audit_write('delta', key, ip=self.client_address[0],
                     upserts=len(upserts), deletes=len(deletes),
                     versie_van=expected, versie_naar=nieuwe_versie,
                     gebruiker=self._ingress_user())
        self._json(200, {'ok': True, 'version': nieuwe_versie, 'records': len(delen)})

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

        facturen = _read_json('inkoop_facturen', [])
        if not isinstance(facturen, list):
            facturen = []

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
            _log('http', f'{self.address_string()} {format % args}', level=logging.WARNING)


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8099))
    _log('server', f'Brouwerij Admin gestart op poort {port}', data_dir=str(DATA_DIR))

    # SQLite-opslag initialiseren (schema + eenmalige JSON-migratie) vóór de
    # eerste request en vóór de achtergrondthreads starten (ERP-plan 4.1).
    _db()
    _log('server', f'SQLite-opslag gereed ({DB_NAAM}, WAL)')

    _harden_secure_files()

    # Threadreferenties in _threads zodat /api/health hun status kan melden.
    _threads['backup'] = threading.Thread(target=_backup_loop, daemon=True)
    _threads['backup'].start()
    _log('server', f'Backup-thread gestart (dagelijks naar {BACKUP_DIR})')

    # Start background auto-measurement thread (every 10 minutes)
    _threads['auto_metingen'] = threading.Thread(target=_auto_metingen_loop, daemon=True)
    _threads['auto_metingen'].start()
    _log('server', 'Auto-metingen-thread gestart (elke 10 minuten)')

    # Start background cold-crash thread (every minute — ramp-steps are hourly)
    _threads['cold_crash'] = threading.Thread(target=_cold_crash_loop, daemon=True)
    _threads['cold_crash'].start()
    _log('server', 'Cold-crash-thread gestart (elke minuut)')

    # Start background CO₂-carbonisatie-bewakingsthread (every minute)
    _threads['carbonatie_co2'] = threading.Thread(target=_carbonatie_co2_loop, daemon=True)
    _threads['carbonatie_co2'].start()
    _log('server', 'Carbonisatie-CO₂-bewakingsthread gestart (elke minuut)')

    # Directe-toegangspoort met HA-login (sessiecookie). Alleen bereikbaar
    # van buitenaf wanneer de gebruiker de poort bewust publiceert in de
    # addon-netwerkconfig (config.yaml ports: null = uit). Met de
    # addon-optie `ssl: true` draait de poort HTTPS met certificaten uit
    # /ssl (eigen domein via de Let's Encrypt-/DuckDNS-addon); faalt het
    # certificaat, dan start de poort NIET (nooit stil onversleuteld).
    opties = _addon_opties()
    direct_ctx = None
    direct_ok = True
    if opties.get('ssl'):
        certfile = str(opties.get('certfile') or 'fullchain.pem')
        keyfile = str(opties.get('keyfile') or 'privkey.pem')
        direct_ctx = _ssl_context(certfile, keyfile)
        if direct_ctx is None:
            direct_ok = False
            _log('server', f'Directe-toegangspoort NIET gestart: ssl aan maar '
                           f'certificaat onbruikbaar (zie ssl-log)', level=logging.ERROR)
    if direct_ok:
        direct_server = http.server.ThreadingHTTPServer(('0.0.0.0', DIRECT_PORT), BrouwerijHandler)
        direct_server.brewadmin_direct = True
        if direct_ctx is not None:
            direct_server.socket = direct_ctx.wrap_socket(direct_server.socket, server_side=True)
            direct_server.brewadmin_ssl = True
            _threads['ssl_reload'] = threading.Thread(
                target=_ssl_reload_loop,
                args=(direct_ctx, str(opties.get('certfile') or 'fullchain.pem'),
                      str(opties.get('keyfile') or 'privkey.pem')),
                daemon=True)
            _threads['ssl_reload'].start()
        _threads['direct_poort'] = threading.Thread(target=direct_server.serve_forever, daemon=True)
        _threads['direct_poort'].start()
        _log('server', f'Directe-toegangspoort gestart op {DIRECT_PORT} '
                       f'({"HTTPS" if direct_ctx else "HTTP"}, HA-login vereist)')

    # ThreadingHTTPServer: één trage upstream-call (Claude 90s, Brewfather 30s,
    # SMTP 30s) mag niet alle andere requests — UI laden, data-saves — blokkeren.
    server = http.server.ThreadingHTTPServer(('0.0.0.0', port), BrouwerijHandler)
    server.serve_forever()
