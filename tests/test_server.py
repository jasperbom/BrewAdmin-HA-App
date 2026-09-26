# pytest-suite voor server.py (ERP-plan 3.2; SQLite-opslag sinds 4.1).
#
# Twee lagen:
#  1. unit-tests op de pure helpers (key-/upload-validatie, schemavalidatie,
#     append-only-guard, secrets-maskering, atomic write);
#  2. integratietests tegen een échte ThreadingHTTPServer op een efemere
#     poort met een tijdelijke DATA_DIR — de 409/422-paden, /api/commit,
#     /api/nextnr (atomair onder parallelle clients), rate-limiting, upload
#     en de SQLite-laag (WAL, JSON-migratie, backup-export).
#
# Draaien: python3 -m pytest

import base64
import datetime
import gzip
import hashlib
import http.client
import http.server
import io
import json
import os
import re
import socket
import ssl
import threading
import time
import urllib.error
import urllib.request
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import server as srv


# ── Testserver-fixture ───────────────────────────────────────────────────────

@pytest.fixture(scope='session')
def app(tmp_path_factory):
    """Start de echte handler op een efemere poort met een verse DATA_DIR."""
    root = tmp_path_factory.mktemp('data')
    srv.DATA_DIR = root
    srv.UPLOAD_DIR = root / 'inkoop_facturen'
    srv.BACKUP_DIR = root / 'backups'
    srv.AUDIT_DIR = root / 'server_audit'
    for d in (srv.UPLOAD_DIR, srv.BACKUP_DIR, srv.AUDIT_DIR):
        d.mkdir(parents=True, exist_ok=True)
    # Ruim boven wat de suite nodig heeft; de rate-limit-test zet hem
    # tijdelijk zelf laag.
    srv._RATE_MAX = 100_000
    httpd = srv.BrouwerijServer(('127.0.0.1', 0), srv.BrouwerijHandler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield f'http://127.0.0.1:{httpd.server_address[1]}'
    httpd.shutdown()


@pytest.fixture(scope='session')
def app_direct(app):
    """Tweede listener zoals de directe-toegangspoort (HA-login + sessie);
    deelt de DATA_DIR met de gewone testserver."""
    httpd = srv.BrouwerijServer(('127.0.0.1', 0), srv.BrouwerijHandler)
    httpd.brewadmin_direct = True
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield f'http://127.0.0.1:{httpd.server_address[1]}'
    httpd.shutdown()


def req(base, method, path, body=None, headers=None):
    """Kleine HTTP-helper: geeft (status, json-body, headers) terug."""
    data = None
    if body is not None:
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
    r = urllib.request.Request(base + path, data=data, method=method,
                               headers={'Content-Type': 'application/json', **(headers or {})})
    try:
        with urllib.request.urlopen(r) as resp:
            return resp.status, json.loads(resp.read() or b'null'), dict(resp.headers)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            parsed = json.loads(raw or b'null')
        except Exception:
            parsed = raw
        return e.code, parsed, dict(e.headers)


# ── 1. Pure helpers ──────────────────────────────────────────────────────────

class TestValidatie:
    def test_valid_key_weert_path_traversal(self):
        assert srv._valid_key('batches')
        assert srv._valid_key('journaal_2026')
        assert not srv._valid_key('')
        assert not srv._valid_key('../etc/passwd')
        assert not srv._valid_key('a-b')
        assert not srv._valid_key('a b')
        assert not srv._valid_key('a/b')

    def test_payload_geldig_dwingt_containertype_af(self):
        assert srv._payload_geldig('batches', [])
        assert not srv._payload_geldig('batches', {})
        assert srv._payload_geldig('btw_instellingen', {})
        assert not srv._payload_geldig('btw_instellingen', [])
        assert srv._payload_geldig('app_name', 'x')
        assert not srv._payload_geldig('app_name', 1)
        assert srv._payload_geldig('app_logo', None)
        assert srv._payload_geldig('journaal', [])
        # HACCP-registraties zijn arrays, de kritische grenzen een object
        assert srv._payload_geldig('haccp_vrijgaven', [])
        assert not srv._payload_geldig('haccp_vrijgaven', {})
        assert srv._payload_geldig('afvul_sessies', [])
        assert srv._payload_geldig('haccp_sluitcontroles', [])
        assert srv._payload_geldig('haccp_etiketcontroles', [])
        assert srv._payload_geldig('haccp_afwijkingen', [])
        assert srv._payload_geldig('haccp_instellingen', {})
        assert not srv._payload_geldig('haccp_instellingen', [])
        # Onbekende keys blijven vrij (voorwaartse compatibiliteit)
        assert srv._payload_geldig('onbekende_toekomstige_key', 123)

    def test_valid_upload_filename(self):
        assert srv._valid_upload_filename('factuur-2026_01.pdf')
        assert not srv._valid_upload_filename('.htaccess')
        assert not srv._valid_upload_filename('shell.exe')
        assert not srv._valid_upload_filename('geen_extensie')
        assert not srv._valid_upload_filename('a/../../x.pdf')
        assert not srv._valid_upload_filename('x' * 250 + '.pdf')


class TestAtomicWrite:
    def test_schrijft_en_vervangt_atomair(self, tmp_path):
        doel = tmp_path / 'x.json'
        srv._atomic_write_bytes(doel, b'{"a":1}')
        assert doel.read_bytes() == b'{"a":1}'
        srv._atomic_write_bytes(doel, b'{"a":2}')
        assert doel.read_bytes() == b'{"a":2}'
        # Geen tempbestanden achtergebleven
        assert [p.name for p in tmp_path.iterdir()] == ['x.json']


class TestAppendOnly:
    def test_append_only_guard(self, app):
        srv._write_json('journaal', [{'id': 1, 'netto_cent': 100}])
        try:
            # aanvullen mag
            assert srv._append_only_ok('journaal', [{'id': 1, 'netto_cent': 100}, {'id': 2}])
            # muteren en weglaten niet
            assert not srv._append_only_ok('journaal', [{'id': 1, 'netto_cent': 999}])
            assert not srv._append_only_ok('journaal', [{'id': 2}])
            assert not srv._append_only_ok('journaal', [])
            # niet-append-only keys blijven vrij
            assert srv._append_only_ok('batches', [])
        finally:
            # Testdata opruimen — direct in de database, buiten de API om
            # (de API weigert het leegmaken terecht met 422).
            conn = srv._db()
            with conn:
                conn.execute("DELETE FROM records WHERE key='journaal'")
                conn.execute("DELETE FROM versies WHERE key='journaal'")

    def test_ontbrekende_key_blokkeert_niet(self, app):
        assert srv._append_only_ok('journaal', [{'id': 1}])

    def test_ccp_registraties_zijn_append_only(self, app):
        """De drie kritische beheerspunten uit het HACCP-handboek zijn bewijs
        richting de NVWA: een opgeslagen registratie mag nooit overschreven
        worden (bijlage A.1). Een correctie is een nieuw record."""
        keys = ('haccp_vrijgaven', 'haccp_sluitcontroles',
                'haccp_etiketcontroles', 'haccp_afwijkingen',
                # Hoofdstuk 11: een traceeroefening die tegenviel mag niet
                # achteraf worden bijgesteld.
                'haccp_trace_oefeningen')
        for key in keys:
            assert key in srv._APPEND_ONLY, key
            srv._write_json(key, [{'id': 1, 'paraaf': {'gebruiker': 'jasper'}}])
            try:
                # Een nieuwe registratie toevoegen mag altijd.
                assert srv._append_only_ok(
                    key, [{'id': 1, 'paraaf': {'gebruiker': 'jasper'}}, {'id': 2}])
                # De paraaf vervalsen, de registratie wijzigen of hem laten
                # verdwijnen mag geen van drieën.
                assert not srv._append_only_ok(
                    key, [{'id': 1, 'paraaf': {'gebruiker': 'iemand_anders'}}])
                assert not srv._append_only_ok(key, [{'id': 2}])
                assert not srv._append_only_ok(key, [])
            finally:
                conn = srv._db()
                with conn:
                    conn.execute('DELETE FROM records WHERE key=?', (key,))
                    conn.execute('DELETE FROM versies WHERE key=?', (key,))

    def test_afvulsessies_zijn_niet_append_only(self, app):
        """Een sessie wordt na het starten afgesloten (eindtijd + status), dus
        die moet wel muteerbaar blijven."""
        assert 'afvul_sessies' not in srv._APPEND_ONLY
        srv._write_json('afvul_sessies', [{'id': 1, 'status': 'open'}])
        try:
            assert srv._append_only_ok('afvul_sessies',
                                       [{'id': 1, 'status': 'afgesloten'}])
        finally:
            conn = srv._db()
            with conn:
                conn.execute("DELETE FROM records WHERE key='afvul_sessies'")
                conn.execute("DELETE FROM versies WHERE key='afvul_sessies'")


class TestSecretsMaskering:
    def test_mask_vervangt_gevoelige_velden_door_sentinel(self):
        masked = srv._mask_secrets('smtp_creds', {'host': 'mail.x', 'password': 'geheim'})
        assert masked['password'] == srv._SECRET_SENTINEL
        assert masked['host'] == 'mail.x'
        # Niet-secure keys blijven onaangeroerd
        assert srv._mask_secrets('batches', {'password': 'x'}) == {'password': 'x'}
        # De volledige sentinel-round-trip via disk wordt in TestSecureKeysHttp gedekt.


# ── 2. HTTP-integratie ───────────────────────────────────────────────────────

class TestDataApi:
    def test_data_round_trip(self, app):
        status, _, _ = req(app, 'POST', '/api/data/hop_addities', body=[{'id': 1}])
        assert status == 200
        status, body, _ = req(app, 'GET', '/api/data/hop_addities')
        assert status == 200 and body == [{'id': 1}]

    def test_ongeldige_key_bereikt_data_api_niet(self, app):
        # extract_key weigert alles buiten [A-Za-z0-9_]; de route valt dan
        # door naar 404 — er wordt dus nooit een pad met '-', '/' of '..'
        # als bestandsnaam gebruikt.
        status, _, _ = req(app, 'POST', '/api/data/a-b', body=[])
        assert status == 404

    def test_ongeldige_json_geeft_400(self, app):
        status, _, _ = req(app, 'POST', '/api/data/batches', body=b'{kapot')
        assert status == 400

    def test_schemavalidatie_geeft_422(self, app):
        status, body, _ = req(app, 'POST', '/api/data/batches', body={'geen': 'array'})
        assert status == 422
        assert body['key'] == 'batches'

    def test_onbekende_key_geeft_404_bij_get(self, app):
        status, _, _ = req(app, 'GET', '/api/data/bestaat_niet_xyz')
        assert status == 404

    def test_optimistic_locking_409(self, app):
        status, body, _ = req(app, 'POST', '/api/data/tanks', body=[{'id': 1}])
        assert status == 200
        v1 = body['version']
        # Tweede schrijver met de juiste versie → ok, nieuwe versie
        status, body, _ = req(app, 'POST', '/api/data/tanks', body=[{'id': 1}, {'id': 2}],
                              headers={'X-Data-Version': v1})
        assert status == 200
        # Eerste schrijver met de verouderde versie → 409, niets overschreven
        status, body, _ = req(app, 'POST', '/api/data/tanks', body=[],
                              headers={'X-Data-Version': v1})
        assert status == 409
        assert req(app, 'GET', '/api/data/tanks')[1] == [{'id': 1}, {'id': 2}]

    def test_get_geeft_versie_header(self, app):
        req(app, 'POST', '/api/data/klanten', body=[{'id': 1}])
        status, _, headers = req(app, 'GET', '/api/data/klanten')
        assert status == 200
        assert headers.get('X-Data-Version')

    def test_te_grote_request_geeft_413(self, app):
        # Content-Length boven de limiet → server weigert vóór het lezen
        host, poort = app.replace('http://', '').split(':')
        conn = http.client.HTTPConnection(host, int(poort), timeout=10)
        conn.putrequest('POST', '/api/data/batches')
        conn.putheader('Content-Type', 'application/json')
        conn.putheader('Content-Length', str(srv.MAX_CONTENT_LENGTH + 1))
        conn.endheaders()
        resp = conn.getresponse()
        assert resp.status == 413
        conn.close()


class TestContentLength:
    """Content-Length wordt strikt gelezen. Een negatieve waarde liet
    rfile.read(-1) tot het einde van de stream lezen: geen limiet meer, ook
    vóór het inloggen op de directe poort."""

    @staticmethod
    def _statusregel(base, verzoek: bytes) -> bytes:
        host, poort = base.replace('http://', '').split(':')
        # Schrijfkant blijft open: een server die tot EOF leest antwoordt
        # nooit en de recv loopt in de timeout.
        s = socket.create_connection((host, int(poort)), timeout=5)
        try:
            s.sendall(verzoek)
            data = b''
            while b'\r\n' not in data:
                deel = s.recv(4096)
                if not deel:
                    break
                data += deel
            return data.split(b'\r\n')[0]
        finally:
            s.close()

    def test_negatieve_lengte_op_login_geeft_meteen_400(self, app_direct):
        regel = self._statusregel(app_direct, (
            b'POST /api/login HTTP/1.1\r\nHost: x\r\n'
            b'Content-Type: application/json\r\nContent-Length: -1\r\n\r\n'
            b'{"username":'))
        assert b' 400 ' in regel

    def test_ongeldige_lengte_geeft_400(self, app):
        for waarde in (b'-2', b'abc', b'+5', b'1e3'):
            regel = self._statusregel(app, (
                b'POST /api/data/water_addities HTTP/1.1\r\nHost: x\r\n'
                b'Content-Type: application/json\r\nContent-Length: ' + waarde +
                b'\r\n\r\n[]'))
            assert b' 400 ' in regel, waarde

    def test_backup_trigger_antwoordt_eenmaal_bij_te_grote_body(self, app):
        # _handle_backup_trigger negeerde de None van _read_body en stuurde
        # na de 413 nog een tweede antwoord.
        host, poort = app.replace('http://', '').split(':')
        s = socket.create_connection((host, int(poort)), timeout=10)
        try:
            s.sendall(b'POST /api/backups/trigger HTTP/1.1\r\nHost: x\r\n'
                      b'Content-Length: 1000\r\n\r\n')
            s.shutdown(socket.SHUT_WR)
            data = b''
            while True:
                deel = s.recv(65536)
                if not deel:
                    break
                data += deel
        finally:
            s.close()
        assert data.startswith(b'HTTP/1.0 413') or data.startswith(b'HTTP/1.1 413')
        assert data.count(b'HTTP/1.') == 1


class TestBulk:
    """GET /api/bulk — alle keys + versies in één antwoord (snelle app-start)."""

    def test_bulk_bevat_data_en_kloppende_versies(self, app):
        req(app, 'POST', '/api/data/locaties', body=[{'id': 1, 'naam': 'Koelcel'}])
        status, body, _ = req(app, 'GET', '/api/bulk')
        assert status == 200
        assert body['data']['locaties'] == [{'id': 1, 'naam': 'Koelcel'}]
        # Versie in bulk == X-Data-Version van de losse GET
        _, _, headers = req(app, 'GET', '/api/data/locaties')
        assert body['versions']['locaties'] == headers['X-Data-Version']

    def test_bulk_maskeert_secrets(self, app):
        req(app, 'POST', '/api/data/claude_creds', body={'apiKey': 'sk-ant-geheim'})
        _, body, _ = req(app, 'GET', '/api/bulk')
        assert body['data']['claude_creds']['apiKey'] == srv._SECRET_SENTINEL


class TestAppIcoon:
    """GET /api/app_icoon — het logo als echt bestand (iOS home-screen-icoon)."""

    PNG = 'data:image/png;base64,' + base64.b64encode(b'\x89PNG-nep').decode()

    def test_zonder_logo_404(self, app):
        req(app, 'POST', '/api/data/app_logo', body=b'null')
        assert req(app, 'GET', '/api/app_icoon')[0] == 404

    def test_serveert_bytes_met_etag_en_304(self, app):
        assert req(app, 'POST', '/api/data/app_logo', body=self.PNG)[0] == 200
        try:
            with urllib.request.urlopen(app + '/api/app_icoon') as r:
                assert r.status == 200
                assert r.headers['Content-Type'] == 'image/png'
                assert 'max-age' in r.headers.get('Cache-Control', '')
                etag = r.headers['ETag']
                assert r.read() == b'\x89PNG-nep'
            verzoek = urllib.request.Request(app + '/api/app_icoon',
                                             headers={'If-None-Match': etag})
            try:
                urllib.request.urlopen(verzoek)
                assert False, '304 verwacht'
            except urllib.error.HTTPError as e:
                assert e.code == 304
        finally:
            req(app, 'POST', '/api/data/app_logo', body=b'null')

    def test_gegenereerd_icoon_heeft_voorrang(self, app):
        # Het client-gegenereerde vierkante PNG-icoon (app_logo_icoon) wint
        # van het ruwe logo — iOS weigert bv. SVG als home-screen-icoon.
        svg = 'data:image/svg+xml;base64,' + base64.b64encode(b'<svg/>').decode()
        png = 'data:image/png;base64,' + base64.b64encode(b'\x89PNG-icoon').decode()
        req(app, 'POST', '/api/data/app_logo', body=svg)
        req(app, 'POST', '/api/data/app_logo_icoon', body={'van': 'x', 'icoon': png})
        try:
            with urllib.request.urlopen(app + '/api/app_icoon') as r:
                assert r.headers['Content-Type'] == 'image/png'
                assert r.read() == b'\x89PNG-icoon'
        finally:
            req(app, 'POST', '/api/data/app_logo', body=b'null')
            req(app, 'POST', '/api/data/app_logo_icoon', body={})

    def test_versie_pad_bereikt_zelfde_endpoint(self, app):
        # De client cache-bust met /api/app_icoon/v<versie> — prefix-route
        assert req(app, 'POST', '/api/data/app_logo', body=self.PNG)[0] == 200
        try:
            with urllib.request.urlopen(app + '/api/app_icoon/v12345g') as r:
                assert r.status == 200
                assert r.read() == b'\x89PNG-nep'
        finally:
            req(app, 'POST', '/api/data/app_logo', body=b'null')

    def test_groot_raw_logo_wordt_toch_geserveerd(self, app):
        # Ruwe-logo-fallback accepteert grote uploads (>1,5 MB) — de
        # loginpagina-limiet geldt alleen voor inline embedden.
        groot = 'data:image/png;base64,' + base64.b64encode(b'\x89PNG' + b'x' * 2_000_000).decode()
        assert req(app, 'POST', '/api/data/app_logo', body=groot)[0] == 200
        try:
            with urllib.request.urlopen(app + '/api/app_icoon') as r:
                assert r.status == 200
                assert len(r.read()) == 2_000_004
        finally:
            req(app, 'POST', '/api/data/app_logo', body=b'null')

    def test_head_op_icoon_endpoint(self, app):
        assert req(app, 'POST', '/api/data/app_logo', body=self.PNG)[0] == 200
        try:
            host, poort = app.replace('http://', '').split(':')
            conn = http.client.HTTPConnection(host, int(poort), timeout=10)
            conn.request('HEAD', '/api/app_icoon')
            resp = conn.getresponse()
            assert resp.status == 200
            assert resp.getheader('Content-Type') == 'image/png'
            assert resp.read() == b''  # HEAD: headers zonder body
            conn.close()
            # HEAD op andere paden blijft geweigerd
            conn = http.client.HTTPConnection(host, int(poort), timeout=10)
            conn.request('HEAD', '/api/health')
            assert conn.getresponse().status == 405
            conn.close()
        finally:
            req(app, 'POST', '/api/data/app_logo', body=b'null')

    def test_pre_auth_op_directe_poort(self, app, app_direct):
        assert req(app, 'POST', '/api/data/app_logo', body=self.PNG)[0] == 200
        try:
            # Zonder sessie bereikbaar (staat toch op de loginpagina; iOS
            # heeft het nodig voor het home-screen-icoon)
            with urllib.request.urlopen(app_direct + '/api/app_icoon') as r:
                assert r.status == 200
        finally:
            req(app, 'POST', '/api/data/app_logo', body=b'null')


class TestAppendOnlyHttp:
    def test_journaal_is_append_only_via_http(self, app):
        r1 = {'id': 1, 'boekstuk': 1, 'dagboek': 'verkoop', 'netto_cent': 4800}
        status, _, _ = req(app, 'POST', '/api/data/journaal', body=[r1])
        assert status == 200
        # muteren → 422
        status, body, _ = req(app, 'POST', '/api/data/journaal',
                              body=[{**r1, 'netto_cent': 1}])
        assert status == 422 and body['error'] == 'append-only'
        # weglaten → 422
        status, _, _ = req(app, 'POST', '/api/data/journaal', body=[])
        assert status == 422
        # aanvullen → 200
        status, _, _ = req(app, 'POST', '/api/data/journaal', body=[r1, {'id': 2, 'boekstuk': 2}])
        assert status == 200


class TestCommit:
    def test_commit_schrijft_meerdere_keys_atomair(self, app):
        status, body, _ = req(app, 'POST', '/api/commit', body={
            'data': {'lots': [{'id': 1}], 'ingredienten': [{'id': 2}]},
        })
        assert status == 200
        assert set(body['versions']) == {'lots', 'ingredienten'}
        assert req(app, 'GET', '/api/data/lots')[1] == [{'id': 1}]

    def test_commit_conflict_schrijft_niets(self, app):
        req(app, 'POST', '/api/data/verpakkingen', body=[{'id': 1}])
        status, body, _ = req(app, 'POST', '/api/commit', body={
            'data': {'verpakkingen': [], 'onderdelen': [{'id': 9}]},
            'versions': {'verpakkingen': 'verouderde-hash'},
        })
        assert status == 409
        assert 'verpakkingen' in body['conflicts']
        assert req(app, 'GET', '/api/data/verpakkingen')[1] == [{'id': 1}]
        assert req(app, 'GET', '/api/data/onderdelen')[0] == 404

    def test_commit_appendonly_schending_schrijft_niets(self, app):
        # Zorg (volgorde-onafhankelijk) dat het journaal een regel heeft;
        # leegmaken via commit moet dan integraal geweigerd worden.
        srv._write_json('journaal', [{'id': 900}])
        status, body, _ = req(app, 'POST', '/api/commit', body={
            'data': {'journaal': [], 'artikelen': [{'id': 3}]},
        })
        assert status == 422 and body['key'] == 'journaal'
        assert req(app, 'GET', '/api/data/artikelen')[0] == 404

    def test_commit_zonder_data_geeft_400(self, app):
        status, _, _ = req(app, 'POST', '/api/commit', body={'data': {}})
        assert status == 400

    def test_commit_teveel_keys_geeft_400(self, app):
        data = {f'k{i}': [] for i in range(srv.COMMIT_MAX_KEYS + 1)}
        status, _, _ = req(app, 'POST', '/api/commit', body={'data': data})
        assert status == 400

    def test_app_knipt_commits_op_dezelfde_grenzen(self):
        # De app deelt een bundel (backup terugzetten, fabrieksreset) op in
        # commits van hooguit COMMIT_MAX_KEYS keys en COMMIT_MAX_BYTES bytes
        # (src/utils/commit.ts). Loopt dat uiteen met de server, dan weigert
        # die elke groep met een 400 zonder key.
        bron = (Path(__file__).resolve().parent.parent
                / 'src' / 'utils' / 'commit.ts').read_text(encoding='utf-8')
        keys = re.search(r'export const COMMIT_MAX_KEYS\s*=\s*([\d_]+)', bron)
        byts = re.search(r'export const COMMIT_MAX_BYTES\s*=\s*([\d_]+)', bron)
        assert keys and byts, 'COMMIT_MAX_KEYS/COMMIT_MAX_BYTES niet gevonden in commit.ts'
        assert int(keys.group(1).replace('_', '')) == srv.COMMIT_MAX_KEYS
        assert int(byts.group(1).replace('_', '')) < srv.MAX_CONTENT_LENGTH

    def test_backup_import_kent_de_append_only_keys(self):
        # Een backup terugzetten voegt op append-only keys alleen ontbrekende
        # regels toe (APPEND_ONLY_KEYS in src/utils/excel.ts). Een key die de
        # server append-only maakt maar de app niet kent, zou de import met
        # een 422 laten weigeren.
        bron = (Path(__file__).resolve().parent.parent
                / 'src' / 'utils' / 'excel.ts').read_text(encoding='utf-8')
        blok = bron.split('export const APPEND_ONLY_KEYS')[1].split(']')[0]
        assert set(re.findall(r"'(\w+)'", blok)) == set(srv._APPEND_ONLY)


class TestNextNr:
    def test_reeksen_zijn_gescheiden_en_oplopend(self, app):
        s1, b1, _ = req(app, 'POST', '/api/nextnr', body={'reeks': 'factuur', 'jaar': 2026})
        s2, b2, _ = req(app, 'POST', '/api/nextnr', body={'reeks': 'factuur', 'jaar': 2026})
        s3, b3, _ = req(app, 'POST', '/api/nextnr', body={'reeks': 'creditnota', 'jaar': 2026})
        assert (s1, s2, s3) == (200, 200, 200)
        assert b2['nr'] == b1['nr'] + 1
        assert b1['nummer'].startswith('F2026-')
        assert b3['nummer'].startswith('CN2026-') or b3['nummer'] != b1['nummer']

    def test_parallel_geen_dubbele_nummers(self, app):
        nummers, fouten = [], []
        def haal():
            try:
                s, b, _ = req(app, 'POST', '/api/nextnr', body={'reeks': 'factuur', 'jaar': 2026})
                assert s == 200
                nummers.append(b['nummer'])
            except Exception as e:  # pragma: no cover
                fouten.append(e)
        threads = [threading.Thread(target=haal) for _ in range(20)]
        for t in threads: t.start()
        for t in threads: t.join()
        assert not fouten
        assert len(nummers) == 20
        assert len(set(nummers)) == 20

    def test_ongeldige_reeks_geeft_400(self, app):
        status, _, _ = req(app, 'POST', '/api/nextnr', body={'reeks': 'x', 'jaar': 2026})
        assert status == 400
        status, _, _ = req(app, 'POST', '/api/nextnr', body={'reeks': 'factuur', 'jaar': 1900})
        assert status == 400

    def test_bestelling_reeks_is_kort_en_doorlopend(self, app):
        # Handmatige bestellingen krijgen een kort M-nummer dat NIET per jaar
        # reset: nr 2 (2026) telt door naar nr 3 in 2027, prefix blijft "M-".
        s1, b1, _ = req(app, 'POST', '/api/nextnr', body={'reeks': 'bestelling', 'jaar': 2026})
        s2, b2, _ = req(app, 'POST', '/api/nextnr', body={'reeks': 'bestelling', 'jaar': 2026})
        s3, b3, _ = req(app, 'POST', '/api/nextnr', body={'reeks': 'bestelling', 'jaar': 2027})
        assert (s1, s2, s3) == (200, 200, 200)
        assert b1['nummer'].startswith('M-') and '2026' not in b1['nummer']
        assert b2['nr'] == b1['nr'] + 1
        assert b3['nr'] == b2['nr'] + 1  # geen jaarreset

    def test_bestelling_vangnet_bestaand_nummer(self, app):
        # Staat er al een hoger bestel_nummer in de data (bijv. na restore),
        # dan geeft de reeks het volgende dáárboven uit — geen hergebruik.
        req(app, 'POST', '/api/data/bestellingen',
            body=[{'id': 1, 'bestel_nummer': 'M-0042'}])
        s, b, _ = req(app, 'POST', '/api/nextnr', body={'reeks': 'bestelling', 'jaar': 2026})
        assert s == 200
        assert b['nr'] == 43
        assert b['nummer'] == 'M-0043'


class TestRateLimit:
    def test_429_boven_de_limiet_met_retry_after(self, app):
        oud = srv._RATE_MAX
        srv._rate_buckets.clear()
        srv._RATE_MAX = 5
        try:
            statussen = [req(app, 'GET', '/api/data/hop_addities')[0] for _ in range(7)]
            assert statussen[:5] == [200] * 5
            assert 429 in statussen[5:]
            status, _, headers = req(app, 'GET', '/api/data/hop_addities')
            assert status == 429
            assert int(headers.get('Retry-After', '0')) >= 1
        finally:
            srv._RATE_MAX = oud
            srv._rate_buckets.clear()


class TestUpload:
    def test_geldige_upload_wordt_opgeslagen(self, app):
        inhoud = base64.b64encode(b'%PDF-1.4 test').decode()
        status, body, _ = req(app, 'POST', '/api/upload/factuur_test.pdf', body={'data': inhoud})
        assert status == 200 and body['ok'] is True
        assert (srv.UPLOAD_DIR / 'factuur_test.pdf').read_bytes() == b'%PDF-1.4 test'

    def test_verboden_extensie_en_traversal_geven_400(self, app):
        status, _, _ = req(app, 'POST', '/api/upload/shell.exe', body={'data': ''})
        assert status == 400
        status, _, _ = req(app, 'POST', '/api/upload/../buiten.pdf', body={'data': ''})
        assert status == 400

    def test_kapotte_base64_geeft_400(self, app):
        status, _, _ = req(app, 'POST', '/api/upload/x.pdf', body={'data': '@@geen-base64@@'})
        assert status == 400

    def test_delete_upload(self, app):
        (srv.UPLOAD_DIR / 'weg.pdf').write_bytes(b'x')
        status, _, _ = req(app, 'POST', '/api/delete_upload/weg.pdf', body={})
        assert status == 200
        assert not (srv.UPLOAD_DIR / 'weg.pdf').exists()


class TestSecureKeysHttp:
    def test_secrets_gemaskeerd_via_get_en_sentinel_merge_bij_post(self, app):
        status, _, _ = req(app, 'POST', '/api/data/smtp_creds',
                           body={'host': 'mail.x', 'password': 'supergeheim'})
        assert status == 200
        # GET maskeert het wachtwoord
        status, body, _ = req(app, 'GET', '/api/data/smtp_creds')
        assert status == 200
        assert body['password'] == srv._SECRET_SENTINEL
        assert body['host'] == 'mail.x'
        # POST met sentinel + zelfde bestemming → geheim blijft opgeslagen
        status, _, _ = req(app, 'POST', '/api/data/smtp_creds',
                           body={'host': 'Mail.X', 'password': srv._SECRET_SENTINEL,
                                 'fromName': 'Brouwerij'})
        assert status == 200
        opgeslagen = srv._read_json('smtp_creds')
        assert opgeslagen == {'host': 'Mail.X', 'password': 'supergeheim',
                              'fromName': 'Brouwerij'}
        # POST met sentinel + gewijzigde host → 400: het opgeslagen wachtwoord
        # gaat nooit mee naar een nieuw adres (ERP-plan 5.1), niets gewijzigd
        status, body, _ = req(app, 'POST', '/api/data/smtp_creds',
                              body={'host': 'nieuw.x', 'password': srv._SECRET_SENTINEL})
        assert status == 400 and body['error'] == 'secret_opnieuw_invoeren'
        assert srv._read_json('smtp_creds') == opgeslagen
        # Met een opnieuw ingevuld wachtwoord mag het adres wél wijzigen
        status, _, _ = req(app, 'POST', '/api/data/smtp_creds',
                           body={'host': 'nieuw.x', 'password': 'nieuwgeheim'})
        assert status == 200
        assert srv._read_json('smtp_creds') == {'host': 'nieuw.x', 'password': 'nieuwgeheim'}

    def test_sentinel_gaat_niet_naar_een_ander_adres(self, app):
        """/api/mail/test, /api/woocommerce/test en /api/commit vulden de
        sentinel in, ook bij een host/storeUrl uit het verzoek: het opgeslagen
        geheim ging zo naar een willekeurig adres."""
        assert req(app, 'POST', '/api/data/smtp_creds', body={
            'host': 'mail.legit', 'port': 587, 'username': 'u',
            'password': 'supergeheim', 'security': 'starttls'})[0] == 200
        luisteraar = socket.socket()
        luisteraar.bind(('127.0.0.1', 0))
        luisteraar.listen(1)
        luisteraar.settimeout(0.5)
        try:
            poort = luisteraar.getsockname()[1]
            status, body, _ = req(app, 'POST', '/api/mail/test', body={
                'host': '127.0.0.1', 'port': poort, 'username': 'u',
                'password': srv._SECRET_SENTINEL, 'security': 'none'})
            assert status == 400 and body['error'] == 'secret_opnieuw_invoeren'
            with pytest.raises(socket.timeout):
                luisteraar.accept()  # er is niet eens verbonden
        finally:
            luisteraar.close()
        # Beveiliging omlaag naar 'none' op dezelfde host telt ook
        status, body, _ = req(app, 'POST', '/api/mail/test', body={
            'host': 'mail.legit', 'port': 587, 'username': 'u',
            'password': srv._SECRET_SENTINEL, 'security': 'none'})
        assert status == 400 and body['error'] == 'secret_opnieuw_invoeren'

        wc = {'storeUrl': 'https://shop.example', 'consumerKey': 'ck_echt',
              'consumerSecret': 'cs_echt'}
        assert req(app, 'POST', '/api/data/woocommerce_creds', body=wc)[0] == 200
        try:
            self._wc_deel(app, wc)
        finally:
            req(app, 'POST', '/api/data/woocommerce_creds', body={})
            req(app, 'POST', '/api/data/smtp_creds', body={})

    @staticmethod
    def _wc_deel(app, wc):
        status, body, _ = req(app, 'POST', '/api/woocommerce/test', body={
            'storeUrl': 'https://kwaadaardig.example',
            'consumerKey': srv._SECRET_SENTINEL, 'consumerSecret': srv._SECRET_SENTINEL})
        assert status == 400 and body['error'] == 'secret_opnieuw_invoeren'
        # Commit: hele commit geweigerd, niets geschreven — ook de andere key niet
        req(app, 'POST', '/api/data/gn_codes', body=[{'id': 1, 'code': '2203'}])
        status, body, _ = req(app, 'POST', '/api/commit', body={'data': {
            'gn_codes': [],
            'woocommerce_creds': {'storeUrl': 'https://kwaadaardig.example',
                                  'consumerKey': srv._SECRET_SENTINEL,
                                  'consumerSecret': srv._SECRET_SENTINEL}}})
        assert status == 400 and body['key'] == 'woocommerce_creds'
        assert srv._read_json('woocommerce_creds') == wc
        assert srv._read_json('gn_codes') == [{'id': 1, 'code': '2203'}]
        # Zelfde winkel (andere schrijfwijze) met sentinel: gewoon opslaan
        status, _, _ = req(app, 'POST', '/api/commit', body={'data': {
            'woocommerce_creds': {'storeUrl': 'https://Shop.example/',
                                  'consumerKey': srv._SECRET_SENTINEL,
                                  'consumerSecret': srv._SECRET_SENTINEL,
                                  'importInterval': 30}}})
        assert status == 200
        assert srv._read_json('woocommerce_creds')['consumerSecret'] == 'cs_echt'

    def test_audit_log_wordt_server_side_geschreven(self, app):
        req(app, 'POST', '/api/data/recepten', body=[{'id': 1}])
        logs = list(srv.AUDIT_DIR.glob('audit_*.jsonl'))
        assert logs, 'server-audit ontbreekt'
        regels = [json.loads(r) for r in logs[0].read_text().splitlines() if r.strip()]
        assert any(r.get('key') == 'recepten' for r in regels)


class TestMollie:
    """Mollie-betaalproxy: bedrag-formattering, secrets-maskering en de
    validatie-/creds-gates die vóór de upstream-call worden geraakt (geen
    netwerk nodig — de echte betaal-call wordt niet getest)."""

    def test_amount_formattering(self):
        assert srv._mollie_amount(1050) == '10.50'
        assert srv._mollie_amount(5) == '0.05'
        assert srv._mollie_amount(100_000) == '1000.00'
        # Ongeldig: nul/negatief, booleans, niet-numeriek, absurd groot.
        assert srv._mollie_amount(0) is None
        assert srv._mollie_amount(-100) is None
        assert srv._mollie_amount(True) is None
        assert srv._mollie_amount('abc') is None
        assert srv._mollie_amount(200_000_000) is None

    def test_gebruikt_payment_links_endpoint(self):
        # De betaallink loopt via de Payment Links API (verloopt standaard niet),
        # niet via de kortlevende Payments API die na verlopen naar de website
        # (homepagina) doorstuurt.
        assert srv.MOLLIE_PAYMENT_LINKS_URL == 'https://api.mollie.com/v2/payment-links'

    def test_link_url_uit_response(self):
        # De deelbare URL komt uit _links.paymentLink.href (Payment Links API),
        # niet uit _links.checkout.href (Payments API).
        resp = {'id': 'pl_abc',
                '_links': {'paymentLink': {'href': 'https://useplink.com/payment/abc'}}}
        assert srv._mollie_link_url(resp) == 'https://useplink.com/payment/abc'
        # Ontbrekend/leeg/verkeerd veld of niet-http → None (caller geeft 502).
        assert srv._mollie_link_url({}) is None
        assert srv._mollie_link_url({'_links': {'checkout': {'href': 'https://x'}}}) is None
        assert srv._mollie_link_url({'_links': {'paymentLink': {'href': 'ftp://x'}}}) is None
        assert srv._mollie_link_url('nope') is None

    def test_mask_verbergt_apikey(self):
        masked = srv._mask_secrets(
            'mollie_creds',
            {'apiKey': 'live_geheim', 'enabled': True, 'redirectUrl': 'https://x.nl'})
        assert masked['apiKey'] == srv._SECRET_SENTINEL
        assert masked['enabled'] is True
        assert masked['redirectUrl'] == 'https://x.nl'

    def test_load_creds_weigert_ongeldige_key(self, app):
        req(app, 'POST', '/api/data/mollie_creds',
            body={'apiKey': 'zomaarwat', 'enabled': True, 'redirectUrl': ''})
        assert srv._load_mollie_creds() is None

    def test_payment_zonder_creds_401(self, app):
        req(app, 'POST', '/api/data/mollie_creds',
            body={'apiKey': '', 'enabled': False, 'redirectUrl': ''})
        st, _, _ = req(app, 'POST', '/api/mollie/payment',
                       body={'amountCent': 1000, 'description': 'x', 'redirectUrl': 'https://x.nl'})
        assert st == 401

    def test_payment_niet_ingeschakeld_403(self, app):
        req(app, 'POST', '/api/data/mollie_creds',
            body={'apiKey': 'test_abc', 'enabled': False, 'redirectUrl': 'https://x.nl'})
        st, _, _ = req(app, 'POST', '/api/mollie/payment',
                       body={'amountCent': 1000, 'description': 'x', 'redirectUrl': 'https://x.nl'})
        assert st == 403

    def test_payment_ongeldig_bedrag_400(self, app):
        req(app, 'POST', '/api/data/mollie_creds',
            body={'apiKey': 'test_abc', 'enabled': True, 'redirectUrl': 'https://x.nl'})
        st, _, _ = req(app, 'POST', '/api/mollie/payment',
                       body={'amountCent': 0, 'description': 'x', 'redirectUrl': 'https://x.nl'})
        assert st == 400

    def test_payment_ongeldige_redirect_400(self, app):
        req(app, 'POST', '/api/data/mollie_creds',
            body={'apiKey': 'test_abc', 'enabled': True, 'redirectUrl': 'https://x.nl'})
        st, _, _ = req(app, 'POST', '/api/mollie/payment',
                       body={'amountCent': 1000, 'description': 'x', 'redirectUrl': 'ftp://x'})
        assert st == 400

    def test_test_endpoint_weigert_verkeerd_keyformaat(self, app):
        # Geen netwerk: een key zonder test_/live_-prefix wordt lokaal geweigerd.
        st, body, _ = req(app, 'POST', '/api/mollie/test', body={'apiKey': 'nope'})
        assert st == 200 and body.get('ok') is False and body.get('detail') == 'format'


class TestSqliteOpslag:
    """SQLite-opslaglaag (ERP-plan 4.1): WAL, migratie, versies, backup."""

    def test_wal_mode_actief(self, app):
        assert srv._db().execute('PRAGMA journal_mode').fetchone()[0] == 'wal'

    def test_scalar_keys_round_trip(self, app):
        status, _, _ = req(app, 'POST', '/api/data/app_name', body='Proefbrouwerij')
        assert status == 200
        assert req(app, 'GET', '/api/data/app_name')[1] == 'Proefbrouwerij'
        status, _, _ = req(app, 'POST', '/api/data/app_logo', body=b'null')
        assert status == 200
        assert req(app, 'GET', '/api/data/app_logo')[1] is None

    def test_versie_header_is_hash_van_geserveerde_bytes(self, app):
        # Zelfde contract als vóór SQLite: X-Data-Version == sha256[:16] van
        # exact de bytes die GET serveert (niet-secure keys).
        req(app, 'POST', '/api/data/koel_logs', body=[{'id': 1, 'temp': 4.2}])
        with urllib.request.urlopen(app + '/api/data/koel_logs') as r:
            raw = r.read()
            versie = r.headers['X-Data-Version']
        assert versie == hashlib.sha256(raw).hexdigest()[:16]

    def test_lege_array_blijft_bestaan(self, app):
        # Een key met een lege array is een bestaande key (200, geen 404).
        req(app, 'POST', '/api/data/dry_hops', body=[])
        status, body, headers = req(app, 'GET', '/api/data/dry_hops')
        assert status == 200 and body == []
        assert headers.get('X-Data-Version') not in (None, '0')

    def test_migratie_importeert_en_verplaatst_json(self, app, tmp_path_factory):
        oud_data_dir = srv.DATA_DIR
        vers = tmp_path_factory.mktemp('migratie')
        (vers / 'batches.json').write_text(json.dumps([{'id': 7, 'naam': 'Tripel'}]))
        (vers / 'app_name.json').write_text('"Migratietest"')
        (vers / 'smtp_creds.json').write_text(json.dumps({'host': 'mail.x', 'password': 'geheim'}))
        (vers / 'kapot.json').write_text('{dit is geen json')
        srv.DATA_DIR = vers
        try:
            # Eerste request initialiseert de database en draait de migratie.
            status, body, _ = req(app, 'GET', '/api/data/batches')
            assert status == 200 and body == [{'id': 7, 'naam': 'Tripel'}]
            assert req(app, 'GET', '/api/data/app_name')[1] == 'Migratietest'
            # Gemigreerde credentials worden via GET gemaskeerd geserveerd
            status, creds, _ = req(app, 'GET', '/api/data/smtp_creds')
            assert status == 200 and creds['password'] == srv._SECRET_SENTINEL
            # Bronbestanden zijn verplaatst naar de veiligheidsmap
            assert not (vers / 'batches.json').exists()
            migratie_dir = vers / srv.JSON_MIGRATIE_DIRNAAM
            assert (migratie_dir / 'batches.json').exists()
            assert (migratie_dir / 'smtp_creds.json').exists()
            # Onleesbaar bestand blijft staan (niet stil weggegooid)
            assert (vers / 'kapot.json').exists()
            assert (vers / srv.DB_NAAM).exists()
        finally:
            srv.DATA_DIR = oud_data_dir

    def test_backup_exporteert_json_en_database(self, app):
        req(app, 'POST', '/api/data/gn_codes', body=[{'id': 1, 'code': '2203'}])
        status, body, _ = req(app, 'POST', '/api/backups/trigger', body={})
        assert status == 200
        dest = srv.BACKUP_DIR / body['date']
        assert json.loads((dest / 'gn_codes.json').read_text()) == [{'id': 1, 'code': '2203'}]
        assert (dest / srv.DB_NAAM).exists()

    def test_backup_download_zonder_ongemaskeerde_geheimen(self, app):
        """De download-ZIP (naar de browser) bevatte de credentials
        onversleuteld plus een db-kopie. De backup op schijf blijft volledig
        (restore leest daaruit), maar alleen voor de addon-gebruiker leesbaar."""
        import zipfile as _zipfile
        req(app, 'POST', '/api/data/gn_codes', body=[{'id': 1, 'code': '2203'}])
        assert req(app, 'POST', '/api/data/mollie_creds',
                   body={'apiKey': 'live_SUPERGEHEIM', 'enabled': True})[0] == 200
        try:
            status, body, _ = req(app, 'POST', '/api/backups/trigger', body={})
            assert status == 200
            datum = body['date']
            with urllib.request.urlopen(app + f'/api/backups/{datum}') as r:
                data = r.read()
            with _zipfile.ZipFile(io.BytesIO(data)) as zf:
                namen = zf.namelist()
                assert srv.DB_NAAM not in namen
                assert 'gn_codes.json' in namen
                mollie = json.loads(zf.read('mollie_creds.json'))
                assert mollie == {'apiKey': srv._SECRET_SENTINEL, 'enabled': True}
                assert all(b'live_SUPERGEHEIM' not in zf.read(n) for n in namen)
            dest = srv.BACKUP_DIR / datum
            assert json.loads((dest / 'mollie_creds.json').read_text())['apiKey'] == 'live_SUPERGEHEIM'
            assert (dest / srv.DB_NAAM).exists()
            assert (dest / 'mollie_creds.json').stat().st_mode & 0o777 == 0o600
            assert dest.stat().st_mode & 0o777 == 0o700
        finally:
            req(app, 'POST', '/api/data/mollie_creds', body={})

    def test_retentie_bewaart_altijd_de_nieuwste_backups(self, app):
        """Het hele retentiebeleid hangt aan date.today(). Springt de klok van
        de host vooruit, dan valt élke backup buiten de termijn en wist één
        ronde alles — juist het vangnet dat dan overeind moet blijven."""
        import datetime as _dt
        for dag in range(1, 11):
            (srv.BACKUP_DIR / f'2026-03-{dag:02d}').mkdir(parents=True, exist_ok=True)
        (srv.AUDIT_DIR / 'audit_2026-03.jsonl').write_text('{}\n')
        voor = sorted(d.name for d in srv.BACKUP_DIR.iterdir() if d.is_dir())
        echt = _dt.date
        class KlokVooruit(_dt.date):
            @classmethod
            def today(cls):
                return echt(2046, 1, 1)  # twintig jaar vooruit
        srv.datetime.date = KlokVooruit
        try:
            srv._cleanup_backups()
            srv._cleanup_audit()
        finally:
            srv.datetime.date = echt
        na = sorted(d.name for d in srv.BACKUP_DIR.iterdir() if d.is_dir())
        # precies de nieuwste N blijven staan, de rest is opgeruimd
        assert na == voor[-srv._MIN_BACKUPS_BEWAREN:]
        assert len(na) == srv._MIN_BACKUPS_BEWAREN < len(voor)
        # en het auditspoor blijft ook bestaan
        assert (srv.AUDIT_DIR / 'audit_2026-03.jsonl').exists()

    def test_restore_zet_een_sleutel_terug_uit_backup(self, app):
        origineel = [{'id': 1770000000000001, 'naam': 'Testtripel', 'status': 'actief'},
                     {'id': 1770000000000002, 'naam': 'Testwit', 'status': 'actief'}]
        req(app, 'POST', '/api/data/producten', body=origineel)
        req(app, 'POST', '/api/data/water_addities', body=[{'id': 7}])
        status, body, _ = req(app, 'POST', '/api/backups/trigger', body={})
        assert status == 200
        datum = body['date']
        # Daarna gaat het mis: de lijst wordt overschreven (het scenario van de
        # productmigratie in 1.12.58) en een andere sleutel verandert legitiem.
        req(app, 'POST', '/api/data/producten', body=[{'id': 1, 'naam': 'Testblond'}])
        req(app, 'POST', '/api/data/water_addities', body=[{'id': 7}, {'id': 8}])
        status, body, hdrs = req(app, 'POST', '/api/backups/restore',
                                 body={'date': datum, 'key': 'producten'})
        assert status == 200 and body['ok'] and body['count'] == 2
        status, terug, hdrs = req(app, 'GET', '/api/data/producten')
        assert terug == origineel
        # De versie-header hoort bij de teruggezette inhoud
        assert hdrs.get('X-Data-Version') == body['version']
        # Alleen díe sleutel: de rest blijft de huidige stand
        assert req(app, 'GET', '/api/data/water_addities')[1] == [{'id': 7}, {'id': 8}]
        # Audit-regel
        regels = []
        for f in sorted(srv.AUDIT_DIR.glob('audit_*.jsonl')):
            regels += [json.loads(l) for l in f.read_text().splitlines() if l.strip()]
        assert any(r.get('actie') == 'backup_restore' and r.get('key') == 'producten'
                   and r.get('backup') == datum for r in regels)

    def test_restore_weigert_wat_niet_terug_mag(self, app):
        status, body, _ = req(app, 'POST', '/api/backups/trigger', body={})
        datum = body['date']
        # Onbekende datum / niet-bestaande backup
        assert req(app, 'POST', '/api/backups/restore',
                   body={'date': '1999-01-01', 'key': 'producten'})[0] == 404
        assert req(app, 'POST', '/api/backups/restore',
                   body={'date': 'gisteren', 'key': 'producten'})[0] == 400
        # Ongeldige / onbekende sleutel
        assert req(app, 'POST', '/api/backups/restore',
                   body={'date': datum, 'key': '../etc/passwd'})[0] == 400
        assert req(app, 'POST', '/api/backups/restore',
                   body={'date': datum, 'key': 'bestaat_niet'})[0] == 400
        # Append-only registraties, credentials en server-beheerde keys nooit
        # (een nummerreeks mag niet teruglopen)
        for key in ('journaal', 'haccp_vrijgaven', 'woocommerce_creds',
                    'nummer_reeksen', 'tank_setpoints', 'wc_import_status'):
            status, body, _ = req(app, 'POST', '/api/backups/restore',
                                  body={'date': datum, 'key': key})
            assert status == 422 and body['key'] == key
        # Sleutel die in die backup niet voorkomt
        assert req(app, 'POST', '/api/backups/restore',
                   body={'date': datum, 'key': 'dry_hops'})[0] in (404, 200)


class TestDeltaDubbeleIds:
    """Twee records met dezelfde id in één upsert leverden twee rijen op (de
    primaire sleutel is (key, seq), niet record_id). De key stond daarna met
    een dubbel record in de opslag en verloor permanent delta-ondersteuning;
    bij een append-only key was die dubbel niet meer weg te krijgen."""

    def _versie(self, app, key):
        return req(app, 'GET', f'/api/data/{key}')[2].get('X-Data-Version')

    def test_dubbele_id_in_upsert_wordt_geweigerd(self, app):
        req(app, 'POST', '/api/data/water_profielen', body=[{'id': 1, 'naam': 'start'}])
        ver = self._versie(app, 'water_profielen')
        status, body, _ = req(app, 'POST', '/api/delta/water_profielen',
                              body={'upsert': [{'id': 9, 'naam': 'een'}, {'id': 9, 'naam': 'twee'}],
                                    'delete': []},
                              headers={'X-Data-Version': ver})
        assert status == 400 and 'dubbele id' in body['error']
        # niets geschreven, en delta blijft gewoon werken
        assert req(app, 'GET', '/api/data/water_profielen')[1] == [{'id': 1, 'naam': 'start'}]
        status, _, _ = req(app, 'POST', '/api/delta/water_profielen',
                           body={'upsert': [{'id': 2, 'naam': 'normaal'}], 'delete': []},
                           headers={'X-Data-Version': ver})
        assert status == 200

    def test_zelfde_id_in_upsert_en_delete_wordt_geweigerd(self, app):
        req(app, 'POST', '/api/data/water_doelprofielen', body=[{'id': 1}])
        ver = self._versie(app, 'water_doelprofielen')
        status, body, _ = req(app, 'POST', '/api/delta/water_doelprofielen',
                              body={'upsert': [{'id': 1, 'naam': 'x'}], 'delete': [1]},
                              headers={'X-Data-Version': ver})
        assert status == 400
        assert req(app, 'GET', '/api/data/water_doelprofielen')[1] == [{'id': 1}]


class TestAppendOnlyDubbeleIds:
    """De append-only-guard vergeleek per id via een dict: bij een dubbele id
    bleef alleen de laatste over. `[vervalsing_X, origineel_X]` kwam zo door de
    controle, beide records werden opgeslagen (vervalsing vooraan, dus die
    vond de app) en daarna kon geen enkele payload meer voldoen — journaal of
    CCP-key voorgoed op slot. Nu een vergelijking per id als multiset, in élke
    schrijfweg (/api/data en /api/commit gaan allebei via _append_only_ok)."""

    @staticmethod
    def _reset(*keys):
        conn = srv._db()
        with conn:
            for key in keys:
                conn.execute('DELETE FROM records WHERE key=?', (key,))
                conn.execute('DELETE FROM versies WHERE key=?', (key,))

    def test_dubbele_id_via_data_wordt_geweigerd(self, app):
        key = 'haccp_sluitcontroles'
        orig = {'id': 1, 'oordeel': 'goedgekeurd'}
        vals = {'id': 1, 'oordeel': 'afgekeurd'}
        self._reset(key)
        try:
            assert req(app, 'POST', f'/api/data/{key}', body=[orig])[0] == 200
            status, body, _ = req(app, 'POST', f'/api/data/{key}', body=[vals, orig])
            assert status == 422 and body['error'] == 'append-only'
            assert req(app, 'GET', f'/api/data/{key}')[1] == [orig]
            # Gewoon aanvullen blijft kunnen: de key zit niet op slot.
            status, _, _ = req(app, 'POST', f'/api/data/{key}', body=[orig, {'id': 2}])
            assert status == 200
        finally:
            self._reset(key)

    def test_dubbele_id_via_commit_wordt_geweigerd(self, app):
        self._reset('journaal', 'onderdelen')
        try:
            status, body, _ = req(app, 'POST', '/api/commit', body={'data': {
                'journaal': [{'id': 5, 'debet_cent': 999}, {'id': 5, 'debet_cent': 100}],
                'onderdelen': [{'id': 1}],
            }})
            assert status == 422 and body['key'] == 'journaal'
            # Alles-of-niets: ook de andere key is niet geschreven.
            assert req(app, 'GET', '/api/data/journaal')[0] == 404
            assert req(app, 'GET', '/api/data/onderdelen')[0] == 404
        finally:
            self._reset('journaal', 'onderdelen')

    def test_eerste_write_valt_ook_onder_de_controle(self, app):
        self._reset('haccp_vrijgaven')
        assert not srv._append_only_ok('haccp_vrijgaven', [{'id': 1, 'a': 1}, {'id': 1, 'a': 2}])
        assert srv._append_only_ok('haccp_vrijgaven', [{'id': 1}, {'id': 2}])

    def test_nieuwe_regel_zonder_id_en_losse_waarden_worden_geweigerd(self, app):
        key = 'haccp_afwijkingen'
        self._reset(key)
        srv._write_json(key, [{'id': 1}])
        try:
            assert not srv._append_only_ok(key, [{'id': 1}, {'omschrijving': 'zonder id'}])
            assert not srv._append_only_ok(key, [{'id': 1}, 'geen object'])
            # Id 1 en '1' zijn voor de opslag dezelfde record-id.
            assert not srv._append_only_ok(key, [{'id': 1}, {'id': '1'}])
            assert not srv._append_only_ok(key, [{'id': 1}, {'id': 2}, {'id': '2'}])
        finally:
            self._reset(key)

    def test_bestaande_dubbel_zet_de_key_niet_op_slot(self, app):
        """Een key die van vóór de controle al een dubbel bevat, blijft
        beschrijfbaar zolang beide varianten ongewijzigd meekomen."""
        key = 'haccp_etiketcontroles'
        a = {'id': 1, 'oordeel': 'goedgekeurd'}
        b = {'id': 1, 'oordeel': 'afgekeurd'}
        self._reset(key)
        srv._write_json(key, [b, a])
        try:
            # Wat de client terugstuurt (de GET-stand) plus een nieuw record.
            status, _, _ = req(app, 'POST', f'/api/data/{key}', body=[b, a, {'id': 2}])
            assert status == 200
            # Eén variant weglaten of er een derde naast zetten mag niet.
            assert not srv._append_only_ok(key, [a, {'id': 2}])
            assert not srv._append_only_ok(key, [b, a, {'id': 1, 'oordeel': 'x'}, {'id': 2}])
        finally:
            self._reset(key)


class TestLotcodeUniek:
    """Eén lotcode hoort bij één afvulsessie (HACCP-handboek §11.1). Twee
    apparaten met een verouderde stand kozen allebei L2431-B1, en de
    conflict-samenvoeging van de client nam beide records over: een recall op
    de fust-sessie raakte dan ook alle flessen. De server weigert zo'n
    schrijfactie in elke schrijfweg."""

    s1 = {'id': 1, 'batch_id': 7, 'sessie_nr': 1, 'lotcode': 'L2431-B1', 'status': 'open'}
    s2 = {'id': 2, 'batch_id': 7, 'sessie_nr': 1, 'lotcode': 'L2431-B1', 'status': 'open'}

    @staticmethod
    def _reset():
        conn = srv._db()
        with conn:
            for key in ('afvul_sessies', 'batch_notities'):
                conn.execute('DELETE FROM records WHERE key=?', (key,))
                conn.execute('DELETE FROM versies WHERE key=?', (key,))

    def _versie(self, app):
        return req(app, 'GET', '/api/data/afvul_sessies')[2].get('X-Data-Version')

    def test_helper_telt_alleen_nieuw_ontstane_dubbelen(self):
        assert srv._lotcode_dubbel([], [{'lotcode': 'L1-B1'}, {'lotcode': ' l1-b1'}]) == ['L1-B1']
        # Een dubbel die er al stond, blijft niet steken.
        oud = [{'lotcode': 'L1-B1'}, {'lotcode': 'L1-B1'}]
        assert srv._lotcode_dubbel(oud, oud + [{'lotcode': 'L1-B2'}]) == []
        # Lege codes en rommel tellen niet.
        assert srv._lotcode_dubbel([], [{'lotcode': ''}, {}, {'lotcode': None}, 'x']) == []
        assert srv._lotcode_guard_fout('batches', [self.s1, self.s2], []) is None

    def test_tweede_sessie_met_zelfde_lotcode_via_data(self, app):
        self._reset()
        try:
            assert req(app, 'POST', '/api/data/afvul_sessies', body=[self.s1])[0] == 200
            status, body, _ = req(app, 'POST', '/api/data/afvul_sessies', body=[self.s1, self.s2])
            assert status == 422
            assert body['reden'] == 'lotcode_dubbel' and body['lotcodes'] == ['L2431-B1']
            assert req(app, 'GET', '/api/data/afvul_sessies')[1] == [self.s1]
            # Met het volgende sessienummer gaat het wel.
            s2b = {**self.s2, 'sessie_nr': 2, 'lotcode': 'L2431-B2'}
            assert req(app, 'POST', '/api/data/afvul_sessies', body=[self.s1, s2b])[0] == 200
        finally:
            self._reset()

    def test_tweede_sessie_met_zelfde_lotcode_via_delta(self, app):
        self._reset()
        try:
            assert req(app, 'POST', '/api/data/afvul_sessies', body=[self.s1])[0] == 200
            status, body, _ = req(app, 'POST', '/api/delta/afvul_sessies',
                                  body={'upsert': [self.s2], 'delete': []},
                                  headers={'X-Data-Version': self._versie(app)})
            assert status == 422 and body['reden'] == 'lotcode_dubbel'
            assert req(app, 'GET', '/api/data/afvul_sessies')[1] == [self.s1]
        finally:
            self._reset()

    def test_commit_met_dubbele_lotcode_schrijft_niets(self, app):
        self._reset()
        try:
            assert req(app, 'POST', '/api/data/afvul_sessies', body=[self.s1])[0] == 200
            status, body, _ = req(app, 'POST', '/api/commit', body={
                'data': {'afvul_sessies': [self.s1, self.s2],
                         'batch_notities': [{'id': 1, 'tekst': 'mag niet landen'}]},
            })
            assert status == 422 and body['key'] == 'afvul_sessies'
            assert req(app, 'GET', '/api/data/afvul_sessies')[1] == [self.s1]
            assert req(app, 'GET', '/api/data/batch_notities')[0] == 404
        finally:
            self._reset()

    def test_bestaande_dubbel_blokkeert_afsluiten_niet(self, app):
        """Een dubbele code van vóór deze controle mag een andere sessie niet
        vastzetten: afsluiten (status + eindtijd) moet altijd kunnen."""
        self._reset()
        try:
            s3 = {'id': 3, 'batch_id': 8, 'sessie_nr': 1, 'lotcode': 'L2432-B1', 'status': 'open'}
            srv._write_json('afvul_sessies', [self.s1, self.s2, s3])
            dicht = {**s3, 'status': 'afgesloten', 'eind': '2026-09-25T12:00:00Z'}
            assert req(app, 'POST', '/api/data/afvul_sessies',
                       body=[self.s1, self.s2, dicht])[0] == 200
            ook_dicht = {**self.s1, 'status': 'afgesloten'}
            status, _, _ = req(app, 'POST', '/api/delta/afvul_sessies',
                               body={'upsert': [ook_dicht], 'delete': []},
                               headers={'X-Data-Version': self._versie(app)})
            assert status == 200
            # Een dérde sessie met die code is wél nieuw en wordt geweigerd.
            s4 = {**self.s2, 'id': 4}
            status, _, _ = req(app, 'POST', '/api/delta/afvul_sessies',
                               body={'upsert': [s4], 'delete': []},
                               headers={'X-Data-Version': self._versie(app)})
            assert status == 422
        finally:
            self._reset()


class TestBijlagen:
    """Bijlagen bij een geboekte factuur vallen onder de bewaarplicht."""

    def test_upload_overschrijft_geen_bestaande_bijlage(self, app):
        import base64
        eerste = base64.b64encode(b'factuur A').decode()
        tweede = base64.b64encode(b'factuur B').decode()
        assert req(app, 'POST', '/api/upload/bon.pdf', body={'data': eerste})[0] == 200
        status, body, _ = req(app, 'POST', '/api/upload/bon.pdf', body={'data': tweede})
        assert status == 200
        assert body['bestand'] == 'bon-1.pdf'          # uitgeweken naar een vrije naam
        assert (srv.UPLOAD_DIR / 'bon.pdf').read_bytes() == b'factuur A'
        assert (srv.UPLOAD_DIR / 'bon-1.pdf').read_bytes() == b'factuur B'

    def test_bijlage_van_een_geboekte_factuur_gaat_niet_weg(self, app):
        import base64
        req(app, 'POST', '/api/upload/bewijs.pdf', body={'data': base64.b64encode(b'x').decode()})
        req(app, 'POST', '/api/data/inkoop_facturen',
            body=[{'id': 1, 'leverancier': 'Mouterij', 'bijlage': {'naam': 'bon.pdf', 'bestand': 'bewijs.pdf'}}])
        status, body, _ = req(app, 'POST', '/api/delete_upload/bewijs.pdf', body={})
        assert status == 409 and body['key'] == 'inkoop_facturen'
        assert (srv.UPLOAD_DIR / 'bewijs.pdf').exists()
        # losgekoppeld van de factuur mag hij wél weg
        req(app, 'POST', '/api/data/inkoop_facturen', body=[{'id': 1, 'leverancier': 'Mouterij'}])
        assert req(app, 'POST', '/api/delete_upload/bewijs.pdf', body={})[0] == 200
        assert not (srv.UPLOAD_DIR / 'bewijs.pdf').exists()


class TestHealth:
    def test_health_zonder_threads(self, app):
        status, body, _ = req(app, 'GET', '/api/health')
        assert status == 200
        # Onder pytest zijn de achtergrondthreads niet gestart
        assert body['threads'] is None
        assert body['data_dir'] is True
        assert body['ok'] is True
        assert isinstance(body['uptime_s'], int)

    def test_health_rapporteert_laatste_backup(self, app):
        # Geen hardcoded recente datums: de server maakt bij het starten zelf
        # een backupmap met de datum van vandaag, die lexicografisch wint van
        # elke testdatum in het verleden. Een ver-toekomstige datum sorteert
        # gegarandeerd als nieuwste — zo is de test datum-onafhankelijk.
        (srv.BACKUP_DIR / '2026-07-15').mkdir(exist_ok=True)
        (srv.BACKUP_DIR / '2099-12-31').mkdir(exist_ok=True)
        status, body, _ = req(app, 'GET', '/api/health')
        assert status == 200
        assert body['laatste_backup'] == '2099-12-31'

    def test_health_rapporteert_dode_thread(self, app):
        import threading as _t
        dood = _t.Thread(target=lambda: None)
        dood.start(); dood.join()
        srv._threads['backup'] = dood
        try:
            _, body, _ = req(app, 'GET', '/api/health')
            assert body['threads'] == {'backup': False}
            assert body['ok'] is False
        finally:
            srv._threads.clear()


class TestDelta:
    """Delta-sync per record (ERP-plan 4.3): POST /api/delta/<key>."""

    def _seed(self, app, key, records):
        status, body, _ = req(app, 'POST', f'/api/data/{key}', body=records)
        assert status == 200
        return body['version']

    def test_upsert_delete_en_volgorde(self, app):
        ver = self._seed(app, 'haccp_capa', [
            {'id': 1, 'n': 'a'}, {'id': 2, 'n': 'b'}, {'id': 3, 'n': 'c'}])
        status, body, _ = req(app, 'POST', '/api/delta/haccp_capa',
                              body={'upsert': [{'id': 2, 'n': 'B'}, {'id': 4, 'n': 'd'}],
                                    'delete': [1]},
                              headers={'X-Data-Version': ver})
        assert status == 200 and body['records'] == 3
        status, data, headers = req(app, 'GET', '/api/data/haccp_capa')
        # Update behoudt positie, nieuw record komt achteraan
        assert data == [{'id': 2, 'n': 'B'}, {'id': 3, 'n': 'c'}, {'id': 4, 'n': 'd'}]
        # Nieuwe versie is consistent met wat GET serveert
        assert headers['X-Data-Version'] == body['version']

    def test_verouderde_versie_geeft_409(self, app):
        ver = self._seed(app, 'koel_logs', [{'id': 1}])
        req(app, 'POST', '/api/delta/koel_logs',
            body={'upsert': [{'id': 2}], 'delete': []}, headers={'X-Data-Version': ver})
        status, _, _ = req(app, 'POST', '/api/delta/koel_logs',
                           body={'upsert': [], 'delete': [1]}, headers={'X-Data-Version': ver})
        assert status == 409
        assert req(app, 'GET', '/api/data/koel_logs')[1] == [{'id': 1}, {'id': 2}]

    def test_fallback_signalen_400_en_404(self, app):
        # Zonder X-Data-Version → 400 (client valt terug op volledige POST)
        self._seed(app, 'dry_hops', [{'id': 1}])
        ver = req(app, 'GET', '/api/data/dry_hops')[2]['X-Data-Version']
        assert req(app, 'POST', '/api/delta/dry_hops',
                   body={'upsert': [], 'delete': []})[0] == 400
        # Onbekende key of geen array → 404
        assert req(app, 'POST', '/api/delta/bestaat_niet_delta',
                   body={'upsert': [], 'delete': []},
                   headers={'X-Data-Version': '0'})[0] == 404
        # Record zonder id → 400
        assert req(app, 'POST', '/api/delta/dry_hops',
                   body={'upsert': [{'zonder': 'id'}], 'delete': []},
                   headers={'X-Data-Version': ver})[0] == 400

    def test_append_only_via_delta(self, app):
        srv._write_json('journaal', [{'id': 10, 'netto_cent': 1}])
        ver = req(app, 'GET', '/api/data/journaal')[2]['X-Data-Version']
        # Aanvullen met een nieuw record mag
        status, body, _ = req(app, 'POST', '/api/delta/journaal',
                              body={'upsert': [{'id': 11, 'netto_cent': 2}], 'delete': []},
                              headers={'X-Data-Version': ver})
        assert status == 200
        # Bestaand record wijzigen of verwijderen → 400 (volledige POST geeft het canonieke 422)
        ver = body['version']
        assert req(app, 'POST', '/api/delta/journaal',
                   body={'upsert': [{'id': 10, 'netto_cent': 999}], 'delete': []},
                   headers={'X-Data-Version': ver})[0] == 400
        assert req(app, 'POST', '/api/delta/journaal',
                   body={'upsert': [], 'delete': [10]},
                   headers={'X-Data-Version': ver})[0] == 400

    def test_delta_respecteert_rollen(self, app):
        ver = self._seed(app, 'verkoop_facturen', [])
        status, _, _ = req(app, 'POST', '/api/data/gebruikers_rollen',
                           body={'gebruikers': {'piet': 'productie'}},
                           headers={'X-Remote-User-Name': 'admin'})
        assert status == 200
        try:
            status, body, _ = req(app, 'POST', '/api/delta/verkoop_facturen',
                                  body={'upsert': [{'id': 1}], 'delete': []},
                                  headers={'X-Data-Version': ver,
                                           'X-Remote-User-Name': 'piet'})
            assert status == 403 and body['reden'] == 'rol'
        finally:
            assert req(app, 'POST', '/api/data/gebruikers_rollen', body={},
                       headers={'X-Remote-User-Name': 'admin'})[0] == 200


class TestRollen:
    """Gebruikers & rollen (ERP-plan 4.2): server-side afdwinging per rol."""

    ADMIN = {'X-Remote-User-Name': 'admin'}
    CONFIG = {'gebruikers': {'admin': 'beheer', 'kees': 'alleen_lezen',
                             'piet': 'productie', 'fien': 'boekhouding'}}

    def _zet_config(self, app, config=None):
        status, _, _ = req(app, 'POST', '/api/data/gebruikers_rollen',
                           body=self.CONFIG if config is None else config,
                           headers=self.ADMIN)
        return status

    def _reset(self, app):
        assert req(app, 'POST', '/api/data/gebruikers_rollen', body={},
                   headers=self.ADMIN)[0] == 200

    def test_rol_helpers(self):
        assert srv._rol_mag_key('beheer', 'smtp_creds')
        assert srv._rol_mag_key('boekhouding', 'verkoop_facturen')
        assert not srv._rol_mag_key('boekhouding', 'smtp_creds')
        assert not srv._rol_mag_key('productie', 'verkoop_facturen')
        assert srv._rol_mag_key('productie', 'batches')
        assert srv._rol_mag_key('boekhouding', 'batches')  # gedeelde key
        assert not srv._rol_mag_key('alleen_lezen', 'batches')
        # Configvalidatie: typfout in rol mag nooit stil doorglippen
        assert srv._rollen_config_geldig({'gebruikers': {'x': 'beheer'}})
        assert not srv._rollen_config_geldig({'gebruikers': {'x': 'admin'}})
        assert not srv._rollen_config_geldig({'standaard_rol': 'root'})
        assert not srv._rollen_config_geldig([])
        # Lockout: schrijver moet zelf beheer houden
        assert srv._rollen_lockout('admin', {'standaard_rol': 'alleen_lezen'})
        assert not srv._rollen_lockout('admin', {'gebruikers': {'admin': 'beheer'},
                                                 'standaard_rol': 'alleen_lezen'})
        assert not srv._rollen_lockout('', {'standaard_rol': 'alleen_lezen'})
        # Namen hoofdletterongevoelig, zoals HA ze vergelijkt
        assert not srv._rollen_lockout('Admin', {'gebruikers': {'admin': 'beheer'},
                                                 'standaard_rol': 'alleen_lezen'})
        assert srv._rollen_lockout('ADMIN', {'gebruikers': {'admin': 'productie'}})
        # Twee schrijfwijzen van één naam zijn dubbelzinnig → ongeldig
        assert not srv._rollen_config_geldig({'gebruikers': {'jan': 'productie',
                                                             'Jan': 'beheer'}})
        assert srv._rol_uit_tabel({'Jan': 'productie'}, 'jan') == 'productie'
        assert srv._rol_uit_tabel({'Jan': 'productie', 'JAN': 'beheer'}, 'jan') == 'alleen_lezen'
        assert srv._rol_uit_tabel({'Jan': 'productie', 'JAN': 'beheer'}, 'JAN') == 'beheer'
        assert srv._rol_uit_tabel({'jan': 'productie'}, 'piet') is None

    def test_app_kent_dezelfde_rolsleutels(self):
        # De app slaat automatische schrijfacties (Brewfather-sync, klant-
        # koppeling, login-auditregel) over voor een rol die ze niet mag —
        # met een spiegel van deze lijsten in src/utils/rollen.ts. Lopen ze
        # uit elkaar, dan krijgt een gebruiker weer 'geen rechten'-meldingen.
        bron = (Path(__file__).resolve().parent.parent
                / 'src' / 'utils' / 'rollen.ts').read_text(encoding='utf-8')

        def lijst(naam):
            blok = bron.split(f'export const {naam}')[1].split('= [', 1)[1].split(']')[0]
            return set(re.findall(r"'(\w+)'", blok))
        assert lijst('BEHEER_KEYS') == set(srv._BEHEER_KEYS)
        assert lijst('FINANCIELE_KEYS') == set(srv._FINANCIELE_KEYS)

    def test_zonder_config_is_iedereen_beheer(self, app):
        status, body, _ = req(app, 'GET', '/api/whoami',
                              headers={'X-Remote-User-Name': 'wildvreemde'})
        assert status == 200
        assert body == {'gebruiker': 'wildvreemde', 'rol': 'beheer', 'sessie': False}

    def test_whoami_en_afdwinging_per_rol(self, app):
        assert self._zet_config(app) == 200
        try:
            # whoami rapporteert de toegewezen rol
            _, body, _ = req(app, 'GET', '/api/whoami',
                             headers={'X-Remote-User-Name': 'kees'})
            assert body == {'gebruiker': 'kees', 'rol': 'alleen_lezen', 'sessie': False}
            # Andere schrijfwijze = zelfde HA-account = zelfde rol (geen
            # terugval op de standaardrol beheer)
            _, body, _ = req(app, 'GET', '/api/whoami',
                             headers={'X-Remote-User-Name': 'KEES'})
            assert body['rol'] == 'alleen_lezen'
            # alleen_lezen: GET ok, elke POST 403
            assert req(app, 'GET', '/api/data/batches',
                       headers={'X-Remote-User-Name': 'kees'})[0] in (200, 404)
            status, body, _ = req(app, 'POST', '/api/data/water_addities', body=[],
                                  headers={'X-Remote-User-Name': 'kees'})
            assert status == 403 and body['reden'] == 'rol'
            # productie: gedeelde key ok, financiële key en nextnr 403
            piet = {'X-Remote-User-Name': 'piet'}
            assert req(app, 'POST', '/api/data/water_addities', body=[],
                       headers=piet)[0] == 200
            # De brouwer vult de CCP-registraties zelf in, maar de kritische
            # grenzen erachter zijn beleid en dus beheer-only.
            assert req(app, 'POST', '/api/data/afvul_sessies', body=[],
                       headers=piet)[0] == 200
            status, body, _ = req(app, 'POST', '/api/data/haccp_instellingen',
                                  body={'ff_marge_sg': 0.05}, headers=piet)
            assert status == 403 and body['reden'] == 'rol'
            assert req(app, 'POST', '/api/data/verkoop_facturen', body=[],
                       headers=piet)[0] == 403
            assert req(app, 'POST', '/api/nextnr',
                       body={'reeks': 'factuur', 'jaar': 2026}, headers=piet)[0] == 403
            # ... maar een bestelnummer (handmatige bestelling) en de bijlagen
            # bij een afboeking/vernietiging (Douane §7.2.3) mag productie wél
            assert req(app, 'POST', '/api/nextnr',
                       body={'reeks': 'bestelling', 'jaar': 2026}, headers=piet)[0] == 200
            pdf = {'data': base64.b64encode(b'%PDF-1.4 verklaring').decode()}
            status, body, _ = req(app, 'POST', '/api/upload/verlies_rol_1.pdf',
                                  body=pdf, headers=piet)
            assert status == 200
            assert req(app, 'POST', '/api/delete_upload/' + body['bestand'],
                       body={}, headers=piet)[0] == 200
            status, body, _ = req(app, 'POST', '/api/upload/afboek_rol_1.pdf',
                                  body=pdf, headers=piet)
            assert status == 200
            # Factuurbijlagen blijven bij boekhouding
            status, body, _ = req(app, 'POST', '/api/upload/123_factuur.pdf',
                                  body=pdf, headers=piet)
            assert status == 403 and body['reden'] == 'rol'
            (srv.UPLOAD_DIR / 'ontvangst_rol.pdf').write_bytes(b'x')
            assert req(app, 'POST', '/api/delete_upload/ontvangst_rol.pdf',
                       body={}, headers=piet)[0] == 403
            assert (srv.UPLOAD_DIR / 'ontvangst_rol.pdf').exists()
            # boekhouding: financiële key ok, beheer-key en mail-test 403
            fien = {'X-Remote-User-Name': 'fien'}
            assert req(app, 'POST', '/api/data/verkoop_facturen', body=[],
                       headers=fien)[0] == 200
            assert req(app, 'POST', '/api/data/smtp_creds', body={'host': 'x'},
                       headers=fien)[0] == 403
            assert req(app, 'POST', '/api/mail/test', body={'host': 'x', 'port': 25},
                       headers=fien)[0] == 403
            # backup-download is beheer-only
            assert req(app, 'GET', '/api/backups', headers=fien)[0] == 403
            assert req(app, 'GET', '/api/backups', headers=self.ADMIN)[0] == 200
            # ... en één sleutel terugzetten uit een backup ook
            status, body, _ = req(app, 'POST', '/api/backups/restore',
                                  body={'date': '2026-01-01', 'key': 'producten'}, headers=fien)
            assert status == 403 and body['reden'] == 'rol'
        finally:
            self._reset(app)

    def test_commit_weigert_verboden_key_integraal(self, app):
        assert self._zet_config(app) == 200
        try:
            piet = {'X-Remote-User-Name': 'piet'}
            status, body, _ = req(app, 'POST', '/api/commit', body={
                'data': {'water_addities': [{'id': 1}], 'verkoop_facturen': []},
            }, headers=piet)
            assert status == 403 and body['key'] == 'verkoop_facturen'
            # Niets geschreven — ook de toegestane key niet
            assert req(app, 'GET', '/api/data/water_addities')[1] == []
        finally:
            self._reset(app)

    def test_rollenbeheer_zelf_alleen_beheer_en_lockout_guard(self, app):
        assert self._zet_config(app) == 200
        try:
            # Niet-beheer mag de rollen niet wijzigen
            assert req(app, 'POST', '/api/data/gebruikers_rollen', body={},
                       headers={'X-Remote-User-Name': 'fien'})[0] == 403
            # Ongeldige rolwaarde → 422
            assert self._zet_config(app, {'gebruikers': {'admin': 'root'}}) == 422
            # Beheerder kan zichzelf niet uit beheer zetten → 422
            status, body, _ = req(app, 'POST', '/api/data/gebruikers_rollen',
                                  body={'gebruikers': {'admin': 'productie'}},
                                  headers=self.ADMIN)
            assert status == 422 and body['error'] == 'rollen-lockout'
            # Standaardrol geldt voor niet-vermelde gebruikers
            assert self._zet_config(app, {'gebruikers': {'admin': 'beheer'},
                                          'standaard_rol': 'alleen_lezen'}) == 200
            assert req(app, 'POST', '/api/data/water_addities', body=[],
                       headers={'X-Remote-User-Name': 'onbekend'})[0] == 403
        finally:
            self._reset(app)

    def test_restore_rollen_respecteert_lockout(self, app):
        """/api/backups/restore schreef gebruikers_rollen terug zonder de
        rollenvalidatie en de lockout-guard van /api/data: een beheerder kon
        zichzelf zo uit beheer zetten, zonder weg terug in de app."""
        jan = {'X-Remote-User-Name': 'jan'}
        assert self._zet_config(app, {'gebruikers': {'admin': 'beheer', 'jan': 'beheer'}}) == 200
        # Stand in de backup: admin is (door jan) productie gemaakt
        assert req(app, 'POST', '/api/data/gebruikers_rollen',
                   body={'gebruikers': {'admin': 'productie', 'jan': 'beheer'}},
                   headers=jan)[0] == 200
        status, body, _ = req(app, 'POST', '/api/backups/trigger', body={}, headers=jan)
        assert status == 200
        datum = body['date']
        try:
            huidig = {'gebruikers': {'admin': 'beheer', 'jan': 'beheer'}}
            assert req(app, 'POST', '/api/data/gebruikers_rollen', body=huidig,
                       headers=jan)[0] == 200
            status, body, _ = req(app, 'POST', '/api/backups/restore',
                                  body={'date': datum, 'key': 'gebruikers_rollen'},
                                  headers=self.ADMIN)
            assert status == 422 and body['error'] == 'rollen-lockout'
            assert req(app, 'GET', '/api/data/gebruikers_rollen')[1] == huidig
            assert req(app, 'GET', '/api/whoami', headers=self.ADMIN)[1]['rol'] == 'beheer'
            # Wie in die backup zelf beheer houdt, kan hem gewoon terugzetten
            status, body, _ = req(app, 'POST', '/api/backups/restore',
                                  body={'date': datum, 'key': 'gebruikers_rollen'},
                                  headers=jan)
            assert status == 200 and body['ok']
            assert req(app, 'GET', '/api/whoami', headers=self.ADMIN)[1]['rol'] == 'productie'
        finally:
            # Zonder ingress-gebruiker (buiten HA) is er geen lockout-risico
            assert req(app, 'POST', '/api/data/gebruikers_rollen', body={})[0] == 200


class TestDirectLogin:
    """Directe-toegangspoort: HA-login met sessiecookie i.p.v. ingress."""

    def _login(self, app_direct, gebruiker='jasper', wachtwoord='geheim'):
        """Log in met gemockte HA-auth; geeft (status, cookie-header) terug."""
        status, _, headers = req(app_direct, 'POST', '/api/login',
                                 body={'username': gebruiker, 'password': wachtwoord})
        set_cookie = headers.get('Set-Cookie', '')
        return status, set_cookie.split(';')[0] if set_cookie else ''

    def _met_mock_auth(self, uitkomst_fout='ongeldig'):
        """Contextmanager-achtige setup: SUPERVISOR_TOKEN + gemockte auth."""
        import os as _os
        echt = srv._ha_auth_check
        srv._ha_auth_check = (lambda u, w:
                              'ok' if (u, w) == ('jasper', 'geheim') else uitkomst_fout)
        _os.environ['SUPERVISOR_TOKEN'] = 'testtoken'
        def herstel():
            srv._ha_auth_check = echt
            _os.environ.pop('SUPERVISOR_TOKEN', None)
            srv._login_pogingen.clear()
        return herstel

    def test_zonder_sessie_loginpagina_en_401(self, app_direct):
        with urllib.request.urlopen(app_direct + '/') as r:
            assert r.status == 200
            assert 'text/html' in r.headers.get('Content-Type', '')
            assert 'Inloggen' in r.read().decode('utf-8')
        assert req(app_direct, 'GET', '/api/data/batches')[0] == 401
        assert req(app_direct, 'POST', '/api/data/batches', body=[])[0] == 401

    def test_login_zonder_supervisor_geeft_503(self, app_direct):
        srv._login_pogingen.clear()
        status, _, _ = req(app_direct, 'POST', '/api/login',
                           body={'username': 'x', 'password': 'y'})
        assert status == 503

    def test_login_sessie_rollen_en_logout(self, app_direct, app):
        herstel = self._met_mock_auth()
        try:
            # Fout wachtwoord → 401, goed → 200 met cookie
            assert self._login(app_direct, wachtwoord='fout')[0] == 401
            status, cookie = self._login(app_direct)
            assert status == 200 and cookie.startswith(srv.SESSIE_COOKIE + '=')
            # Met sessie werkt de API; whoami meldt de sessiegebruiker
            assert req(app_direct, 'GET', '/api/data/hop_addities',
                       headers={'Cookie': cookie})[0] in (200, 404)
            status, wie, _ = req(app_direct, 'GET', '/api/whoami',
                                 headers={'Cookie': cookie})
            assert wie == {'gebruiker': 'jasper', 'rol': 'beheer', 'sessie': True}
            # Header-spoofing wordt op deze poort genegeerd
            _, wie2, _ = req(app_direct, 'GET', '/api/whoami',
                             headers={'Cookie': cookie, 'X-Remote-User-Name': 'hacker'})
            assert wie2['gebruiker'] == 'jasper'
            # Rollen gelden ook voor sessiegebruikers
            assert req(app, 'POST', '/api/data/gebruikers_rollen',
                       body={'gebruikers': {'jasper': 'productie'}})[0] == 200
            try:
                status, body, _ = req(app_direct, 'POST', '/api/data/verkoop_facturen',
                                      body=[], headers={'Cookie': cookie})
                assert status == 403 and body['reden'] == 'rol'
            finally:
                assert req(app, 'POST', '/api/data/gebruikers_rollen', body={})[0] == 200
            # Uitloggen beëindigt de sessie
            assert req(app_direct, 'POST', '/api/logout',
                       headers={'Cookie': cookie})[0] == 200
            assert req(app_direct, 'GET', '/api/whoami',
                       headers={'Cookie': cookie})[0] == 401
        finally:
            herstel()

    def test_auth_backend_fout_geeft_502_geen_401(self, app_direct):
        # auth_api niet actief (Supervisor 403) → 502 met detail, duidelijk
        # te onderscheiden van verkeerde credentials; telt niet mee voor de
        # brute-force-limiet.
        herstel = self._met_mock_auth(uitkomst_fout='geweigerd')
        try:
            status, body, _ = req(app_direct, 'POST', '/api/login',
                                  body={'username': 'jasper', 'password': 'fout'})
            assert status == 502 and body['detail'] == 'geweigerd'
            assert not srv._login_pogingen.get('127.0.0.1')
        finally:
            herstel()

    def test_login_rate_limit(self, app_direct):
        herstel = self._met_mock_auth()
        try:
            for _ in range(srv._LOGIN_RATE_MAX):
                assert self._login(app_direct, wachtwoord='fout')[0] == 401
            status, _, headers = req(app_direct, 'POST', '/api/login',
                                     body={'username': 'jasper', 'password': 'fout'})
            assert status == 429
            assert int(headers.get('Retry-After', '0')) >= 1
        finally:
            herstel()

    def test_gelijktijdige_pogingen_tellen_meteen_mee(self, app_direct):
        """De limiet telde alleen afgeronde mislukkingen: een burst
        gelijktijdige pogingen kwam helemaal langs de controle voordat de
        (trage) wachtwoordcontrole er één had afgewezen."""
        from concurrent.futures import ThreadPoolExecutor
        herstel = self._met_mock_auth()
        aanroepen = []
        teller_lock = threading.Lock()

        def trage_auth(u, w):
            with teller_lock:
                aanroepen.append(u)
            time.sleep(0.2)
            return 'ongeldig'
        srv._ha_auth_check = trage_auth
        srv._login_pogingen.clear()
        try:
            def poging(_):
                return req(app_direct, 'POST', '/api/login',
                           body={'username': 'jasper', 'password': 'fout'})[0]
            with ThreadPoolExecutor(max_workers=30) as pool:
                statussen = list(pool.map(poging, range(30)))
            assert len(aanroepen) <= srv._LOGIN_RATE_MAX
            assert statussen.count(401) == len(aanroepen)
            assert statussen.count(429) == 30 - len(aanroepen)
        finally:
            herstel()

    def test_login_hoofdletterongevoelig_houdt_eigen_rol(self, app_direct, app):
        """HA vergelijkt gebruikersnamen met strip + casefold: 'Jasper' logt
        in op het account 'jasper'. Die sessie hoort bij 'jasper' en krijgt
        diens rol — niet de standaardrol (beheer) van een onbekende naam."""
        herstel = self._met_mock_auth()
        srv._ha_auth_check = (lambda u, w: 'ok'
                              if (u.strip().casefold(), w) == ('jasper', 'geheim')
                              else 'ongeldig')
        assert req(app, 'POST', '/api/data/gebruikers_rollen',
                   body={'gebruikers': {'jasper': 'productie'}})[0] == 200
        try:
            for schrijfwijze in ('Jasper', 'JASPER'):
                status, cookie = self._login(app_direct, gebruiker=schrijfwijze)
                assert status == 200
                _, wie, _ = req(app_direct, 'GET', '/api/whoami',
                                headers={'Cookie': cookie})
                assert wie == {'gebruiker': 'jasper', 'rol': 'productie', 'sessie': True}
                assert req(app_direct, 'POST', '/api/data/verkoop_facturen', body=[],
                           headers={'Cookie': cookie})[0] == 403
                assert req(app_direct, 'POST', '/api/data/gebruikers_rollen', body={},
                           headers={'Cookie': cookie})[0] == 403
                req(app_direct, 'POST', '/api/logout', headers={'Cookie': cookie})
        finally:
            assert req(app, 'POST', '/api/data/gebruikers_rollen', body={})[0] == 200
            herstel()

    def test_loginpagina_styling_en_escaping(self, app_direct, app):
        # Styling uit login_instellingen wordt toegepast; teksten worden
        # ge-escaped en ongeldige kleuren vallen terug op de default —
        # dit is een pre-auth-pagina, dus injectie mag nooit kunnen.
        logo = 'data:image/png;base64,' + base64.b64encode(b'fake-png').decode()
        assert req(app, 'POST', '/api/data/app_logo', body=logo)[0] == 200
        assert req(app, 'POST', '/api/data/login_instellingen', body={
            'titel': 'Brouwerij <script>alert(1)</script>',
            'ondertitel': 'Welkom!', 'knop_tekst': 'Ga verder',
            'accent': '#336699', 'achtergrond': 'javascript:evil',
            'achtergrond_afbeelding': 'https://kwaadaardig/x.png',
        })[0] == 200
        try:
            with urllib.request.urlopen(app_direct + '/') as r:
                pagina = r.read().decode('utf-8')
            assert 'Brouwerij &lt;script&gt;alert(1)&lt;/script&gt;' in pagina
            assert '<script>alert(1)' not in pagina
            assert 'Welkom!' in pagina and 'Ga verder' in pagina
            assert '#336699' in pagina
            # Ongeldige achtergrondkleur → default; externe URL nooit in de CSS
            assert '#1c1917' in pagina and 'javascript:evil' not in pagina
            assert 'kwaadaardig' not in pagina
            # Geldig app-logo (data-url) wordt getoond
            assert f'<img src="{logo}"' in pagina
            # logo_tonen: false verbergt het logo
            req(app, 'POST', '/api/data/login_instellingen', body={'logo_tonen': False})
            with urllib.request.urlopen(app_direct + '/') as r:
                assert '<img src=' not in r.read().decode('utf-8')
        finally:
            req(app, 'POST', '/api/data/login_instellingen', body={})
            req(app, 'POST', '/api/data/app_logo', body=b'null')

    def test_ingress_poort_kent_geen_login_endpoint(self, app):
        # Op de gewone poort bestaat de loginflow niet (valt door naar 404
        # via de normale routing) en blijft alles header-gebaseerd werken.
        status, _, _ = req(app, 'POST', '/api/login',
                           body={'username': 'x', 'password': 'y'})
        assert status == 404


class TestHaGebruikers:
    """HA-gebruikerslijst via de core-websocket (stdlib RFC6455-client)."""

    GEBRUIKERS = [
        {'id': '1', 'name': 'Jasper Bom', 'username': 'jasper', 'is_owner': True,
         'is_active': True, 'system_generated': False},
        {'id': '2', 'name': 'Kees', 'username': None, 'is_owner': False,
         'is_active': True, 'system_generated': False},
        {'id': '3', 'name': 'Supervisor', 'username': None, 'is_owner': False,
         'is_active': True, 'system_generated': True},
        {'id': '4', 'name': 'Oud', 'username': 'oud', 'is_owner': False,
         'is_active': False, 'system_generated': False},
    ]

    @staticmethod
    def _ws_stuur(conn, obj):
        payload = json.dumps(obj).encode()
        # server→client: ongemaskeerd; extended length voor payloads ≥126
        if len(payload) < 126:
            kop = bytes([0x81, len(payload)])
        else:
            kop = bytes([0x81, 126]) + len(payload).to_bytes(2, 'big')
        conn.sendall(kop + payload)

    @staticmethod
    def _ws_lees(conn):
        def lees(n):
            data = b''
            while len(data) < n:
                chunk = conn.recv(n - len(data))
                if not chunk:
                    raise OSError('dicht')
                data += chunk
            return data
        b1, b2 = lees(2)
        lengte = b2 & 0x7F
        if lengte == 126:
            lengte = int.from_bytes(lees(2), 'big')
        masker = lees(4) if b2 & 0x80 else b''
        payload = lees(lengte)
        if masker:
            payload = bytes(x ^ masker[i % 4] for i, x in enumerate(payload))
        return json.loads(payload)

    @pytest.fixture()
    def fake_core_ws(self):
        """Nep-Supervisor-core-websocket: handshake, auth-flow en één
        config/auth/list-antwoord."""
        import hashlib as _hashlib
        import socket as _socket
        GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
        server = _socket.socket()
        server.bind(('127.0.0.1', 0))
        server.listen(1)
        poort = server.getsockname()[1]
        gezien = {}

        def draai():
            conn, _ = server.accept()
            with conn:
                buf = b''
                while b'\r\n\r\n' not in buf:
                    buf += conn.recv(4096)
                sleutel = next(r.split(b': ', 1)[1] for r in buf.split(b'\r\n')
                               if r.lower().startswith(b'sec-websocket-key'))
                accept = base64.b64encode(
                    _hashlib.sha1(sleutel + GUID.encode()).digest()).decode()
                conn.sendall((f'HTTP/1.1 101 Switching Protocols\r\n'
                              f'Upgrade: websocket\r\nConnection: Upgrade\r\n'
                              f'Sec-WebSocket-Accept: {accept}\r\n\r\n').encode())
                self._ws_stuur(conn, {'type': 'auth_required'})
                gezien['auth'] = self._ws_lees(conn)
                self._ws_stuur(conn, {'type': 'auth_ok'})
                cmd = self._ws_lees(conn)
                gezien['cmd'] = cmd
                self._ws_stuur(conn, {'id': cmd['id'], 'type': 'result',
                                      'success': True, 'result': self.GEBRUIKERS})

        thread = threading.Thread(target=draai, daemon=True)
        thread.start()
        oud = (srv._CORE_WS_HOST, srv._CORE_WS_POORT)
        srv._CORE_WS_HOST, srv._CORE_WS_POORT = '127.0.0.1', poort
        import os as _os
        _os.environ['SUPERVISOR_TOKEN'] = 'testtoken'
        yield gezien
        srv._CORE_WS_HOST, srv._CORE_WS_POORT = oud
        _os.environ.pop('SUPERVISOR_TOKEN', None)
        server.close()

    def test_ws_frame_masker_round_trip(self):
        payload = json.dumps({'x': 'ünïcode ✓'}).encode()
        frame = srv._ws_frame(payload)
        assert frame[0] == 0x81 and (frame[1] & 0x80)
        lengte = frame[1] & 0x7F
        masker, data = frame[2:6], frame[6:6 + lengte]
        assert bytes(b ^ masker[i % 4] for i, b in enumerate(data)) == payload

    def test_gebruikerslijst_via_fake_core(self, fake_core_ws):
        lijst = srv._ha_gebruikerslijst()
        # Systeem-gebruiker en inactieve gebruiker gefilterd
        assert lijst == [
            {'naam': 'Jasper Bom', 'gebruikersnaam': 'jasper', 'eigenaar': True},
            {'naam': 'Kees', 'gebruikersnaam': '', 'eigenaar': False},
        ]
        assert fake_core_ws['auth']['access_token'] == 'testtoken'
        assert fake_core_ws['cmd']['type'] == 'config/auth/list'

    def test_endpoint_zonder_ha_geeft_503(self, app):
        status, _, _ = req(app, 'GET', '/api/ha_gebruikers')
        assert status == 503

    def test_endpoint_is_beheer_only(self, app):
        assert req(app, 'POST', '/api/data/gebruikers_rollen',
                   body={'gebruikers': {'piet': 'productie'}},
                   headers={'X-Remote-User-Name': 'admin'})[0] == 200
        try:
            status, body, _ = req(app, 'GET', '/api/ha_gebruikers',
                                  headers={'X-Remote-User-Name': 'piet'})
            assert status == 403 and body['reden'] == 'rol'
        finally:
            assert req(app, 'POST', '/api/data/gebruikers_rollen', body={},
                       headers={'X-Remote-User-Name': 'admin'})[0] == 200

    def test_ingress_user_display_name_fallback(self, app):
        _, body, _ = req(app, 'GET', '/api/whoami',
                         headers={'X-Remote-User-Display-Name': 'Jasper Bom'})
        assert body['gebruiker'] == 'Jasper Bom'
        # Gebruikersnaam blijft voorrang houden
        _, body, _ = req(app, 'GET', '/api/whoami',
                         headers={'X-Remote-User-Name': 'jasper',
                                  'X-Remote-User-Display-Name': 'Jasper Bom'})
        assert body['gebruiker'] == 'jasper'


class TestDirectSsl:
    """HTTPS op de directe poort: addon-opties, certvalidatie, handshake."""

    def _maak_cert(self, tmp_path):
        import subprocess
        subprocess.run([
            'openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
            '-keyout', str(tmp_path / 'privkey.pem'),
            '-out', str(tmp_path / 'fullchain.pem'),
            '-days', '1', '-subj', '/CN=brewadmin.test',
        ], check=True, capture_output=True)

    def test_addon_opties_en_migratie_uitzondering(self, app):
        # options.json is van de Supervisor: wél leesbaar via _addon_opties,
        # nooit meegenomen/verplaatst door de JSON-migratie.
        (srv.DATA_DIR / 'options.json').write_text(
            json.dumps({'ssl': True, 'certfile': 'a.pem', 'keyfile': 'b.pem'}))
        try:
            assert srv._addon_opties() == {'ssl': True, 'certfile': 'a.pem', 'keyfile': 'b.pem'}
            conn = srv._db()
            srv._migreer_json_bestanden(conn)
            assert (srv.DATA_DIR / 'options.json').exists()
            assert conn.execute("SELECT 1 FROM versies WHERE key='options'").fetchone() is None
        finally:
            (srv.DATA_DIR / 'options.json').unlink()
        assert srv._addon_opties() == {}

    def test_ssl_context_valideert(self, tmp_path):
        import shutil as _shutil
        if not _shutil.which('openssl'):
            pytest.skip('openssl niet beschikbaar')
        self._maak_cert(tmp_path)
        oud = srv.SSL_DIR
        srv.SSL_DIR = tmp_path
        try:
            assert srv._ssl_context('fullchain.pem', 'privkey.pem') is not None
            # Ontbrekend bestand of padcomponenten → None (fail-closed)
            assert srv._ssl_context('bestaat_niet.pem', 'privkey.pem') is None
            assert srv._ssl_context('../fullchain.pem', 'privkey.pem') is None
            assert srv._ssl_context('', 'privkey.pem') is None
        finally:
            srv.SSL_DIR = oud

    def test_https_handshake_en_loginpagina(self, app, tmp_path):
        import shutil as _shutil
        import ssl as _ssl
        if not _shutil.which('openssl'):
            pytest.skip('openssl niet beschikbaar')
        self._maak_cert(tmp_path)
        oud = srv.SSL_DIR
        srv.SSL_DIR = tmp_path
        try:
            ctx = srv._ssl_context('fullchain.pem', 'privkey.pem')
            assert ctx is not None
            httpd = srv.BrouwerijServer(('127.0.0.1', 0), srv.BrouwerijHandler)
            httpd.brewadmin_direct = True
            httpd.brewadmin_ssl = True
            httpd.tls_context = ctx  # zoals __main__ het doet
            poort = httpd.server_address[1]
            thread = threading.Thread(target=httpd.serve_forever, daemon=True)
            thread.start()
            try:
                client_ctx = _ssl.create_default_context()
                client_ctx.check_hostname = False
                client_ctx.verify_mode = _ssl.CERT_NONE
                with urllib.request.urlopen(f'https://127.0.0.1:{poort}/',
                                            context=client_ctx) as r:
                    assert r.status == 200
                    assert 'Inloggen' in r.read().decode('utf-8')
            finally:
                httpd.shutdown()
        finally:
            srv.SSL_DIR = oud

    def test_stille_verbinding_legt_de_poort_niet_stil(self, app, tmp_path):
        """Een TCP-verbinding die de TLS-handshake nooit afmaakt (stille
        client, telefoon die van netwerk wisselt) hield de accept-lus vast:
        tot die verbinding sloot kon niemand inloggen. De handshake hoort per
        verbinding in de worker te lopen, met een timeout."""
        import shutil as _shutil
        import ssl as _ssl
        if not _shutil.which('openssl'):
            pytest.skip('openssl niet beschikbaar')
        self._maak_cert(tmp_path)
        oud = srv.SSL_DIR
        srv.SSL_DIR = tmp_path
        try:
            ctx = srv._ssl_context('fullchain.pem', 'privkey.pem')
            httpd = srv.BrouwerijServer(('127.0.0.1', 0), srv.BrouwerijHandler)
            httpd.brewadmin_direct = True
            httpd.brewadmin_ssl = True
            httpd.tls_context = ctx
            httpd.tls_handshake_timeout = 1.0
            poort = httpd.server_address[1]
            thread = threading.Thread(target=httpd.serve_forever, daemon=True)
            thread.start()
            stil = socket.create_connection(('127.0.0.1', poort))
            try:
                client_ctx = _ssl.create_default_context()
                client_ctx.check_hostname = False
                client_ctx.verify_mode = _ssl.CERT_NONE
                # Terwijl de stille verbinding openstaat werkt de poort gewoon
                with urllib.request.urlopen(f'https://127.0.0.1:{poort}/',
                                            context=client_ctx, timeout=5) as r:
                    assert r.status == 200
                    assert 'Inloggen' in r.read().decode('utf-8')
                # ... en de server sluit de stille verbinding na de timeout
                stil.settimeout(5)
                try:
                    assert stil.recv(1) == b''
                except ConnectionResetError:
                    pass
            finally:
                stil.close()
                httpd.shutdown()
        finally:
            srv.SSL_DIR = oud


class TestLogging:
    def test_log_schrijft_json_regels(self):
        import io as _io
        import logging as _logging
        buf = _io.StringIO()
        handler = _logging.StreamHandler(buf)
        handler.setFormatter(srv._JsonFormatter())
        srv._logger.addHandler(handler)
        try:
            srv._log('test', 'hallo', extra_veld=42)
            srv._log('test', 'kapot', level=_logging.ERROR)
        finally:
            srv._logger.removeHandler(handler)
        regels = [json.loads(r) for r in buf.getvalue().strip().splitlines()]
        assert regels[0]['msg'] == 'hallo'
        assert regels[0]['bron'] == 'test'
        assert regels[0]['extra_veld'] == 42
        assert regels[0]['level'] == 'info'
        assert 'ts' in regels[0]
        assert regels[1]['level'] == 'error'


class TestSluitcontroleHerinnering:
    """Server-tick die tijdens een open afvulsessie om de halfuurcontrole van
    CCP 2 vraagt, met dedup zolang er geen nieuwe controle is."""

    @staticmethod
    def _iso_min_geleden(minuten):
        dt = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=minuten)
        return dt.isoformat()

    @staticmethod
    def _clean():
        conn = srv._db()
        with conn:
            for key in ('afvul_sessies', 'haccp_sluitcontroles'):
                conn.execute('DELETE FROM records WHERE key=?', (key,))
                conn.execute('DELETE FROM versies WHERE key=?', (key,))
            conn.execute("DELETE FROM kv WHERE key='notificatie_instellingen'")
            conn.execute("DELETE FROM kv WHERE key='haccp_instellingen'")

    def _seed(self, sessies, controles=(), enabled=True):
        srv._write_json('notificatie_instellingen',
                        {'enabled': enabled, 'notify_service': 'mobile_app_test'})
        srv._write_json('afvul_sessies', sessies)
        srv._write_json('haccp_sluitcontroles', list(controles))

    def test_meldt_na_interval_en_dedupt(self, app, monkeypatch):
        calls = []
        monkeypatch.setattr(srv, '_ha_notify', lambda s, t, m: (calls.append((s, t, m)) or True))
        laatste = self._iso_min_geleden(40)
        self._seed(
            [{'id': 1, 'batch_id': 1, 'lotcode': 'L2431-B1', 'status': 'open',
              'start': self._iso_min_geleden(90)}],
            [{'id': 5, 'sessie_id': 1, 'aanleiding': 'start', 'resultaat': 'goedgekeurd',
              'paraaf': {'gebruiker': 'jasper', 'tijdstip': laatste}}])
        try:
            srv._sluitcontrole_tick()
            assert len(calls) == 1
            assert 'L2431-B1' in calls[0][2]
            # Zonder nieuwe controle blijft het bij die ene melding.
            srv._sluitcontrole_tick()
            assert len(calls) == 1
            # Een verse controle geeft de herinnering weer vrij.
            srv._write_json('haccp_sluitcontroles', [
                {'id': 5, 'sessie_id': 1, 'aanleiding': 'start', 'resultaat': 'goedgekeurd',
                 'paraaf': {'gebruiker': 'jasper', 'tijdstip': laatste}},
                {'id': 6, 'sessie_id': 1, 'aanleiding': 'halfuur', 'resultaat': 'goedgekeurd',
                 'paraaf': {'gebruiker': 'jasper', 'tijdstip': self._iso_min_geleden(35)}}])
            srv._sluitcontrole_tick()
            assert len(calls) == 2
        finally:
            self._clean()

    def test_zwijgt_binnen_interval_en_bij_gesloten_sessie(self, app, monkeypatch):
        calls = []
        monkeypatch.setattr(srv, '_ha_notify', lambda s, t, m: (calls.append((s, t, m)) or True))
        self._seed(
            [{'id': 1, 'batch_id': 1, 'lotcode': 'L1-B1', 'status': 'open',
              'start': self._iso_min_geleden(20)},
             {'id': 2, 'batch_id': 2, 'lotcode': 'L2-B1', 'status': 'afgesloten',
              'start': self._iso_min_geleden(500)}])
        try:
            srv._sluitcontrole_tick()
            assert calls == []
        finally:
            self._clean()

    def test_zwijgt_zonder_notify_service(self, app, monkeypatch):
        calls = []
        monkeypatch.setattr(srv, '_ha_notify', lambda s, t, m: (calls.append((s, t, m)) or True))
        self._seed(
            [{'id': 1, 'batch_id': 1, 'lotcode': 'L1-B1', 'status': 'open',
              'start': self._iso_min_geleden(120)}], enabled=False)
        try:
            srv._sluitcontrole_tick()
            assert calls == []
        finally:
            self._clean()

    def test_respecteert_ingesteld_interval(self, app, monkeypatch):
        calls = []
        monkeypatch.setattr(srv, '_ha_notify', lambda s, t, m: (calls.append((s, t, m)) or True))
        self._seed([{'id': 1, 'batch_id': 1, 'lotcode': 'L1-B1', 'status': 'open',
                     'start': self._iso_min_geleden(20)}])
        srv._write_json('haccp_instellingen', {'sluitcontrole_interval_min': 15})
        try:
            srv._sluitcontrole_tick()
            assert len(calls) == 1
        finally:
            self._clean()


class TestWcOrders:
    """Servercontrole op nieuwe webshoporders (_wc_orders_tick): meldt een
    order die nog niet als bestelling bestaat één keer via HA en houdt de
    lijst in `wc_import_status` bij — de import zelf doet de app."""

    CREDS = {'storeUrl': 'https://winkel.example', 'consumerKey': 'ck', 'consumerSecret': 'cs',
             'enabled': True, 'importInterval': 15}

    @staticmethod
    def _order(oid, naam=('Ans', 'Bakker'), total='12.50', method='flat_rate'):
        return {'id': oid, 'number': str(oid), 'status': 'processing', 'total': total, 'currency': 'EUR',
                'date_created': '2026-09-10T10:00:00',
                'billing': {'first_name': naam[0], 'last_name': naam[1]},
                'shipping_lines': [{'method_id': method, 'method_title': 'x'}]}

    @staticmethod
    def _seed(bestellingen=(), creds=None, notif_enabled=True, status=None):
        srv._write_json('woocommerce_creds', dict(TestWcOrders.CREDS, **(creds or {})))
        srv._write_json('notificatie_instellingen',
                        {'enabled': notif_enabled, 'notify_service': 'mobile_app_test', 'on_screen': True})
        srv._write_json('bestellingen', list(bestellingen))
        if status is not None:
            srv._write_json('wc_import_status', status)

    @staticmethod
    def _clean():
        conn = srv._db()
        with conn:
            conn.execute("DELETE FROM records WHERE key='bestellingen'")
            for k in ('woocommerce_creds', 'notificatie_instellingen', 'wc_import_status'):
                conn.execute("DELETE FROM kv WHERE key=?", (k,))
            for k in ('bestellingen', 'woocommerce_creds', 'notificatie_instellingen', 'wc_import_status'):
                conn.execute("DELETE FROM versies WHERE key=?", (k,))
        srv._wc_orders_laatste_check = 0.0
        srv._wc_orders_laatste_fout = None

    def test_instellingen_en_pad(self):
        inst = srv._wc_import_instellingen({'enabled': True, 'importInterval': '30',
                                            'importStatussen': ['processing', 'x;drop', 'processing'],
                                            'importVanaf': '2026-01-01'})
        assert inst == {'enabled': True, 'interval_min': 30, 'statussen': ['processing'], 'vanaf': '2026-01-01'}
        assert srv._wc_orders_pad(inst) == (
            'orders?status=processing&per_page=50&after=2026-01-01T00:00:00&_fields=' + srv.WC_ORDERS_FIELDS)
        leeg = srv._wc_import_instellingen({})
        assert leeg['interval_min'] == srv.WC_ORDERS_INTERVAL_DEFAULT_MIN
        assert leeg['statussen'] == list(srv.WC_IMPORT_STATUSSEN_DEFAULT) and leeg['vanaf'] == ''
        assert srv._wc_import_instellingen({'importInterval': 0})['interval_min'] == 0
        assert srv._valid_wc_path(srv._wc_orders_pad(inst))

    def test_samenvatting_en_selectie(self):
        sv = srv._wc_order_samenvatting(self._order(7, method='pickup_location'))
        assert sv == {'id': 7, 'nummer': '7', 'naam': 'Ans Bakker', 'totaal': '12.50', 'valuta': 'EUR',
                      'datum': '2026-09-10', 'status': 'processing', 'levering': 'afhalen'}
        assert srv._wc_order_samenvatting({'id': 'x'}) is None
        nieuw, te_melden, gemeld = srv._wc_nieuwe_orders(
            [self._order(1), self._order(2), self._order(2), self._order(3)], bekende_ids=[1], gemeld_ids=[2, 99])
        assert [o['id'] for o in nieuw] == [2, 3]
        assert [o['id'] for o in te_melden] == [3]
        assert gemeld == [2]  # 99 is niet meer nieuw → weg
        assert '#7' in srv._wc_order_melding(sv) and 'afhalen' in srv._wc_order_melding(sv)

    def test_meldt_nieuwe_order_eenmalig(self, app, monkeypatch):
        calls, gevraagd = [], []
        monkeypatch.setattr(srv, '_ha_notify', lambda s, t, m: (calls.append((s, t, m)) or True))
        winkel = [self._order(100), self._order(101, naam=('Kees', 'Bezorg'), total='19.90')]

        def fake(creds, method, subpath, body=None, herkansing=True):
            gevraagd.append((method, subpath))
            return 200, json.dumps(winkel).encode()

        monkeypatch.setattr(srv, '_wc_request', fake)
        self._seed(bestellingen=[{'id': 1, 'wc_order_id': 100}])
        try:
            srv._wc_orders_tick(force=True)
            assert gevraagd[0][0] == 'GET' and gevraagd[0][1].startswith('orders?status=')
            assert len(calls) == 1 and '#101' in calls[0][2] and 'Kees Bezorg' in calls[0][2]
            st = srv._read_json('wc_import_status')
            assert [o['id'] for o in st['nieuw']] == [101] and st['gemeld_ids'] == [101]
            assert st['laatste_fout'] is None and st['laatste_check']
            # Tweede ronde: niets nieuws, geen melding, geen schrijfactie.
            versie_voor = srv._read_json('wc_import_status')['laatste_check']
            srv._wc_orders_tick(force=True)
            assert len(calls) == 1
            assert srv._read_json('wc_import_status')['laatste_check'] == versie_voor
            # Zonder force respecteert de tick het interval.
            srv._wc_orders_tick()
            assert len(gevraagd) == 2
            # De app importeert de order → hij verdwijnt uit de lijst.
            srv._write_json('bestellingen', [{'id': 1, 'wc_order_id': 100}, {'id': 2, 'wc_order_id': 101}])
            srv._wc_orders_tick(force=True)
            st = srv._read_json('wc_import_status')
            assert st['nieuw'] == [] and st['gemeld_ids'] == []
        finally:
            self._clean()

    def test_uit_of_interval_nul_doet_niets(self, app, monkeypatch):
        gevraagd = []
        monkeypatch.setattr(srv, '_wc_request', lambda *a, **k: (gevraagd.append(1) or (200, b'[]')))
        for creds in ({'enabled': False}, {'importInterval': 0}):
            self._seed(creds=creds)
            try:
                srv._wc_orders_tick(force=True)
                assert not gevraagd
            finally:
                self._clean()

    def test_fout_vastgelegd_zonder_melding_en_later_gewist(self, app, monkeypatch):
        calls = []
        monkeypatch.setattr(srv, '_ha_notify', lambda s, t, m: (calls.append(1) or True))
        antwoorden = [(502, b'{"error": "upstream request failed", "oorzaak": "dns"}'),
                      (200, json.dumps([self._order(5)]).encode())]
        monkeypatch.setattr(srv, '_wc_request', lambda *a, **k: antwoorden.pop(0))
        self._seed()
        try:
            srv._wc_orders_tick(force=True)
            assert not calls
            assert srv._read_json('wc_import_status')['laatste_fout'] == 'dns'
            assert srv._wc_orders_laatste_fout == 'dns'
            srv._wc_orders_tick(force=True)
            st = srv._read_json('wc_import_status')
            assert st['laatste_fout'] is None and [o['id'] for o in st['nieuw']] == [5]
            assert len(calls) == 1
        finally:
            self._clean()

    def test_mislukte_notify_wordt_herhaald(self, app, monkeypatch):
        uitkomst = [False, True]
        calls = []
        monkeypatch.setattr(srv, '_ha_notify', lambda s, t, m: (calls.append(1) or uitkomst.pop(0)))
        monkeypatch.setattr(srv, '_wc_request', lambda *a, **k: (200, json.dumps([self._order(8)]).encode()))
        self._seed()
        try:
            srv._wc_orders_tick(force=True)
            assert srv._read_json('wc_import_status')['gemeld_ids'] == []
            srv._wc_orders_tick(force=True)
            assert len(calls) == 2 and srv._read_json('wc_import_status')['gemeld_ids'] == [8]
        finally:
            self._clean()

    def test_zonder_notify_toch_gemeld_en_lease_blijft_staan(self, app, monkeypatch):
        calls = []
        monkeypatch.setattr(srv, '_ha_notify', lambda s, t, m: (calls.append(1) or True))
        monkeypatch.setattr(srv, '_wc_request', lambda *a, **k: (200, json.dumps([self._order(9)]).encode()))
        self._seed(notif_enabled=False, status={'bezig_tot': 123, 'door': 'tab-a', 'laatste_import': 'x'})
        try:
            srv._wc_orders_tick(force=True)
            st = srv._read_json('wc_import_status')
            assert not calls
            assert st['gemeld_ids'] == [9] and [o['id'] for o in st['nieuw']] == [9]
            # De import-lease van de app blijft onaangeroerd.
            assert st['bezig_tot'] == 123 and st['door'] == 'tab-a' and st['laatste_import'] == 'x'
        finally:
            self._clean()

    def test_health_toont_controle(self, app, monkeypatch):
        srv._wc_orders_laatste_check = 1_757_500_000.0
        srv._wc_orders_laatste_fout = 'dns'
        try:
            status, body, _ = req(app, 'GET', '/api/health')
            assert status == 200
            assert body['wc_orders']['laatste_fout'] == 'dns'
            assert body['wc_orders']['laatste_check'].startswith('2025-09-10')
        finally:
            srv._wc_orders_laatste_check = 0.0
            srv._wc_orders_laatste_fout = None


class TestVergistingStap:
    """Server-tick die een HA-push stuurt zodra een vergistingsstap zijn
    geplande dagen bereikt, met dedup via `vergisting_stap_gemeld_start`."""

    @staticmethod
    def _iso_dagen_geleden(dagen):
        dt = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=dagen)
        return dt.isoformat()

    @staticmethod
    def _seed(batches, enabled=True, service='mobile_app_test'):
        srv._write_json('notificatie_instellingen',
                        {'enabled': enabled, 'notify_service': service, 'on_screen': True})
        srv._write_json('batches', batches)

    @staticmethod
    def _clean():
        conn = srv._db()
        with conn:
            conn.execute("DELETE FROM records WHERE key='batches'")
            conn.execute("DELETE FROM versies WHERE key='batches'")
            conn.execute("DELETE FROM kv WHERE key='notificatie_instellingen'")

    def test_meldt_gereed_en_dedupt(self, app, monkeypatch):
        calls = []
        monkeypatch.setattr(srv, '_ha_notify', lambda s, t, m: (calls.append((s, t, m)) or True))
        rijp = {'id': 1, 'naam': 'Tripel', 'status': 'Vergisten',
                'vergistingsprofiel': [{'type': 'Hoofdgisting', 'temp': 20, 'tijd': 7}],
                'vergisting_stap_idx': 0,
                'vergisting_stap_start': self._iso_dagen_geleden(8)}
        jong = {'id': 2, 'naam': 'Saison', 'status': 'Vergisten',
                'vergistingsprofiel': [{'type': 'Hoofdgisting', 'temp': 24, 'tijd': 7}],
                'vergisting_stap_idx': 0,
                'vergisting_stap_start': self._iso_dagen_geleden(2)}
        self._seed([rijp, jong])
        try:
            srv._vergisting_stap_tick()
            # Alleen de rijpe batch krijgt een melding.
            assert len(calls) == 1
            assert 'Tripel' in calls[0][2]
            # Dedup-markering is naar de batch geschreven.
            b1 = next(x for x in srv._read_json('batches') if x['id'] == 1)
            assert b1.get('vergisting_stap_gemeld_start') == rijp['vergisting_stap_start']
            # Tweede ronde: geen nieuwe melding (dedup).
            srv._vergisting_stap_tick()
            assert len(calls) == 1
            # Doorschakelen zet een nieuwe stap-start → opnieuw meldbaar.
            huidig = srv._read_json('batches')
            for x in huidig:
                if x['id'] == 1:
                    x['vergisting_stap_start'] = self._iso_dagen_geleden(10)
            srv._write_json('batches', huidig)
            srv._vergisting_stap_tick()
            assert len(calls) == 2
        finally:
            self._clean()

    def test_geen_melding_zonder_notify_service(self, app, monkeypatch):
        calls = []
        monkeypatch.setattr(srv, '_ha_notify', lambda s, t, m: (calls.append(1) or True))
        rijp = {'id': 5, 'naam': 'X', 'status': 'Vergisten',
                'vergistingsprofiel': [{'temp': 20, 'tijd': 3}],
                'vergisting_stap_start': self._iso_dagen_geleden(9)}
        self._seed([rijp], enabled=False)
        try:
            srv._vergisting_stap_tick()
            assert calls == []
        finally:
            self._clean()

    def test_cold_crash_en_andere_status_overgeslagen(self, app, monkeypatch):
        calls = []
        monkeypatch.setattr(srv, '_ha_notify', lambda s, t, m: (calls.append(1) or True))
        cc = {'id': 7, 'status': 'Vergisten', 'cold_crash_datum': self._iso_dagen_geleden(1),
              'vergistingsprofiel': [{'temp': 20, 'tijd': 3}],
              'vergisting_stap_start': self._iso_dagen_geleden(9)}
        cond = {'id': 8, 'status': 'Conditioneren',
                'vergistingsprofiel': [{'temp': 20, 'tijd': 3}],
                'vergisting_stap_start': self._iso_dagen_geleden(9)}
        self._seed([cc, cond])
        try:
            srv._vergisting_stap_tick()
            assert calls == []
        finally:
            self._clean()

    def test_valt_terug_op_tank_historie_zonder_stap_start(self, app, monkeypatch):
        calls = []
        monkeypatch.setattr(srv, '_ha_notify', lambda s, t, m: (calls.append(1) or True))
        datum = (datetime.date.today() - datetime.timedelta(days=9)).isoformat()
        b = {'id': 9, 'naam': 'Stout', 'status': 'Vergisten',
             'vergistingsprofiel': [{'temp': 18, 'tijd': 5}],
             'tank_historie': [{'status': 'Vergisten', 'from': datum}]}
        self._seed([b])
        try:
            srv._vergisting_stap_tick()
            assert len(calls) == 1
        finally:
            self._clean()


class TestOnthoudSessies:
    """'Onthoud mij' (langere cookie/sessie) en persistente sessies over een
    addon-herstart heen (directe-toegangspoort)."""

    def _mock_auth(self):
        import os as _os
        echt = srv._ha_auth_check
        srv._ha_auth_check = lambda u, w: 'ok' if (u, w) == ('jasper', 'geheim') else 'ongeldig'
        _os.environ['SUPERVISOR_TOKEN'] = 'testtoken'
        srv._login_pogingen.clear()

        def herstel():
            srv._ha_auth_check = echt
            _os.environ.pop('SUPERVISOR_TOKEN', None)
            srv._login_pogingen.clear()
        return herstel

    def _opruimen(self):
        with srv._sessie_lock:
            srv._sessies.clear()
        try:
            srv._sessie_bestand().unlink()
        except OSError:
            pass

    def test_onthoud_mij_verlengt_cookie_en_sessie(self, app_direct):
        herstel = self._mock_auth()
        try:
            # Zonder 'onthoud mij': 24 uur.
            _, _, h = req(app_direct, 'POST', '/api/login',
                          body={'username': 'jasper', 'password': 'geheim'})
            assert f'Max-Age={srv.SESSIE_DUUR}' in h.get('Set-Cookie', '')
            # Met 'onthoud mij': 30 dagen — cookie én sessie dragen de lange duur.
            srv._login_pogingen.clear()
            _, _, h2 = req(app_direct, 'POST', '/api/login',
                           body={'username': 'jasper', 'password': 'geheim', 'onthoud': True})
            cookie = h2.get('Set-Cookie', '')
            assert f'Max-Age={srv.SESSIE_DUUR_LANG}' in cookie
            assert 'HttpOnly' in cookie and 'SameSite=Strict' in cookie
            token = cookie.split(';')[0].split('=', 1)[1]
            assert srv._sessies[token]['duur'] == srv.SESSIE_DUUR_LANG
        finally:
            self._opruimen()
            herstel()

    def test_sessies_overleven_herstart(self, app_direct):
        herstel = self._mock_auth()
        try:
            _, _, h = req(app_direct, 'POST', '/api/login',
                          body={'username': 'jasper', 'password': 'geheim'})
            cookie = h.get('Set-Cookie', '').split(';')[0]
            token = cookie.split('=', 1)[1]
            # Het bestand bestaat en staat op 0600 (bevat het sessietoken).
            import os as _os
            import stat as _stat
            pad = srv._sessie_bestand()
            assert pad.exists()
            assert _stat.S_IMODE(_os.stat(pad).st_mode) == 0o600
            # Simuleer een herstart: in-memory dict leeg → cookie werkt niet meer.
            with srv._sessie_lock:
                srv._sessies.clear()
            assert req(app_direct, 'GET', '/api/whoami', headers={'Cookie': cookie})[0] == 401
            # Na laden uit het bestand is de sessie terug en werkt de cookie weer.
            srv._sessies_laad()
            assert token in srv._sessies
            status, wie, _ = req(app_direct, 'GET', '/api/whoami', headers={'Cookie': cookie})
            assert status == 200 and wie['gebruiker'] == 'jasper'
        finally:
            self._opruimen()
            herstel()

    def test_sessiebestand_overleeft_de_json_migratie(self, app_direct):
        """De JSON→SQLite-migratie scant /data/*.json en verplaatste ook
        brewadmin_sessies.json — dat bestand wordt bij elke login opnieuw
        geschreven, dus élke herstart logde iedereen uit."""
        herstel = self._mock_auth()
        try:
            _, _, h = req(app_direct, 'POST', '/api/login',
                          body={'username': 'jasper', 'password': 'geheim',
                                'onthoud': True})
            cookie = h.get('Set-Cookie', '').split(';')[0]
            token = cookie.split('=', 1)[1]
            # Herstart met de migratie ervoor (zoals _db() bij het opstarten doet).
            srv._migreer_json_bestanden(srv._db())
            assert srv._sessie_bestand().exists()
            assert srv._db().execute(
                "SELECT 1 FROM versies WHERE key='brewadmin_sessies'").fetchone() is None
            with srv._sessie_lock:
                srv._sessies.clear()
            srv._sessies_laad()
            assert token in srv._sessies
            status, wie, _ = req(app_direct, 'GET', '/api/whoami', headers={'Cookie': cookie})
            assert status == 200 and wie['gebruiker'] == 'jasper'
        finally:
            self._opruimen()
            herstel()

    def test_reparatie_haalt_sessies_uit_de_database(self, app_direct):
        """Installaties die al door de bug geraakt zijn: de sessies staan als
        data-key in de database en het bestand is weg. Bij het opstarten worden
        ze teruggezet en verdwijnen de tokens uit de database (de data-API zou
        ze anders uitserveren) en uit de migratiekopieën."""
        kopie = srv.DATA_DIR / srv.JSON_MIGRATIE_DIRNAAM / 'brewadmin_sessies.json'
        inhoud = {'tok-gemigreerd': {'gebruiker': 'jasper',
                                     'verloopt': 9_999_999_999.0,
                                     'duur': srv.SESSIE_DUUR_LANG}}
        srv._write_json('brewadmin_sessies', inhoud)
        kopie.parent.mkdir(parents=True, exist_ok=True)
        kopie.write_text(json.dumps(inhoud), encoding='utf-8')
        try:
            srv._sessies_laad()
            assert srv._sessies.get('tok-gemigreerd', {}).get('gebruiker') == 'jasper'
            assert srv._db().execute(
                "SELECT 1 FROM versies WHERE key='brewadmin_sessies'").fetchone() is None
            assert req(app_direct, 'GET', '/api/data/brewadmin_sessies',
                       headers={'Cookie': f'{srv.SESSIE_COOKIE}=tok-gemigreerd'})[0] == 404
            assert not kopie.exists()
        finally:
            self._opruimen()

    def test_cookie_wordt_bij_gebruik_ververst(self, app_direct):
        """De sessie schuift server-side mee, maar de cookie verliep op inlogtijd
        + duur. Bij gebruik krijgt de browser hooguit eens per dag een verse
        Max-Age, zodat actief gebruik niet alsnog uitlogt."""
        import time as _time
        herstel = self._mock_auth()
        try:
            _, _, h = req(app_direct, 'POST', '/api/login',
                          body={'username': 'jasper', 'password': 'geheim',
                                'onthoud': True})
            cookie = h.get('Set-Cookie', '').split(';')[0]
            token = cookie.split('=', 1)[1]
            # Vers ingelogd: geen tweede cookie in het antwoord.
            _, _, h2 = req(app_direct, 'GET', '/api/whoami', headers={'Cookie': cookie})
            assert 'Set-Cookie' not in h2
            # Een dag later wél — met de lange duur van deze sessie.
            with srv._sessie_lock:
                srv._sessies[token]['cookie'] = _time.time() - srv.SESSIE_COOKIE_VERVERS - 1
            _, _, h3 = req(app_direct, 'GET', '/api/whoami', headers={'Cookie': cookie})
            vers = h3.get('Set-Cookie', '')
            assert token in vers and f'Max-Age={srv.SESSIE_DUUR_LANG}' in vers
            assert 'HttpOnly' in vers and 'SameSite=Strict' in vers
            # Direct daarna niet nog eens.
            _, _, h4 = req(app_direct, 'GET', '/api/whoami', headers={'Cookie': cookie})
            assert 'Set-Cookie' not in h4
            # Uitloggen laat de cookie verlopen (geen verse cookie eroverheen).
            with srv._sessie_lock:
                srv._sessies[token]['cookie'] = _time.time() - srv.SESSIE_COOKIE_VERVERS - 1
            _, _, h5 = req(app_direct, 'POST', '/api/logout', headers={'Cookie': cookie})
            assert 'Max-Age=0' in h5.get('Set-Cookie', '')
            assert req(app_direct, 'GET', '/api/whoami', headers={'Cookie': cookie})[0] == 401
        finally:
            self._opruimen()
            herstel()

    def test_verlopen_sessie_wordt_niet_hersteld(self, app_direct):
        pad = srv._sessie_bestand()
        pad.write_text(json.dumps({
            'tok-verlopen': {'gebruiker': 'x', 'verloopt': 1.0, 'duur': srv.SESSIE_DUUR},
            'tok-geldig': {'gebruiker': 'y', 'verloopt': 9_999_999_999.0, 'duur': srv.SESSIE_DUUR},
        }), encoding='utf-8')
        try:
            srv._sessies_laad()
            assert 'tok-verlopen' not in srv._sessies
            assert srv._sessies.get('tok-geldig', {}).get('gebruiker') == 'y'
        finally:
            self._opruimen()


class TestWooCommerceProxy:
    """De voorraadpush toonde bij elke storing hetzelfde 'WC 502' — geen
    onderscheid tussen een trage winkel, een verkeerde URL of een stuk
    certificaat. De proxy classificeert de netwerkfout nu en probeert een
    tijdelijke storing één keer opnieuw."""

    CREDS = {'url': 'https://winkel.example', 'key': 'ck_x', 'secret': 'cs_y'}

    def _urlopen(self, monkeypatch, uitkomsten):
        """Vervang urlopen door een teller die per aanroep één uitkomst uit
        `uitkomsten` afwerkt (exception → raisen, anders teruggeven)."""
        pogingen = []

        class _Resp:
            def __init__(self, data):
                self.status, self._data = 200, data
            def __enter__(self):
                return self
            def __exit__(self, *a):
                return False
            def read(self):
                return self._data

        def fake(req, timeout=None):
            pogingen.append(timeout)
            uitkomst = uitkomsten[min(len(pogingen) - 1, len(uitkomsten) - 1)]
            if isinstance(uitkomst, BaseException):
                raise uitkomst
            return _Resp(uitkomst)

        monkeypatch.setattr(srv.urllib.request, 'urlopen', fake)
        monkeypatch.setattr(srv.time, 'sleep', lambda s: None)
        return pogingen

    def test_oorzaak_classificatie(self):
        assert srv._wc_oorzaak(TimeoutError()) == 'timeout'
        assert srv._wc_oorzaak(socket.timeout()) == 'timeout'
        assert srv._wc_oorzaak(socket.gaierror(-2, 'Name not known')) == 'dns'
        assert srv._wc_oorzaak(ssl.SSLCertVerificationError()) == 'certificaat'
        assert srv._wc_oorzaak(ssl.SSLError('handshake')) == 'tls'
        assert srv._wc_oorzaak(ConnectionRefusedError()) == 'verbinding'
        assert srv._wc_oorzaak(ValueError('?')) == 'netwerk'

    def test_oorzaak_pakt_urlerror_uit(self):
        # urllib verpakt de echte fout in URLError.reason.
        assert srv._wc_oorzaak(urllib.error.URLError(socket.gaierror(-2, 'x'))) == 'dns'
        assert srv._wc_oorzaak(urllib.error.URLError(TimeoutError())) == 'timeout'

    def test_timeout_geeft_504_met_oorzaak(self, monkeypatch):
        pogingen = self._urlopen(monkeypatch, [TimeoutError()])
        status, data = srv._wc_request(self.CREDS, 'GET', 'products?per_page=1')
        body = json.loads(data)
        assert status == 504
        assert body['oorzaak'] == 'timeout'
        assert body['timeout'] == srv.WC_TIMEOUT
        # Tijdelijke storing → herkansing, met de ruimere timeout.
        assert pogingen == [srv.WC_TIMEOUT] * srv.WC_POGINGEN

    def test_herkansing_na_tijdelijke_storing(self, monkeypatch):
        pogingen = self._urlopen(monkeypatch, [ConnectionResetError(), b'{"id": 7}'])
        status, data = srv._wc_request(self.CREDS, 'PUT', 'products/7', b'{}')
        assert (status, json.loads(data)) == (200, {'id': 7})
        assert len(pogingen) == 2

    def test_dns_fout_wordt_niet_herhaald(self, monkeypatch):
        # Een verkeerde URL wordt bij een tweede poging niet ineens goed.
        pogingen = self._urlopen(monkeypatch, [urllib.error.URLError(socket.gaierror(-2, 'x'))])
        status, data = srv._wc_request(self.CREDS, 'GET', 'products')
        assert status == 502 and json.loads(data)['oorzaak'] == 'dns'
        assert len(pogingen) == 1

    def test_http_antwoord_gaat_ongewijzigd_door(self, monkeypatch):
        fout = urllib.error.HTTPError(
            'https://winkel.example', 401, 'Unauthorized', {},
            io.BytesIO(b'{"message": "Sorry, you cannot list resources."}'))
        pogingen = self._urlopen(monkeypatch, [fout])
        status, data = srv._wc_request(self.CREDS, 'GET', 'products')
        # Antwoord van de winkel zelf: doorgeven en niet opnieuw proberen.
        assert status == 401
        assert json.loads(data)['message'].startswith('Sorry')
        assert len(pogingen) == 1

    def test_aanmaken_wordt_nooit_herhaald(self, monkeypatch):
        # Een POST maakt een product áán. Een herkansing na een timeout zou
        # zomaar een tweede product in de winkel kunnen zetten.
        pogingen = self._urlopen(monkeypatch, [TimeoutError()])
        status, data = srv._wc_request(self.CREDS, 'POST', 'products', b'{}', herkansing=False)
        assert status == 504 and json.loads(data)['oorzaak'] == 'timeout'
        assert len(pogingen) == 1

    def test_aanmaakproxy_valideert_pad_en_json(self, app, monkeypatch):
        gestuurd = []

        def fake(creds, method, subpath, body=None, herkansing=True):
            gestuurd.append((method, subpath, body, herkansing))
            return 200, b'{"id": 91}'

        monkeypatch.setattr(srv, '_load_wc_creds', lambda: self.CREDS)
        monkeypatch.setattr(srv, '_wc_request', fake)

        # Ongeldig pad wordt geweigerd voordat de winkel benaderd wordt.
        status, _, _ = req(app, 'POST', '/api/woocommerce/create/products;rm', b'{}')
        assert status == 400 and not gestuurd

        # Geen geldige JSON: ook weigeren.
        status, _, _ = req(app, 'POST', '/api/woocommerce/create/products', b'geen json')
        assert status == 400 and not gestuurd

        status, body, _ = req(app, 'POST', '/api/woocommerce/create/products', b'{"name": "Tripel"}')
        assert status == 200 and body['id'] == 91
        # POST gaat zonder herkansing de deur uit (niet-idempotent).
        assert gestuurd == [('POST', 'products', b'{"name": "Tripel"}', False)]

    def test_orderstatus_en_notitie_via_proxy(self, app, monkeypatch):
        """Terugschrijven van de orderstatus (utils/wcTerugschrijven.ts): de
        status gaat als PUT (met herkansing), de ordernotitie als POST (zonder)."""
        gestuurd = []

        def fake(creds, method, subpath, body=None, herkansing=True):
            gestuurd.append((method, subpath, body, herkansing))
            return 200, b'{"id": 7}'

        monkeypatch.setattr(srv, '_load_wc_creds', lambda: self.CREDS)
        monkeypatch.setattr(srv, '_wc_request', fake)

        assert srv._valid_wc_path('orders/7') and srv._valid_wc_path('orders/7/notes')
        status, body, _ = req(app, 'POST', '/api/woocommerce/put/orders/7', b'{"status": "completed"}')
        assert status == 200 and body['id'] == 7
        status, _, _ = req(app, 'POST', '/api/woocommerce/create/orders/7/notes',
                           b'{"note": "Verzonden", "customer_note": false}')
        assert status == 200
        assert gestuurd == [
            ('PUT', 'orders/7', b'{"status": "completed"}', True),
            ('POST', 'orders/7/notes', b'{"note": "Verzonden", "customer_note": false}', False),
        ]

    def test_aanmaakproxy_zonder_credentials(self, app, monkeypatch):
        monkeypatch.setattr(srv, '_load_wc_creds', lambda: None)
        status, _, _ = req(app, 'POST', '/api/woocommerce/create/products', b'{}')
        assert status == 401

    def test_verbindingstest_geeft_oorzaak_door(self, app, monkeypatch):
        """De verbindingstest in Instellingen toonde bij een netwerkfout alleen
        'HTTP 502'; de oorzaakscode van _wc_request gaat nu mee, zodat de app
        een vertaalde oorzaak kan tonen (utils/wcFout.ts)."""
        monkeypatch.setattr(srv, '_is_private_url', lambda url: False)
        monkeypatch.setattr(srv, '_wc_request', lambda *a, **k: (
            504, json.dumps({'error': 'upstream request failed', 'oorzaak': 'timeout', 'timeout': 20}).encode()))
        creds = {'storeUrl': 'https://winkel.example', 'consumerKey': 'ck_x', 'consumerSecret': 'cs_y'}
        status, body, _ = req(app, 'POST', '/api/woocommerce/test', creds)
        assert status == 200
        assert body['ok'] is False and body['status'] == 504
        assert body['oorzaak'] == 'timeout' and body['timeout'] == srv.WC_TIMEOUT

    def test_verbindingstest_neemt_geen_onbekende_oorzaak_over(self, app, monkeypatch):
        # Een antwoord van de winkel zelf (401) heeft geen oorzaakscode; een
        # vreemde waarde in de body gaat nooit mee naar de app.
        monkeypatch.setattr(srv, '_is_private_url', lambda url: False)
        monkeypatch.setattr(srv, '_wc_request', lambda *a, **k: (
            401, json.dumps({'message': 'Sorry', 'oorzaak': '<script>'}).encode()))
        creds = {'storeUrl': 'https://winkel.example', 'consumerKey': 'ck_x', 'consumerSecret': 'cs_y'}
        status, body, _ = req(app, 'POST', '/api/woocommerce/test', creds)
        assert status == 200
        assert body == {'ok': False, 'status': 401, 'detail': 'Sorry'}


class TestTankBewaking:
    """Temperatuurbewaking van de gisttanks: het oordeel zelf (spiegel van
    src/utils/tankbewaking.ts) en de alarmadministratie van de server-tick.

    De scherpe randen zitten in wat er níét mag gebeuren: een koeling die het
    setpoint net niet haalt, een stapwissel en een uitschieter van twintig
    minuten mogen geen melding geven — een pomp die uitvalt wél."""

    NU = 1_800_000_000.0  # vaste 'nu' zodat de tests niet van de klok afhangen
    CFG = srv._bewaking_cfg({})

    @classmethod
    def _reeks(cls, temps, stap_min=10, eind=None):
        """Meetpunten terug in de tijd; temps[0] is het oudste punt."""
        eind = cls.NU if eind is None else eind
        stap = stap_min * 60
        start = eind - (len(temps) - 1) * stap
        return [(start + i * stap, t) for i, t in enumerate(temps)]

    @classmethod
    def _vlak(cls, temp, uren, eind=None):
        return cls._reeks([temp] * (uren * 6 + 1), 10, cls.NU if eind is None else eind)

    def _oordeel(self, doel, doel_sinds, punten, ramp=None, cfg=None):
        return srv._beoordeel_tank(doel, doel_sinds, ramp, punten, self.NU, cfg or self.CFG)

    # ── Het oordeel ─────────────────────────────────────────────────────────

    def test_offset_binnen_de_band_is_ok(self):
        # De koeling haalt het setpoint nooit exact: 18,7 op een doel van 18.
        r = self._oordeel(18, self.NU - 3 * 86400, self._vlak(18.7, 12))
        assert r['status'] == 'ok'

    def test_korte_uitschieter_meldt_niet(self):
        punten = self._vlak(18, 6, self.NU - 20 * 60) + self._reeks([20, 21, 22])
        r = self._oordeel(18, self.NU - 5 * 86400, punten)
        assert r['status'] == 'afwijking'

    def test_stapwissel_krijgt_instelruimte(self):
        # Vier uur geleden doorgeschakeld van 18 naar 22; de tank klimt netjes.
        klim = [18 + i * (1.5 / 24) for i in range(25)]
        r = self._oordeel(22, self.NU - 4 * 3600, self._reeks(klim), ramp=12)
        assert r['status'] == 'instellen'

    def test_wegloper_slaat_alarm(self):
        # Pomp uitgevallen: zes uur lang een halve graad per uur omhoog.
        klim = [18 + i * (0.5 / 6) for i in range(37)]
        r = self._oordeel(18, self.NU - 5 * 86400, self._reeks(klim))
        assert r['status'] == 'alarm' and r['reden'] == 'wegloop'
        assert r['trend'] > 0.4

    def test_inhalende_koeling_is_geen_wegloper(self):
        daal = [23 - i * (0.5 / 6) for i in range(37)]
        r = self._oordeel(18, self.NU - 5 * 86400, self._reeks(daal))
        assert r['reden'] != 'wegloop' and r['trend'] < 0

    def test_uitgedoofde_beweging_is_geen_wegloper(self):
        # Twee uur geleden opgelopen naar 20 en sindsdien stil: wel een
        # afwijking om iets aan te doen, geen wegloper.
        punten = self._vlak(18, 6, self.NU - 2 * 3600) + self._vlak(20, 2)
        r = self._oordeel(18, self.NU - 5 * 86400, punten)
        assert r['status'] == 'waarschuwing' and r['reden'] == 'band'

    def test_grote_aanhoudende_afwijking_is_alarm(self):
        punten = self._vlak(18, 6, self.NU - 2 * 3600) + self._vlak(22, 2)
        r = self._oordeel(18, self.NU - 5 * 86400, punten)
        assert r['status'] == 'alarm' and r['reden'] == 'band'

    def test_stille_sensor_meldt(self):
        r = self._oordeel(18, self.NU - 5 * 86400, self._vlak(18, 6, self.NU - 2 * 3600))
        assert r['status'] == 'sensor_stil'

    def test_zonder_metingen_of_doel(self):
        assert self._oordeel(18, None, [])['status'] == 'geen_data'
        assert self._oordeel(None, None, self._vlak(18, 2))['status'] == 'geen_doel'

    def test_python_en_typescript_gebruiken_dezelfde_defaults(self):
        # De defaults staan op twee plaatsen; lopen ze uiteen, dan oordelen de
        # app en de server verschillend over dezelfde tank.
        bron = (Path(__file__).resolve().parent.parent
                / 'src' / 'utils' / 'tankbewaking.ts').read_text(encoding='utf-8')
        blok = bron.split('BEWAKING_DEFAULTS')[1].split('}')[0]
        ts_waarden = dict(re.findall(r'(\w+):\s*([\d.]+)', blok))
        assert ts_waarden, 'BEWAKING_DEFAULTS niet gevonden in tankbewaking.ts'
        for sleutel, waarde in srv._BEWAKING_DEFAULTS.items():
            assert float(ts_waarden[sleutel]) == waarde, f'{sleutel} loopt uiteen'

    def test_instellingen_vallen_terug_op_defaults(self):
        cfg = srv._bewaking_cfg({'bewaking': {'tolerantie': 0, 'duur_min': '90',
                                              'trend_uren': 'nvt', 'alarm_marge': 0}})
        assert cfg['tolerantie'] == 1.5   # 0 zou een alarmstorm geven
        assert cfg['duur_min'] == 90.0
        assert cfg['trend_uren'] == 3.0
        assert cfg['alarm_marge'] == 0.0  # wél een geldige keuze

    def test_doel_uit_stap_en_cold_crash(self):
        profiel = [{'temp': 18, 'tijd': 5}, {'temp': 22, 'tijd': 2}]
        doel, sinds, ramp = srv._tank_doel(
            {'vergistingsprofiel': profiel, 'vergisting_stap_idx': 1,
             'vergisting_stap_start': '2026-03-10T06:00:00Z'})
        assert doel == 22 and sinds == srv._iso_naar_epoch('2026-03-10T06:00:00Z')
        # Een lopende cold-crash wint, met de daaltijd als ramp (22 → 2 @ 1 °C/u).
        doel, _sinds, ramp = srv._tank_doel(
            {'vergistingsprofiel': profiel, 'cold_crash_datum': '2026-03-10T00:00:00Z',
             'cold_crash_target': 2, 'cold_crash_ramp': 1})
        assert doel == 2 and ramp == 20
        assert srv._tank_doel({})[0] is None

    def test_werkelijk_setpoint_wint_van_het_schema(self):
        profiel = [{'temp': 18, 'tijd': 5, 'ramp': 6}]
        batch = {'vergistingsprofiel': profiel,
                 'vergisting_stap_start': '2026-03-10T06:00:00Z'}
        stap_sinds = srv._iso_naar_epoch('2026-03-10T06:00:00Z')
        # De koeling staat handmatig op 16: dáár moet de tank staan, en het
        # instelvenster loopt vanaf die wissel — niet vanaf de stapstart.
        doel, sinds, ramp = srv._tank_doel(batch, (16.0, stap_sinds + 7200))
        assert doel == 16.0 and sinds == stap_sinds + 7200 and ramp is None
        # Stuurt de koeling op precies wat het schema vraagt, dan blijven de
        # ramp en het stapmoment gelden.
        doel, sinds, ramp = srv._tank_doel(batch, (18.0, stap_sinds - 7200))
        assert doel == 18.0 and sinds == stap_sinds and ramp == 6
        # Nog onbekende wisseldatum (eerste waarneming): geen instelvenster.
        assert srv._tank_doel(batch, (16.0, None)) == (16.0, None, None)
        # Zonder setpoint blijft het schema gelden.
        assert srv._tank_doel(batch)[0] == 18
        assert srv._tank_doel(batch, (None, None))[0] == 18

    def test_setpoint_voor_tank_negeert_oude_en_onbruikbare_waarden(self):
        nu = 1_800_000_000.0
        iso = lambda ts: datetime.datetime.fromtimestamp(
            ts, datetime.timezone.utc).isoformat()
        rijen = [{'tank': 'T1', 'setpoint': 16, 'sinds': iso(nu - 7200), 'gezien': iso(nu)},
                 {'tank': 'T2', 'setpoint': 20, 'sinds': None,
                  'gezien': iso(nu - srv._SETPOINT_MAX_LEEFTIJD_S - 60)},
                 {'tank': 'T3', 'setpoint': None, 'sinds': None, 'gezien': iso(nu)}]
        assert srv._setpoint_voor_tank(rijen, 'T1', nu) == (16.0, srv._iso_naar_epoch(iso(nu - 7200)))
        assert srv._setpoint_voor_tank(rijen, 'T2', nu) is None   # te lang niet ververst
        assert srv._setpoint_voor_tank(rijen, 'T3', nu) is None   # geen bruikbare waarde
        assert srv._setpoint_voor_tank(rijen, 'T9', nu) is None
        assert srv._setpoint_voor_tank([], 'T1', nu) is None

    def test_python_en_typescript_gebruiken_dezelfde_setpoint_leeftijd(self):
        bron = (Path(__file__).resolve().parent.parent
                / 'src' / 'utils' / 'tankbewaking.ts').read_text(encoding='utf-8')
        uren = re.search(r'SETPOINT_MAX_LEEFTIJD_MS = ([\d.]+) \* UUR_MS', bron)
        assert uren, 'SETPOINT_MAX_LEEFTIJD_MS niet gevonden in tankbewaking.ts'
        assert float(uren.group(1)) * 3600 == srv._SETPOINT_MAX_LEEFTIJD_S

    # ── De tick en de alarmadministratie ────────────────────────────────────

    @staticmethod
    def _clean():
        conn = srv._db()
        with conn:
            for key in ('batches', 'gist_metingen', 'tank_alarmen',
                        'tank_setpoints'):
                conn.execute('DELETE FROM records WHERE key=?', (key,))
                conn.execute('DELETE FROM versies WHERE key=?', (key,))
            for key in ('ha_instellingen', 'notificatie_instellingen'):
                conn.execute('DELETE FROM kv WHERE key=?', (key,))

    @staticmethod
    def _metingen(batch_id, temps, stap_min=10):
        """Metingen zoals _auto_metingen_tick ze wegschrijft: lokale datum+tijd,
        het laatste punt vlak vóór nu."""
        nu = datetime.datetime.now()
        rijen = []
        for i, temp in enumerate(reversed(temps)):
            moment = nu - datetime.timedelta(minutes=i * stap_min + 1)
            rijen.append({'id': i + 1, 'batch_id': batch_id, 'temp': temp, 'auto': True,
                          'datum': moment.strftime('%Y-%m-%d'),
                          'tijd': moment.strftime('%H:%M')})
        return list(reversed(rijen))

    def _seed(self, temps, doel=18, bewaking=True):
        srv._write_json('ha_instellingen', {
            'enabled': True, 'sensors': [{'id': 1, 'tank': 'T1', 'entity': 'sensor.t1'}],
            'bewaking': {'enabled': bewaking}})
        srv._write_json('notificatie_instellingen',
                        {'enabled': True, 'notify_service': 'mobile_app_test'})
        srv._write_json('batches', [{
            'id': 1, 'naam': 'Tripel', 'tank': 'T1', 'status': 'Vergisten',
            'vergistingsprofiel': [{'temp': doel, 'tijd': 6}],
            'vergisting_stap_start': (datetime.datetime.now(datetime.timezone.utc)
                                      - datetime.timedelta(days=3)).isoformat()}])
        srv._write_json('gist_metingen', self._metingen(1, temps))

    def test_opent_alarm_en_meldt_eenmalig(self, app, monkeypatch):
        calls = []
        monkeypatch.setattr(srv, '_ha_notify', lambda s, t, m: (calls.append(m) or True))
        # Zes uur 24 °C op een doel van 18: ver ernaast en aanhoudend.
        self._seed([24.0] * 37)
        try:
            srv._tank_bewaking_tick()
            alarmen = srv._read_json('tank_alarmen', [])
            assert len(alarmen) == 1
            assert alarmen[0]['soort'] == 'alarm' and alarmen[0]['batch_id'] == 1
            assert alarmen[0]['hersteld_op'] is None
            assert len(calls) == 1 and 'Tripel' in calls[0]
            # Tweede ronde: dezelfde storing meldt niet opnieuw.
            srv._tank_bewaking_tick()
            assert len(srv._read_json('tank_alarmen', [])) == 1
            assert len(calls) == 1
        finally:
            self._clean()

    def test_sluit_alarm_bij_herstel(self, app, monkeypatch):
        calls = []
        monkeypatch.setattr(srv, '_ha_notify', lambda s, t, m: (calls.append(m) or True))
        self._seed([24.0] * 37)
        try:
            srv._tank_bewaking_tick()
            # Tank is terug op temperatuur.
            srv._write_json('gist_metingen', self._metingen(1, [18.2] * 37))
            srv._tank_bewaking_tick()
            alarmen = srv._read_json('tank_alarmen', [])
            assert len(alarmen) == 1 and alarmen[0]['hersteld_op']
            assert 'terug op niveau' in calls[-1]
            # En daarna blijft het stil.
            srv._tank_bewaking_tick()
            assert len(calls) == 2
        finally:
            self._clean()

    def test_zwijgt_bij_een_gezonde_tank(self, app, monkeypatch):
        calls = []
        monkeypatch.setattr(srv, '_ha_notify', lambda s, t, m: (calls.append(m) or True))
        self._seed([18.6] * 37)
        try:
            srv._tank_bewaking_tick()
            assert srv._read_json('tank_alarmen', []) == []
            assert calls == []
        finally:
            self._clean()

    def test_uitgeschakelde_bewaking_doet_niets(self, app, monkeypatch):
        calls = []
        monkeypatch.setattr(srv, '_ha_notify', lambda s, t, m: (calls.append(m) or True))
        self._seed([24.0] * 37, bewaking=False)
        try:
            srv._tank_bewaking_tick()
            assert srv._read_json('tank_alarmen', []) == []
            assert calls == []
        finally:
            self._clean()

    def test_alarm_wordt_geschreven_zonder_notify_service(self, app, monkeypatch):
        # De banner in de app moet ook werken als er geen push is ingesteld.
        monkeypatch.setattr(srv, '_ha_notify', lambda s, t, m: True)
        self._seed([24.0] * 37)
        srv._write_json('notificatie_instellingen', {'enabled': False, 'notify_service': ''})
        try:
            srv._tank_bewaking_tick()
            assert len(srv._read_json('tank_alarmen', [])) == 1
        finally:
            self._clean()

    def test_escalatie_meldt_opnieuw(self, app, monkeypatch):
        calls = []
        monkeypatch.setattr(srv, '_ha_notify', lambda s, t, m: (calls.append(m) or True))
        # Eerst 20 °C op een doel van 18: buiten de band, maar niet groot.
        self._seed([20.0] * 37)
        try:
            srv._tank_bewaking_tick()
            assert srv._read_json('tank_alarmen', [])[0]['soort'] == 'waarschuwing'
            # Het loopt verder op naar 24: dezelfde regel, zwaardere soort.
            srv._write_json('gist_metingen', self._metingen(1, [24.0] * 37))
            srv._tank_bewaking_tick()
            alarmen = srv._read_json('tank_alarmen', [])
            assert len(alarmen) == 1 and alarmen[0]['soort'] == 'alarm'
            assert len(calls) == 2
        finally:
            self._clean()

    def test_sluit_alarm_van_een_batch_die_de_tank_uit_is(self, app, monkeypatch):
        monkeypatch.setattr(srv, '_ha_notify', lambda s, t, m: True)
        self._seed([24.0] * 37)
        try:
            srv._tank_bewaking_tick()
            assert srv._read_json('tank_alarmen', [])[0]['hersteld_op'] is None
            # Batch is afgevuld: er valt niets meer te bewaken, dus de storing
            # mag niet eeuwig in de banner blijven staan.
            batches = srv._read_json('batches', [])
            batches[0]['status'] = 'Afgevuld'
            srv._write_json('batches', batches)
            srv._tank_bewaking_tick()
            regel = srv._read_json('tank_alarmen', [])[0]
            assert regel['hersteld_op'] and regel['afgesloten_zonder_meting']
        finally:
            self._clean()

    def test_lopende_storing_schrijft_niet_elke_ronde(self, app, monkeypatch):
        # Elke ronde wegschrijven zou elke vijf minuten een versiebump geven.
        monkeypatch.setattr(srv, '_ha_notify', lambda s, t, m: True)
        self._seed([24.0] * 37)
        try:
            srv._tank_bewaking_tick()
            versie = srv._data_version("tank_alarmen")
            srv._tank_bewaking_tick()
            assert srv._data_version("tank_alarmen") == versie
        finally:
            self._clean()

    # ── Het werkelijke setpoint van de koeling ──────────────────────────────

    @staticmethod
    def _koppel_climate(entity='climate.tank1'):
        """Hang een climate-entity aan T1 (bovenop wat _seed heeft gezet)."""
        inst = srv._read_json('ha_instellingen', {})
        inst['climates_enabled'] = True
        inst['climates'] = [{'id': 1, 'tank': 'T1', 'entity': entity}]
        srv._write_json('ha_instellingen', inst)

    def test_toetst_aan_het_werkelijke_setpoint(self, app, monkeypatch):
        calls = []
        monkeypatch.setattr(srv, '_ha_notify', lambda s, t, m: (calls.append(m) or True))
        # Het schema zegt 18, maar de brouwer heeft de koeling zelf op 24 gezet
        # en de tank staat keurig op 24. Dat is geen storing.
        self._seed([24.0] * 37)
        self._koppel_climate()
        monkeypatch.setattr(srv, '_ha_fetch_climate_setpoint', lambda e: 24.0)
        try:
            srv._tank_bewaking_tick()
            assert srv._read_json('tank_alarmen', []) == []
            assert calls == []
            rij = srv._read_json('tank_setpoints', [])[0]
            assert rij['tank'] == 'T1' and rij['setpoint'] == 24.0
            # Eerste waarneming: geen wisselmoment, dus ook geen instelvenster
            # dat een lopende storing zou verzwijgen.
            assert rij['sinds'] is None and rij['gezien']
        finally:
            self._clean()

    def test_alarm_als_de_tank_het_setpoint_niet_haalt(self, app, monkeypatch):
        calls = []
        monkeypatch.setattr(srv, '_ha_notify', lambda s, t, m: (calls.append(m) or True))
        # Schema én meting zeggen 24, maar de koeling stuurt op 18: de tank
        # hangt al uren zes graden boven z'n setpoint.
        self._seed([24.0] * 37, doel=24)
        self._koppel_climate()
        monkeypatch.setattr(srv, '_ha_fetch_climate_setpoint', lambda e: 18.0)
        try:
            srv._tank_bewaking_tick()
            alarmen = srv._read_json('tank_alarmen', [])
            assert len(alarmen) == 1 and alarmen[0]['doel'] == 18.0
            assert len(calls) == 1
        finally:
            self._clean()

    def test_setpoint_wissel_zet_sinds_en_geeft_instelruimte(self, app, monkeypatch):
        monkeypatch.setattr(srv, '_ha_notify', lambda s, t, m: True)
        self._seed([24.0] * 37, doel=24)
        self._koppel_climate()
        monkeypatch.setattr(srv, '_ha_fetch_climate_setpoint', lambda e: 24.0)
        try:
            srv._tank_bewaking_tick()
            assert srv._read_json('tank_alarmen', []) == []
            # De brouwer zet de koeling naar 12 (cold crash): de tank staat nog
            # op 24, maar dat is instellen — geen storing.
            monkeypatch.setattr(srv, '_ha_fetch_climate_setpoint', lambda e: 12.0)
            srv._tank_bewaking_tick()
            rij = srv._read_json('tank_setpoints', [])[0]
            assert rij['setpoint'] == 12.0 and rij['sinds']
            assert srv._read_json('tank_alarmen', []) == []
        finally:
            self._clean()

    def test_ongewijzigd_setpoint_schrijft_niet_elke_ronde(self, app, monkeypatch):
        monkeypatch.setattr(srv, '_ha_notify', lambda s, t, m: True)
        self._seed([18.2] * 37)
        self._koppel_climate()
        monkeypatch.setattr(srv, '_ha_fetch_climate_setpoint', lambda e: 18.0)
        try:
            srv._tank_bewaking_tick()
            versie = srv._data_version('tank_setpoints')
            srv._tank_bewaking_tick()
            assert srv._data_version('tank_setpoints') == versie
        finally:
            self._clean()

    def test_onleesbare_climate_valt_terug_op_het_schema(self, app, monkeypatch):
        monkeypatch.setattr(srv, '_ha_notify', lambda s, t, m: True)
        # Geen enkele waarde te lezen (HA even weg): het schema blijft gelden,
        # dus 24 °C op een doel van 18 is gewoon alarm.
        self._seed([24.0] * 37)
        self._koppel_climate()
        monkeypatch.setattr(srv, '_ha_fetch_climate_setpoint', lambda e: None)
        try:
            srv._tank_bewaking_tick()
            assert srv._read_json('tank_setpoints', []) == []
            assert len(srv._read_json('tank_alarmen', [])) == 1
        finally:
            self._clean()

    def test_zonder_climate_koppeling_geen_setpoints(self, app, monkeypatch):
        monkeypatch.setattr(srv, '_ha_notify', lambda s, t, m: True)
        gelezen = []
        monkeypatch.setattr(srv, '_ha_fetch_climate_setpoint',
                            lambda e: (gelezen.append(e) or 18.0))
        self._seed([24.0] * 37)
        try:
            srv._tank_bewaking_tick()
            assert gelezen == []            # niets te lezen zonder koppeling
            assert len(srv._read_json('tank_alarmen', [])) == 1
        finally:
            self._clean()


# ── Lokale tijd zoals de app (dag-datums, wintertijd) ───────────────────────

# POSIX-notatie van Europe/Amsterdam: werkt ook zonder tzdata in de container.
_TZ_AMSTERDAM = 'CET-1CEST,M3.5.0,M10.5.0/3'


@pytest.fixture()
def amsterdam(monkeypatch):
    """Draai de test in Nederlandse tijd (de Supervisor geeft TZ mee aan de
    addon). Na afloop de oude tijdzone terug."""
    monkeypatch.setenv('TZ', _TZ_AMSTERDAM)
    time.tzset()
    yield
    monkeypatch.undo()
    time.tzset()


class TestLokaleTijd:
    """`_iso_naar_epoch` zette een dag-datum op middernacht UTC, de app
    (`new Date(`${iso}T00:00`)`, vergisting.ts) op lokale middernacht: bij de
    start van stap 1 liepen server en app een (winter) tot twee (zomer) uur
    uiteen. En `_meting_epoch` las de lokale kloktijd van een automatische
    meting terug; in het herhaalde uur van de wintertijdwissel koos dat het
    eerdere moment, zodat de bewaking elk jaar vals 'sensor stil' meldde."""

    def test_dag_datum_is_lokale_middernacht(self, amsterdam):
        # Gelijk aan wat de browser geeft voor new Date('…T00:00').
        assert srv._iso_naar_epoch('2026-07-05') == 1783202400    # zomer, UTC+2
        assert srv._iso_naar_epoch('2026-01-05') == 1767567600    # winter, UTC+1
        # Tijdstip zonder tijdzone: ook lokaal, net als new Date('…T10:00').
        assert srv._iso_naar_epoch('2026-07-05T10:00') == 1783202400 + 10 * 3600
        # Met Z of offset telt die, ongeacht de tijdzone van de server.
        assert srv._iso_naar_epoch('2026-07-05T00:00:00Z') == 1783209600
        assert srv._iso_naar_epoch('2026-07-05T00:00:00+00:00') == 1783209600
        assert srv._iso_naar_epoch('onzin') is None
        assert srv._iso_naar_epoch(None) is None

    def test_stap_1_start_op_lokale_middernacht(self, amsterdam):
        batch = {'status': 'Vergisten', 'vergistingsprofiel': [{'temp': 18, 'tijd': 5}],
                 'tank_historie': [{'status': 'Vergisten', 'from': '2026-07-05'}]}
        assert srv._tank_doel(batch)[1] == 1783202400

    def test_meting_epoch_geeft_ts_voorrang(self, amsterdam):
        # 02:30 lokaal komt op 25 oktober twee keer voor; `ts` zegt welke.
        rij = {'datum': '2026-10-25', 'tijd': '02:30', 'ts': '2026-10-25T01:30:00+00:00'}
        assert srv._meting_epoch(rij) == datetime.datetime(
            2026, 10, 25, 1, 30, tzinfo=datetime.timezone.utc).timestamp()
        # Zonder (bruikbare) `ts` precies zoals voorheen: lokaal teruggeparst.
        oud = {'datum': '2026-03-10', 'tijd': '08:30'}
        verwacht = datetime.datetime(2026, 3, 10, 8, 30).timestamp()
        assert srv._meting_epoch(oud) == verwacht
        assert srv._meting_epoch({**oud, 'ts': 'kapot'}) == verwacht
        assert srv._meting_epoch({**oud, 'ts': None}) == verwacht

    @staticmethod
    def _wintertijd_metingen(met_ts):
        """Automatische metingen elke tien minuten rond de wintertijdwissel,
        zoals _auto_metingen_tick ze wegschrijft (lokale datum/tijd)."""
        start = datetime.datetime(2026, 10, 24, 22, 0, tzinfo=datetime.timezone.utc)
        rijen = []
        for i in range(6 * 6):  # zes uur
            moment = start + datetime.timedelta(minutes=10 * i)
            lokaal = datetime.datetime.fromtimestamp(moment.timestamp())
            rij = {'datum': lokaal.strftime('%Y-%m-%d'), 'tijd': lokaal.strftime('%H:%M'),
                   'temp': 18.0, 'auto': True}
            if met_ts:
                rij['ts'] = moment.isoformat(timespec='seconds')
            rijen.append(rij)
        return rijen

    def test_wintertijdwissel_geeft_geen_vals_sensor_stil(self, amsterdam):
        cfg = srv._bewaking_cfg({})
        begin = datetime.datetime(2026, 10, 25, 0, 0, tzinfo=datetime.timezone.utc).timestamp()
        start = datetime.datetime(2026, 10, 24, 22, 0, tzinfo=datetime.timezone.utc).timestamp()

        def oordelen(met_ts):
            rijen = self._wintertijd_metingen(met_ts)
            statussen = []
            for stap in range(0, 181, 5):
                nu = begin + stap * 60
                # Alleen de metingen die op `nu` al geschreven waren.
                bestaand = [r for i, r in enumerate(rijen) if start + i * 600 <= nu]
                punten = [(srv._meting_epoch(r), r['temp']) for r in bestaand]
                statussen.append(srv._beoordeel_tank(18.0, None, None, punten, nu, cfg)['status'])
            return statussen

        # Met `ts` (zoals de tick nu schrijft): de hele nacht in orde.
        assert set(oordelen(met_ts=True)) == {'ok'}
        # Zonder `ts` — het oude gedrag — zou het herhaalde uur 'sensor stil'
        # geven; die rijen blijven zo gerekend worden (terugval).
        assert 'sensor_stil' in oordelen(met_ts=False)


# ── Niet-eindige getallen (NaN/Infinity) ────────────────────────────────────

class _NepAntwoord:
    def __init__(self, body: bytes):
        self._body = body

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


class TestNietEindigeGetallen:
    """Een HA-sensor die bij een leesfout 'nan' meldt kwam als float NaN in de
    opslag; Python schreef letterlijk `NaN`, wat geen JSON is. De app kon de
    key (en /api/bulk) daarna niet meer lezen, en voor de bewaking leek een
    kapotte sensor 'ok'."""

    @staticmethod
    def _reset(*keys):
        conn = srv._db()
        with conn:
            for key in keys:
                conn.execute('DELETE FROM records WHERE key=?', (key,))
                conn.execute('DELETE FROM kv WHERE key=?', (key,))
                conn.execute('DELETE FROM versies WHERE key=?', (key,))

    def _ha(self, monkeypatch, body: bytes):
        monkeypatch.setenv('SUPERVISOR_TOKEN', 'test')
        monkeypatch.setattr(srv.urllib.request, 'urlopen',
                            lambda *a, **k: _NepAntwoord(body))

    @pytest.mark.parametrize('staat', ['nan', 'NaN', 'inf', '-inf', '1e999', 'unavailable', ''])
    def test_ha_state_zonder_eindig_getal_is_niet_te_lezen(self, monkeypatch, staat):
        self._ha(monkeypatch, json.dumps({'state': staat}).encode())
        assert srv._ha_fetch_state('sensor.t1') is None

    def test_ha_state_met_getal(self, monkeypatch):
        self._ha(monkeypatch, b'{"state": "18.4"}')
        assert srv._ha_fetch_state('sensor.t1') == 18.4

    @pytest.mark.parametrize('temperatuur', ['"nan"', '"inf"', '1e999', 'NaN'])
    def test_climate_setpoint_zonder_eindig_getal(self, monkeypatch, temperatuur):
        self._ha(monkeypatch, f'{{"attributes": {{"temperature": {temperatuur}}}}}'.encode())
        assert srv._ha_fetch_climate_setpoint('climate.t1') is None

    def test_climate_setpoint_met_getal(self, monkeypatch):
        self._ha(monkeypatch, b'{"attributes": {"temperature": 18.5}}')
        assert srv._ha_fetch_climate_setpoint('climate.t1') == 18.5

    @pytest.mark.parametrize('waarde', [b'NaN', b'Infinity', b'-Infinity', b'1e999'])
    def test_schrijfwegen_weigeren_niet_eindige_getallen(self, app, waarde):
        key = 'carbonatie_sessies'
        self._reset(key)
        try:
            assert req(app, 'POST', f'/api/data/{key}', body=[{'id': 1, 'druk': 1.2}])[0] == 200
            status, _, headers = req(app, 'GET', f'/api/data/{key}')
            versie = headers.get('X-Data-Version')
            rec = b'{"id":2,"druk":' + waarde + b'}'
            assert req(app, 'POST', f'/api/data/{key}', body=b'[' + rec + b']')[0] == 400
            assert req(app, 'POST', '/api/commit',
                       body=b'{"data":{"' + key.encode() + b'":[' + rec + b']}}')[0] == 400
            assert req(app, 'POST', f'/api/delta/{key}',
                       body=b'{"upsert":[' + rec + b'],"delete":[]}',
                       headers={'X-Data-Version': versie})[0] == 400
            # Niets geschreven.
            status, body, headers = req(app, 'GET', f'/api/data/{key}')
            assert body == [{'id': 1, 'druk': 1.2}]
            assert headers.get('X-Data-Version') == versie
        finally:
            self._reset(key)

    def test_opslag_schrijft_nooit_nan(self, app):
        # Vangnet voor een servertick: zoals JSON.stringify wordt het null.
        assert srv._json_compact({'a': float('nan'), 'b': [float('inf'), 1.5]}) \
            == '{"a":null,"b":[null,1.5]}'
        key = 'carbonatie_sessies'
        self._reset(key)
        try:
            srv._write_json(key, [{'id': 1, 'co2': float('nan')}])
            status, body, _ = req(app, 'GET', f'/api/data/{key}')
            assert status == 200 and body == [{'id': 1, 'co2': None}]
        finally:
            self._reset(key)

    def test_opschoning_bij_start_herstelt_een_besmette_key(self, app):
        conn = srv._db()
        self._reset('gist_metingen', 'batch_notities', 'brewery_details')
        try:
            with conn:
                # Zoals een versie van vóór de filter hem wegschreef.
                conn.execute("INSERT INTO records(key, seq, record_id, data) VALUES "
                             "('gist_metingen', 0, '1', '{\"id\":1,\"temp\":18.0}'), "
                             "('gist_metingen', 1, '2', '{\"id\":2,\"temp\":NaN}')")
                conn.execute("INSERT INTO versies(key, versie, soort) "
                             "VALUES ('gist_metingen', 'oud', 'array')")
                conn.execute("INSERT INTO kv(key, data) VALUES "
                             "('brewery_details', '{\"x\":Infinity}')")
                conn.execute("INSERT INTO versies(key, versie, soort) "
                             "VALUES ('brewery_details', 'oud', 'kv')")
            # 'NaN' in een tekst is gewoon data en blijft ongemoeid.
            srv._write_json('batch_notities', [{'id': 1, 'tekst': 'NaN-bier, Infinity IPA'}])
            notitie_versie = srv._data_version('batch_notities')

            srv._herstel_niet_eindige_getallen(conn)

            status, body, _ = req(app, 'GET', '/api/data/gist_metingen')
            assert status == 200 and body == [{'id': 1, 'temp': 18.0}, {'id': 2, 'temp': None}]
            assert req(app, 'GET', '/api/data/brewery_details')[1] == {'x': None}
            assert srv._data_version('batch_notities') == notitie_versie
            # Het herstel staat in de server-audit.
            regels = [json.loads(r) for f in srv.AUDIT_DIR.glob('audit_*.jsonl')
                      for r in f.read_text(encoding='utf-8').splitlines()]
            hersteld = {r['key'] for r in regels if r.get('actie') == 'nan_herstel'}
            assert {'gist_metingen', 'brewery_details'} <= hersteld
        finally:
            self._reset('gist_metingen', 'batch_notities', 'brewery_details')

    def test_bewaking_laat_zich_niet_maskeren_door_een_nan_meting(self, app, monkeypatch):
        """Een tank ver boven z'n doel met als laatste rij een 'nan' (van een
        kapotte sensor) moet alarm blijven — niet 'ok'."""
        monkeypatch.setattr(srv, '_ha_notify', lambda s, t, m: True)
        tb = TestTankBewaking()
        tb._seed([24.0] * 37)
        try:
            metingen = srv._read_json('gist_metingen', [])
            metingen[-1]['temp'] = 'nan'
            srv._write_json('gist_metingen', metingen)
            srv._tank_bewaking_tick()
            alarmen = srv._read_json('tank_alarmen', [])
            assert len(alarmen) == 1 and alarmen[0]['hersteld_op'] is None
            # Nog een ronde met de NaN-rij: het alarm blijft open.
            srv._tank_bewaking_tick()
            assert srv._read_json('tank_alarmen', [])[0]['hersteld_op'] is None
        finally:
            TestTankBewaking._clean()


# ── Uitdunnen van automatische metingen ─────────────────────────────────────

class TestAutoMetingenUitdunnen:
    """`gist_metingen` groeide met één rij per bewaakte tank per tien minuten,
    zonder grens. Boven de 10 MB die een request mag zijn werd elke handmatige
    meting geweigerd. De server dunt automatische metingen van ouder dan 48 u
    nu uit tot één per batch per uur; handmatige rijen blijven altijd."""

    NU = 1_800_000_000.0

    @classmethod
    def _auto(cls, batch_id, uren, start_id=1):
        """Auto-metingen elke tien minuten over `uren`, eindigend op NU."""
        rijen = []
        n = uren * 6
        for i in range(n + 1):
            ts = cls.NU - (n - i) * 600
            rijen.append({'id': start_id + i, 'batch_id': batch_id, 'temp': 18.0,
                          'auto': True,
                          'ts': datetime.datetime.fromtimestamp(
                              ts, datetime.timezone.utc).isoformat(timespec='seconds')})
        return rijen

    def test_dunt_alleen_oude_automatische_rijen_uit(self):
        oud_handmatig = {'id': 1, 'batch_id': 7, 'datum': '2020-01-01', 'tijd': '09:00', 'sg': 1.050}
        fg = {'id': 2, 'batch_id': 7, 'datum': '2020-01-02', 'sg': 1.010, 'bron': 'fg'}
        onleesbaar = {'id': 3, 'batch_id': 7, 'auto': True, 'temp': 18.0}
        metingen = [oud_handmatig, fg, onleesbaar] + self._auto(7, 72, 100) + self._auto(8, 72, 1000)
        uit = srv._dun_auto_metingen(metingen, self.NU, 48)

        # Handmatige rijen (ook bron 'fg') en rijen zonder tijdstip blijven.
        for rij in (oud_handmatig, fg, onleesbaar):
            assert rij in uit
        grens = self.NU - 48 * 3600
        for batch in (7, 8):
            eigen = [r for r in uit if r.get('batch_id') == batch and r.get('ts')]
            recent = [r for r in eigen if srv._meting_epoch(r) >= grens]
            oud = [r for r in eigen if srv._meting_epoch(r) < grens]
            # De laatste 48 u volledig (elke tien minuten), ouder één per uur:
            # van de 144 oude rijen (24 u × 6) blijven er ~24 over.
            assert len(recent) == 48 * 6 + 1
            uren = [int(srv._meting_epoch(r) // 3600) for r in oud]
            assert len(uren) == len(set(uren)) and 23 <= len(uren) <= 25
            # Per uur de laatste meting van dat uur.
            for r in oud:
                epoch = srv._meting_epoch(r)
                assert epoch % 3600 >= 3000 or epoch // 3600 == grens // 3600
        # Volgorde blijft gelijk, en een tweede ronde verandert niets.
        assert [r['id'] for r in uit] == sorted(r['id'] for r in uit)
        assert srv._dun_auto_metingen(uit, self.NU, 48) == uit

    def test_vers_venster_blijft_ruim_boven_de_bewaking(self):
        assert srv._auto_metingen_vers_uren({}) == 48
        # Een ruim ingestelde trendperiode: de bewaking kijkt 60 u terug.
        assert srv._auto_metingen_vers_uren({'bewaking': {'trend_uren': 20}}) >= 60 + 24

    @staticmethod
    def _clean():
        conn = srv._db()
        with conn:
            for key in ('batches', 'gist_metingen'):
                conn.execute('DELETE FROM records WHERE key=?', (key,))
                conn.execute('DELETE FROM versies WHERE key=?', (key,))
            conn.execute("DELETE FROM kv WHERE key='ha_instellingen'")
            conn.execute("DELETE FROM versies WHERE key='ha_instellingen'")

    def test_tick_schrijft_ts_en_dunt_eens_per_dag(self, app, monkeypatch):
        nu = time.time()
        srv._write_json('ha_instellingen', {
            'enabled': True, 'sensors': [{'id': 1, 'tank': 'T1', 'entity': 'sensor.t1'}]})
        srv._write_json('batches', [{'id': 7, 'tank': 'T1', 'status': 'Vergisten'}])
        oud = []
        for i in range(3 * 24 * 6):  # drie dagen, van zes tot drie dagen geleden
            ts = nu - 6 * 86400 + i * 600
            oud.append({'id': i + 1, 'batch_id': 7, 'temp': 18.0, 'auto': True,
                        'ts': datetime.datetime.fromtimestamp(
                            ts, datetime.timezone.utc).isoformat(timespec='seconds')})
        handmatig = {'id': 5000, 'batch_id': 7, 'datum': '2020-01-01', 'sg': 1.05}
        srv._write_json('gist_metingen', oud + [handmatig])
        monkeypatch.setattr(srv, '_ha_fetch_state', lambda e: 18.5)
        monkeypatch.setattr(srv, '_auto_metingen_gedund_op', 0.0)
        try:
            srv._auto_metingen_tick()
            metingen = srv._read_json('gist_metingen', [])
            assert handmatig in metingen
            # Alles was ouder dan 48 u: één rij per uur (72 ± 1), plus de
            # handmatige en de nieuwe meting.
            assert len([m for m in metingen if m.get('auto')]) <= 3 * 24 + 2
            nieuw = metingen[-1]
            assert nieuw['temp'] == 18.5 and nieuw['auto'] is True
            assert nieuw['id'] == 5001
            # Absoluut tijdstip naast de lokale datum/tijd.
            assert abs(datetime.datetime.fromisoformat(nieuw['ts']).timestamp() - time.time()) < 60
            assert nieuw['ts'].endswith('+00:00') and nieuw['datum'] and nieuw['tijd']

            # Binnen een dag niet opnieuw: nieuwe oude rijen blijven dan staan.
            srv._write_json('gist_metingen', metingen + oud[:12])
            srv._auto_metingen_tick()
            assert len(srv._read_json('gist_metingen', [])) == len(metingen) + 12 + 1
        finally:
            self._clean()

    def test_onleesbare_sensor_schrijft_niets(self, app, monkeypatch):
        srv._write_json('ha_instellingen', {
            'enabled': True, 'sensors': [{'id': 1, 'tank': 'T1', 'entity': 'sensor.t1'}]})
        srv._write_json('batches', [{'id': 7, 'tank': 'T1', 'status': 'Vergisten'}])
        srv._write_json('gist_metingen', [])
        monkeypatch.setenv('SUPERVISOR_TOKEN', 'test')
        monkeypatch.setattr(srv.urllib.request, 'urlopen',
                            lambda *a, **k: _NepAntwoord(b'{"state": "nan"}'))
        try:
            versie = srv._data_version('gist_metingen')
            srv._auto_metingen_tick()
            assert srv._read_json('gist_metingen', []) == []
            assert srv._data_version('gist_metingen') == versie
        finally:
            self._clean()


# ── SPA-statische-cache (performance-audit: gzip + ETag/304) ────────────────

class TestStaticCaching:
    """GET / (SPA-fallback): tot dusver werd `dist/index.html` bij élk
    verzoek van schijf gelezen en ongecomprimeerd geserveerd zonder
    validator (geen ETag/Last-Modified, dus nooit een 304). Deze klasse
    leidt STATIC_FILE om naar een eigen tijdelijk bestand — los van de
    echte 6,5 MB build — en reset de module-cache (`srv._static_cache`)
    zodat elke test met een schone lei begint. urllib volgt 304 niet netjes
    (het gooit een HTTPError of leest gewoon door), dus http.client zoals
    de andere integratietests hierboven."""

    INHOUD = b'<html><body>eerste-versie ' + b'x' * 500 + b'</body></html>'

    @pytest.fixture()
    def static(self, app, tmp_path, monkeypatch):
        pad = tmp_path / 'index.html'
        pad.write_bytes(self.INHOUD)
        monkeypatch.setattr(srv, 'STATIC_FILE', pad)
        # Verse cache-entry per test — anders zou een gelijke mtime uit een
        # vorige test (of de echte build) hier per ongeluk hergebruikt worden.
        srv._static_cache['mtime'] = None
        srv._static_cache['body'] = b''
        srv._static_cache['gzip'] = b''
        srv._static_cache['etag'] = ''
        srv._static_cache['themas'] = {}
        host, poort = app.replace('http://', '').split(':')
        yield pad, host, int(poort)

    @staticmethod
    def _get(host, poort, headers=None):
        conn = http.client.HTTPConnection(host, poort, timeout=10)
        conn.request('GET', '/', headers=headers or {})
        resp = conn.getresponse()
        body = resp.read()
        conn.close()
        return resp, body

    def test_200_heeft_etag_en_vary_maar_geen_content_encoding(self, static):
        _, host, poort = static
        resp, body = self._get(host, poort)
        assert resp.status == 200
        assert body == self.INHOUD
        assert resp.getheader('Content-Length') == str(len(self.INHOUD))
        assert resp.getheader('ETag')
        assert resp.getheader('Vary') == 'Accept-Encoding'
        assert resp.getheader('Content-Encoding') is None
        # De validerende Cache-Control blijft ongewijzigd (altijd revalideren,
        # met een 304 als het antwoord dat toelaat) — geen max-age erbij.
        assert resp.getheader('Cache-Control') == 'no-cache, must-revalidate'

    def test_accept_encoding_gzip_geeft_gecomprimeerde_body(self, static):
        _, host, poort = static
        resp, body = self._get(host, poort, headers={'Accept-Encoding': 'gzip'})
        assert resp.status == 200
        assert resp.getheader('Content-Encoding') == 'gzip'
        assert resp.getheader('Vary') == 'Accept-Encoding'
        assert gzip.decompress(body) == self.INHOUD

    def test_if_none_match_geeft_304_zonder_body(self, static):
        _, host, poort = static
        eerste, _ = self._get(host, poort)
        etag = eerste.getheader('ETag')
        assert etag
        tweede, body2 = self._get(host, poort, headers={'If-None-Match': etag})
        assert tweede.status == 304
        assert body2 == b''
        assert tweede.getheader('ETag') == etag

    def test_onbekende_if_none_match_blijft_200(self, static):
        _, host, poort = static
        resp, body = self._get(host, poort, headers={'If-None-Match': '"niet-de-juiste"'})
        assert resp.status == 200
        assert body == self.INHOUD

    def test_gewijzigd_bestand_geeft_nieuwe_etag_en_inhoud(self, static):
        pad, host, poort = static
        eerste, _ = self._get(host, poort)
        etag1 = eerste.getheader('ETag')
        nieuwe_inhoud = self.INHOUD + b'-gewijzigd'
        pad.write_bytes(nieuwe_inhoud)
        # mtime-resolutie op sommige bestandssystemen is grof (1s) — zet de
        # mtime expliciet in de toekomst zodat de cache de wijziging altijd ziet.
        toekomst = time.time() + 5
        os.utime(pad, (toekomst, toekomst))
        tweede, body2 = self._get(host, poort)
        assert tweede.status == 200
        assert body2 == nieuwe_inhoud
        etag2 = tweede.getheader('ETag')
        assert etag2 and etag2 != etag1
        # De oude ETag hoort nu niet meer te matchen
        derde, body3 = self._get(host, poort, headers={'If-None-Match': etag1})
        assert derde.status == 200
        assert body3 == nieuwe_inhoud


# ── Thema in de eerste weergave (iOS-home-screen-statusbalk) ────────────────

class TestThemaInjectie:
    """iOS 26 bemonstert de html-/body-achtergrond van de éérste weergave voor
    de statusbalk van een home-screen-app en werkt die niet bij als de app
    het thema later via JS zet. De server vult daarom de theme-color-meta en
    de lege `<style id="thema-init">` uit index.html met het opgeslagen
    `nav_theme` — per thema één gecachte variant met eigen ETag."""

    PLAATSHOUDERS = (b'<html><head><meta name="theme-color" content="#451a03" />'
                     b'<style id="thema-init"></style></head><body>x</body></html>')

    @pytest.fixture()
    def static(self, app, tmp_path, monkeypatch):
        pad = tmp_path / 'index.html'
        pad.write_bytes(self.PLAATSHOUDERS)
        monkeypatch.setattr(srv, 'STATIC_FILE', pad)
        srv._static_cache['mtime'] = None
        srv._static_cache['themas'] = {}
        host, poort = app.replace('http://', '').split(':')
        yield host, int(poort)
        srv._write_json('nav_theme', 'amber')

    @staticmethod
    def _get(host, poort, headers=None):
        conn = http.client.HTTPConnection(host, poort, timeout=10)
        conn.request('GET', '/', headers=headers or {})
        resp = conn.getresponse()
        body = resp.read()
        conn.close()
        return resp, body

    def test_python_en_typescript_thematabellen_zijn_gelijk(self):
        # Een thema dat alleen in constants.ts staat krijgt bij het openen
        # amber in de statusbalk; een dat alleen hier staat is onkiesbaar.
        bron = (Path(__file__).resolve().parent.parent
                / 'src' / 'utils' / 'constants.ts').read_text(encoding='utf-8')
        blok = bron.split('export const NAV_THEMES')[1].split('\n}\n')[0]
        ts = {}
        for naam, inhoud in re.findall(r'^\s+(\w+):\s*\{(.*?)\},?$', blok, re.S | re.M):
            ts[naam] = dict(re.findall(r"(\w+):'(#[0-9a-fA-F]{6})'", inhoud))
        assert set(ts) == set(srv._NAV_THEMAS), 'themanamen lopen uiteen'
        for naam, py in srv._NAV_THEMAS.items():
            for veld, kleur in py.items():
                assert ts[naam][veld].lower() == kleur.lower(), f'{naam}.{veld} loopt uiteen'

    def test_opgeslagen_thema_staat_in_de_head(self, static):
        host, poort = static
        srv._write_json('nav_theme', 'sand')
        resp, body = self._get(host, poort)
        assert resp.status == 200
        zand = srv._NAV_THEMAS['sand']
        assert f'<meta name="theme-color" content="{zand["from"]}" />'.encode() in body
        assert f'--t-bg:{zand["bg"]}'.encode() in body
        assert f'html{{background:{zand["bg"]}}}'.encode() in body
        # Home-screen-modus: html én body donker (de strook achter de klok).
        assert f'(display-mode: standalone){{html,html body{{background:{zand["from"]}}}}}'.encode() in body
        assert resp.getheader('Content-Length') == str(len(body))

    def test_themawissel_geeft_andere_etag_en_inhoud(self, static):
        host, poort = static
        srv._write_json('nav_theme', 'blue')
        blauw, body_blauw = self._get(host, poort)
        srv._write_json('nav_theme', 'green')
        groen, body_groen = self._get(host, poort)
        assert body_blauw != body_groen
        assert blauw.getheader('ETag') != groen.getheader('ETag')
        # De blauwe ETag valideert niet meer tegen de groene variant …
        nog, _ = self._get(host, poort, headers={'If-None-Match': blauw.getheader('ETag')})
        assert nog.status == 200
        # … en gzip levert dezelfde thema-variant.
        gz, body_gz = self._get(host, poort, headers={'Accept-Encoding': 'gzip'})
        assert gz.getheader('Content-Encoding') == 'gzip'
        assert gzip.decompress(body_gz) == body_groen

    def test_onbekend_of_ongeldig_thema_valt_terug_op_amber(self, static):
        host, poort = static
        srv._write_json('nav_theme', 'neon')
        _, body = self._get(host, poort)
        assert f'--t-bg:{srv._NAV_THEMAS["amber"]["bg"]}'.encode() in body
        assert srv._thema_naam(['sand']) == 'amber'
        assert srv._thema_naam(None) == 'amber'
        assert srv._thema_naam('sand') == 'sand'

    def test_build_zonder_plaatshouders_blijft_ongewijzigd(self):
        html = b'<html><body>zonder plaatshouders</body></html>'
        assert srv._pas_thema_toe(html, 'sand') == html


class TestWebsiteTelemetrie:
    """Website-telemetrie: elk uur een momentopname met brouwerijcijfers naar
    de plugin Craftery Brouwerij. Het bericht is een pure functie; de tick
    verstuurt alleen als alles aan staat, en ruimt de site op als hij uitgaat."""

    NU = datetime.datetime(2026, 9, 22, 21, 0).timestamp()
    CREDS = {'storeUrl': 'https://winkel.example', 'consumerKey': 'ck', 'consumerSecret': 'cs',
             'enabled': True}
    TOEGESTAAN = {'bron', 'gisting', 'sensoren', 'waarden', 'regels'}
    TANKREGEL = {'tank', 'bier', 'temp', 'koeling', 'verwarming'}

    @staticmethod
    def _inst(*aan, enabled=True, interval=60):
        return srv._website_instellingen({'enabled': enabled, 'interval_min': interval,
                                          'onderdelen': {k: True for k in aan}})

    @classmethod
    def _meting(cls, batch_id, temp, uren_geleden):
        t = datetime.datetime.fromtimestamp(cls.NU - uren_geleden * 3600)
        return {'batch_id': batch_id, 'datum': t.strftime('%Y-%m-%d'), 'tijd': t.strftime('%H:%M'), 'temp': temp}

    @classmethod
    def _data(cls, **extra):
        d = {
            'tanks': [{'id': 't1', 'naam': 'F1'}, {'id': 't2', 'naam': 'F2'}, {'id': 't3', 'naam': 'F3'}],
            'batches': [
                {'id': 1, 'naam': 'Session NEIPA', 'batch_nummer': '123', 'status': 'Vergisten',
                 'tank': 't2', 'liter_vergist': 500},
                {'id': 2, 'naam': 'Stout', 'batch_nummer': '124', 'status': 'Gepland', 'tank': 't1'},
                {'id': 3, 'naam': 'Pils', 'batch_nummer': '120', 'status': 'Afgevuld'},
                {'id': 4, 'naam': 'Blond', 'batch_nummer': '121', 'status': 'Gesloten'},
            ],
            'ha_instellingen': {'enabled': True, 'sensors': [
                {'id': 1, 'tank': 't1', 'entity': 'sensor.f1'},
                {'id': 2, 'tank': 't2', 'entity': 'sensor.f2'},
                {'id': 3, 'tank': 't3', 'entity': ''},
            ]},
            'gist_metingen': [],
            'tank_alarmen': [],
            'ingredienten': [{'id': 10, 'type': 'Hop'}, {'id': 11, 'type': 'Mout'}, {'id': 12, 'type': 'Gist'}],
            'lots': [
                {'id': 1, 'ingredient_id': 10, 'hoeveelheid': 2400, 'eenheid': 'g', 'beschikbaar': True},
                {'id': 2, 'ingredient_id': 10, 'hoeveelheid': 10, 'eenheid': 'kg', 'beschikbaar': True},
                {'id': 3, 'ingredient_id': 10, 'hoeveelheid': 5, 'eenheid': 'kg', 'beschikbaar': False},
                {'id': 4, 'ingredient_id': 10, 'hoeveelheid': 3, 'eenheid': 'pkg', 'beschikbaar': True},
                {'id': 5, 'ingredient_id': 11, 'hoeveelheid': 125, 'eenheid': 'kg', 'beschikbaar': True},
                {'id': 6, 'ingredient_id': 12, 'hoeveelheid': 1, 'eenheid': 'kg', 'beschikbaar': True},
            ],
            'afvullingen': [
                {'id': 50, 'batch_id': 1, 'hoeveelheid': 60, 'inhoud_per_eenheid': 0.33},
                {'id': 51, 'batch_id': 3, 'aantal': 10, 'inhoud_liter': 20},
            ],
            'verlies_registraties': [{'batch_id': 1, 'liter': 50.2}],
            'uitleveringen': [{'afvulling_id': 51, 'aantal': 4, 'datum': '2026-09-01'}],
            'verplaatsingen': [],
            'afboekingen': [],
            'locaties': [{'id': 1, 'naam': 'AGP', 'is_agp': True}],
            # Dit mag er nooit in terechtkomen.
            'klanten': [{'id': 1, 'naam': 'Geheim BV'}],
            'bestellingen': [{'id': 1, 'totaal': 999}],
        }
        d.update(extra)
        return d

    def _bericht(self, inst, data=None, live=None, bron='BrewAdmin 1.12.78'):
        return srv._website_bericht(inst, data or self._data(),
                                    {'sensor.f1': '4.0', 'sensor.f2': '2.44'} if live is None else live,
                                    self.NU, bron)

    # ── Instellingen ──────────────────────────────────────────────────────
    def test_instellingen_standaard_uit_en_interval_begrensd(self):
        leeg = srv._website_instellingen(None)
        assert leeg['enabled'] is False and leeg['interval_min'] == 60
        assert set(leeg['onderdelen']) == set(srv.WEBSITE_ONDERDELEN)
        assert not any(leeg['onderdelen'].values())
        assert srv._website_instellingen({'interval_min': 5})['interval_min'] == 15
        assert srv._website_instellingen({'interval_min': '999'})['interval_min'] == 240
        # Alleen een echte true zet iets aan.
        inst = srv._website_instellingen({'enabled': 'ja', 'onderdelen': {'gisting': 1, 'hop_kg': True, 'x': True}})
        assert inst['enabled'] is False and inst['onderdelen']['gisting'] is False
        assert inst['onderdelen']['hop_kg'] is True and 'x' not in inst['onderdelen']

    # ── Het bericht ───────────────────────────────────────────────────────
    def test_alles_uit_is_leeg_bericht(self):
        assert self._bericht(self._inst()) == {}
        # De hoofdschakelaar zelf zit niet in de pure functie: die kijkt naar
        # de onderdelen.
        assert self._bericht(self._inst(enabled=False)) == {}

    def test_schakelaars_worden_gerespecteerd(self):
        b = self._bericht(self._inst('hop_kg'))
        assert set(b) == {'bron', 'waarden'} and set(b['waarden']) == {'hop_kg'}
        b = self._bericht(self._inst('sensoren'))
        assert set(b) == {'bron', 'sensoren'}
        b = self._bericht(self._inst('gisting'))
        assert set(b) == {'bron', 'gisting'}
        b = self._bericht(self._inst('batches_gebrouwen', 'mout_kg'))
        assert set(b['waarden']) == {'batches_gebrouwen', 'mout_kg'}

    def test_gisting_alleen_volle_tanks_met_bier(self):
        b = self._bericht(self._inst('gisting'))
        assert b['gisting'] == [{'tank': 'F2', 'bier': '#123 Session NEIPA', 'temp': 2.4}]
        # Alles uit de tank (afgevuld + verlies) → lege tank, niet meesturen.
        data = self._data()
        data['afvullingen'].append({'id': 52, 'batch_id': 1, 'hoeveelheid': 1, 'inhoud_per_eenheid': 500})
        assert 'gisting' not in self._bericht(self._inst('gisting'), data)
        # Zonder naam en nummer is er geen bier → geen regel.
        data = self._data()
        data['batches'][0].update({'naam': '', 'batch_nummer': ''})
        assert 'gisting' not in self._bericht(self._inst('gisting'), data)
        # Zonder batchnummer alleen de naam; tank zonder naam → zijn id.
        data = self._data(tanks=[{'id': 't2'}])
        data['batches'][0]['batch_nummer'] = ''
        assert self._bericht(self._inst('gisting'), data)['gisting'][0] == \
            {'tank': 't2', 'bier': 'Session NEIPA', 'temp': 2.4}

    def test_temperatuur_live_dan_meting_hooguit_twee_uur_oud(self):
        data = self._data(gist_metingen=[self._meting(1, 18.24, 1.5), self._meting(1, 30, 5)])
        # Sensor onbereikbaar → laatste meting (anderhalf uur oud).
        b = self._bericht(self._inst('gisting'), data, live={'sensor.f2': 'unavailable'})
        assert b['gisting'][0]['temp'] == 18.2
        # Supervisor niet te bereiken → idem.
        assert 'temp' in self._bericht(self._inst('gisting'), data, live={})['gisting'][0]
        # Alleen een meting van drie uur oud → geen temperatuur.
        data = self._data(gist_metingen=[self._meting(1, 18.0, 3)])
        regel = self._bericht(self._inst('gisting'), data, live={'sensor.f2': 'unknown'})['gisting'][0]
        assert 'temp' not in regel
        # Een onzinwaarde van de sensor telt niet als temperatuur.
        regel = self._bericht(self._inst('gisting'), self._data(), live={'sensor.f2': '250'})['gisting'][0]
        assert 'temp' not in regel

    def test_sensorstatus(self):
        b = self._bericht(self._inst('sensoren'))
        assert b['sensoren'] == {'online': 2, 'totaal': 2}  # de lege entity telt niet mee
        b = self._bericht(self._inst('sensoren'), live={'sensor.f1': 'unavailable', 'sensor.f2': '3.1'})
        assert b['sensoren'] == {'online': 1, 'totaal': 2}
        b = self._bericht(self._inst('sensoren'), live={'sensor.f2': '3.1'})  # f1 niet te lezen
        assert b['sensoren'] == {'online': 1, 'totaal': 2}
        # Een open sensor_stil-alarm op de tank → niet online; een gesloten wel.
        alarmen = [{'tank': 't1', 'soort': 'sensor_stil', 'hersteld_op': None},
                   {'tank': 't2', 'soort': 'sensor_stil', 'hersteld_op': '2026-09-22T10:00:00+00:00'},
                   {'tank': 't2', 'soort': 'alarm', 'hersteld_op': None}]
        b = self._bericht(self._inst('sensoren'), self._data(tank_alarmen=alarmen))
        assert b['sensoren'] == {'online': 1, 'totaal': 2}
        # HA-sensoren uit → geen sensorblok (0/0 zegt niets).
        data = self._data()
        data['ha_instellingen']['enabled'] = False
        assert 'sensoren' not in self._bericht(self._inst('sensoren'), data)

    def test_voorraadwaarden(self):
        b = self._bericht(self._inst('hop_kg', 'mout_kg', 'liters_tank', 'liters_verpakt', 'batches_gebrouwen'))
        # Hop: 2400 g + 10 kg; niet beschikbaar en 'pkg' tellen niet.
        assert b['waarden']['hop_kg'] == 12.4
        assert b['waarden']['mout_kg'] == 125
        # Tank: 500 − 60 × 0,33 − 50,2 = 430.
        assert b['waarden']['liters_tank'] == 430
        # Verpakt: 60 × 0,33 (batch 1) + (10 − 4) × 20 (batch 3) = 139,8 → 140.
        assert b['waarden']['liters_verpakt'] == 140
        # Gebrouwen: Vergisten, Afgevuld, Gesloten — niet Gepland.
        assert b['waarden']['batches_gebrouwen'] == 3

    def test_grenzen_uit_het_contract(self):
        tanks = [{'id': f't{i}', 'naam': f'Fermentor nummer {i}'} for i in range(12)]
        batches = [{'id': 100 + i, 'naam': '<b>Heel</b> lange naam ' * 6, 'batch_nummer': str(i),
                    'status': 'Conditioneren', 'tank': f't{i}'} for i in range(12)]
        sensors = [{'id': i, 'tank': f't{i % 12}', 'entity': f'sensor.s{i}'} for i in range(1200)]
        data = self._data(tanks=tanks, batches=batches,
                          ha_instellingen={'enabled': True, 'sensors': sensors})
        live = {f'sensor.s{i}': '-45' for i in range(1200)}
        inst = self._inst(*srv.WEBSITE_ONDERDELEN)
        b = self._bericht(inst, data, live=live, bron='BrewAdmin ' + 'x' * 80)
        assert set(b) <= self.TOEGESTAAN
        assert len(b['bron']) <= 40
        assert len(b['gisting']) == 8
        for regel in b['gisting']:
            assert set(regel) <= self.TANKREGEL
            assert 0 < len(regel['tank']) <= 12 and 0 < len(regel['bier']) <= 60
            assert '<' not in regel['bier']
            assert 'temp' not in regel  # −45 °C ligt buiten −30…120
        s = b['sensoren']
        assert isinstance(s['online'], int) and isinstance(s['totaal'], int)
        assert 0 <= s['online'] <= s['totaal'] <= 999
        assert len(b['waarden']) <= 20
        for naam, waarde in b['waarden'].items():
            assert re.match(r'^[a-z0-9_]{1,32}$', naam)
            assert isinstance(waarde, (int, float)) or (isinstance(waarde, str) and len(waarde) <= 40)
        assert len(srv._website_json(b)) <= srv.WEBSITE_MAX_BYTES

    def test_nooit_andere_velden(self):
        b = self._bericht(self._inst(*srv.WEBSITE_ONDERDELEN))
        assert set(b) <= self.TOEGESTAAN
        assert set(b['waarden']) <= {'hop_kg', 'mout_kg', 'liters_tank', 'liters_verpakt', 'batches_gebrouwen'}
        assert set(b['sensoren']) == {'online', 'totaal'}
        for regel in b['gisting']:
            assert set(regel) <= self.TANKREGEL
        tekst = json.dumps(b)
        assert 'Geheim' not in tekst and '999' not in tekst

    # ── Voorraad per locatie (spiegel van voorraadPerLocatie) ─────────────
    def test_voorraad_per_locatie(self):
        locs = [{'id': 1, 'is_agp': True}, {'id': 2}]
        afv = {'id': 7, 'hoeveelheid': 10}
        vpl = srv._voorraad_per_locatie
        assert vpl(afv, locs, [], [], []) == {'1': 10}
        verpl = [{'afvulling_id': 7, 'van_locatie_id': 1, 'naar_locatie_id': 2, 'aantal': 4, 'datum': '2026-01-02'}]
        uit = [{'afvulling_id': 7, 'aantal': 3, 'datum': '2026-01-03', 'bron_locatie_id': 2}]
        assert vpl(afv, locs, uit, verpl, []) == {'1': 6, '2': 1}
        # Een verplaatsing wordt gecapt op wat er op de bron staat.
        verpl2 = [{'afvulling_id': 7, 'van_locatie_id': 1, 'naar_locatie_id': 2, 'aantal': 50, 'datum': '2026-01-02'}]
        assert vpl(afv, locs, [], verpl2, []) == {'1': 0, '2': 10}
        # Afboeking zonder locatie die niet op de AGP past → schuift door.
        afb = [{'afvulling_id': 7, 'aantal': 8, 'datum': '2026-01-05'}]
        assert vpl(afv, locs, [], verpl, afb) == {'1': 0, '2': 2}
        # Met locatie: alleen van die locatie, geen doorschuif.
        afb2 = [{'afvulling_id': 7, 'aantal': 8, 'datum': '2026-01-05', 'bron_locatie_id': 2}]
        assert vpl(afv, locs, [], verpl, afb2) == {'1': 6, '2': 0}
        # Chronologisch: een uitlevering vóór de verplaatsing gaat eerst.
        uit_vroeg = [{'afvulling_id': 7, 'aantal': 8, 'datum': '2026-01-01'}]
        assert vpl(afv, locs, uit_vroeg, verpl, []) == {'1': 0, '2': 2}
        # Andere afvullingen tellen niet; geen locaties → synthetische AGP.
        assert vpl(afv, [], [{'afvulling_id': 8, 'aantal': 5}], [], []) == {'1': 10}

    def test_voorraad_per_locatie_bijboeking(self):
        # Inventarisatie-overschot = afboeking met negatief aantal: die flesjes
        # komen erbij (net als voorraadPerLocatie in calculations.ts), anders
        # zijn ze nooit uit te slaan of te verkopen.
        locs = [{'id': 1, 'is_agp': True}, {'id': 2}]
        afv = {'id': 7, 'hoeveelheid': 24}
        vpl = srv._voorraad_per_locatie
        assert vpl(afv, locs, [], [], [{'afvulling_id': 7, 'aantal': -2, 'datum': '2026-01-05'}]) == {'1': 26}
        # Mét locatie: op die locatie erbij.
        afb = [{'afvulling_id': 7, 'aantal': -3, 'datum': '2026-01-05', 'bron_locatie_id': 2}]
        assert vpl(afv, locs, [], [], afb) == {'1': 24, '2': 3}
        # Daarna is alles verplaatsbaar.
        verpl = [{'afvulling_id': 7, 'van_locatie_id': 1, 'naar_locatie_id': 2, 'aantal': 26, 'datum': '2026-01-06'}]
        assert vpl(afv, locs, [], verpl, [{'afvulling_id': 7, 'aantal': -2, 'datum': '2026-01-05'}]) == {'1': 0, '2': 26}
        # Een negatieve verplaatsing of uitlevering blijft genegeerd.
        verpl_neg = [{'afvulling_id': 7, 'van_locatie_id': 1, 'naar_locatie_id': 2, 'aantal': -5, 'datum': '2026-01-06'}]
        assert vpl(afv, locs, [{'afvulling_id': 7, 'aantal': -4, 'datum': '2026-01-06'}], verpl_neg, []) == {'1': 24}

    # ── _wc_request ───────────────────────────────────────────────────────
    def test_wc_request_bouwt_zonder_api_pad_hetzelfde_adres(self, monkeypatch):
        gezien = []

        class _Resp:
            status = 200
            def __enter__(self):
                return self
            def __exit__(self, *a):
                return False
            def read(self):
                return b'{}'

        def fake(req, timeout=None):
            gezien.append((req.full_url, req.get_method()))
            return _Resp()

        monkeypatch.setattr(srv.urllib.request, 'urlopen', fake)
        creds = {'url': 'https://winkel.example', 'key': 'ck', 'secret': 'cs'}
        srv._wc_request(creds, 'GET', 'products?per_page=1')
        srv._wc_request(creds, 'POST', 'products', b'{}', herkansing=False)
        srv._wc_request(creds, 'POST', 'brouwerij', b'{}', herkansing=False, api_pad=srv.WEBSITE_API_PATH)
        assert gezien == [
            ('https://winkel.example/wp-json/wc/v3/products?per_page=1', 'GET'),
            ('https://winkel.example/wp-json/wc/v3/products', 'POST'),
            ('https://winkel.example/wp-json/wc-craftery/v1/brouwerij', 'POST'),
        ]

    def test_foutcodes(self):
        assert srv._website_fout(401, b'{"code":"woocommerce_rest_authentication_error"}')['code'] == 'sleutel'
        assert srv._website_fout(403, b'{"code":"crfb_geen_toegang"}')['code'] == 'rechten'
        assert srv._website_fout(404, b'{"code":"rest_no_route"}')['code'] == 'plugin'
        assert srv._website_fout(413, b'')['code'] == 'te_groot'
        assert srv._website_fout(429, b'')['code'] == 'te_snel'
        assert srv._website_fout(400, b'')['code'] == 'ongeldig'
        f = srv._website_fout(504, b'{"oorzaak":"timeout"}')
        assert f['code'] == 'netwerk' and f['oorzaak'] == 'timeout'
        assert srv._website_fout(500, b'<html>')['code'] == 'http'
        a = srv._website_antwoord(json.dumps({
            'ok': True, 'versie': '1.1.0', 'ontvangen': '2026-09-22T19:06:18+00:00', 'vers': True,
            'max_leeftijd': 10800, 'regels': ['<i>gisting</i> · F2'] * 20, 'plaatshouders': ['hop_kg']}).encode())
        assert a['versie'] == '1.1.0' and a['max_leeftijd'] == 10800 and a['vers'] is True
        assert len(a['regels']) == 8 and a['regels'][0] == 'gisting · F2'
        assert srv._website_antwoord(b'[]') == {}

    # ── De loop ───────────────────────────────────────────────────────────
    @staticmethod
    def _seed(inst=None, creds=None, status=None):
        for k in ('website_telemetrie', 'woocommerce_creds', 'website_telemetrie_status'):
            TestWebsiteTelemetrie._wis(k)
        if inst is not None:
            srv._write_json('website_telemetrie', inst)
        if creds is not None:
            srv._write_json('woocommerce_creds', creds)
        if status is not None:
            srv._write_json('website_telemetrie_status', status)
        srv._website_laatste_poging = 0.0
        srv._website_laatste_verzending = 0.0

    @staticmethod
    def _wis(key):
        conn = srv._db()
        with conn:
            conn.execute('DELETE FROM kv WHERE key=?', (key,))
            conn.execute('DELETE FROM versies WHERE key=?', (key,))

    def _nep_winkel(self, monkeypatch, status=200, antwoord=None):
        verzonden = []

        def fake(creds, method, subpath, body=None, herkansing=True, api_pad=srv.WC_API_PATH):
            verzonden.append({'method': method, 'subpath': subpath, 'api_pad': api_pad,
                              'herkansing': herkansing, 'body': json.loads(body) if body else None})
            return status, json.dumps(antwoord if antwoord is not None else
                                      {'ok': True, 'versie': '1.1.0', 'max_leeftijd': 10800,
                                       'regels': ['sensoren online: 2/2']}).encode()

        monkeypatch.setattr(srv, '_wc_request', fake)
        monkeypatch.setattr(srv, '_website_bericht_nu',
                            lambda inst: {'bron': 'BrewAdmin t', 'waarden': {'hop_kg': 1}}
                            if any(inst['onderdelen'].values()) else {})
        return verzonden

    def test_loop_verstuurt_niets_als_hij_uit_staat(self, app, monkeypatch):
        verzonden = self._nep_winkel(monkeypatch)
        try:
            # Uit, maar met onderdelen en WooCommerce.
            self._seed(inst={'enabled': False, 'onderdelen': {'hop_kg': True}}, creds=self.CREDS)
            srv._website_tick(force=True)
            # Aan, maar geen enkel onderdeel.
            self._seed(inst={'enabled': True, 'onderdelen': {}}, creds=self.CREDS)
            srv._website_tick(force=True)
            # Nooit ingesteld.
            self._seed(creds=self.CREDS)
            srv._website_tick(force=True)
            assert verzonden == []
            assert srv._read_json('website_telemetrie_status') is None
        finally:
            self._seed()

    def test_loop_verstuurt_niets_zonder_woocommerce(self, app, monkeypatch):
        verzonden = self._nep_winkel(monkeypatch)
        inst = {'enabled': True, 'onderdelen': {'hop_kg': True}}
        try:
            self._seed(inst=inst)
            srv._website_tick(force=True)
            self._seed(inst=inst, creds=dict(self.CREDS, consumerSecret=''))
            srv._website_tick(force=True)
            self._seed(inst=inst, creds=dict(self.CREDS, storeUrl='http://winkel.example'))
            srv._website_tick(force=True)
            self._seed(inst=inst, creds=dict(self.CREDS, enabled=False))
            srv._website_tick(force=True)
            assert verzonden == []
        finally:
            self._seed()

    def test_loop_verstuurt_eenmaal_per_interval_en_ruimt_op(self, app, monkeypatch):
        verzonden = self._nep_winkel(monkeypatch)
        try:
            self._seed(inst={'enabled': True, 'interval_min': 60, 'onderdelen': {'hop_kg': True}},
                       creds=self.CREDS)
            srv._website_tick(now=1_000_000)
            assert len(verzonden) == 1
            v = verzonden[0]
            assert v['method'] == 'POST' and v['subpath'] == 'brouwerij'
            assert v['api_pad'] == '/wp-json/wc-craftery/v1' and v['herkansing'] is False
            assert v['body'] == {'bron': 'BrewAdmin t', 'waarden': {'hop_kg': 1}}
            st = srv._read_json('website_telemetrie_status')
            assert st['gelukt'] is True and st['op_site'] is True and st['fout'] is None
            assert st['antwoord']['regels'] == ['sensoren online: 2/2']
            # Binnen het interval: niets.
            srv._website_laatste_verzending = 0.0
            srv._website_tick(now=1_000_000 + 30 * 60)
            assert len(verzonden) == 1
            # Uitgezet terwijl er iets op de site staat → één leeg bericht.
            srv._write_json('website_telemetrie', {'enabled': False, 'onderdelen': {'hop_kg': True}})
            srv._website_tick(now=1_000_000 + 31 * 60)
            assert len(verzonden) == 2 and verzonden[1]['body'] == {}
            assert srv._read_json('website_telemetrie_status')['op_site'] is False
            # Daarna blijft hij stil.
            srv._website_laatste_verzending = 0.0
            srv._website_tick(force=True)
            assert len(verzonden) == 2
        finally:
            self._seed()

    def test_mislukte_poging_legt_de_reden_vast(self, app, monkeypatch):
        self._nep_winkel(monkeypatch, status=404, antwoord={'code': 'rest_no_route'})
        try:
            self._seed(inst={'enabled': True, 'onderdelen': {'hop_kg': True}}, creds=self.CREDS)
            uitkomst = srv._website_tick(force=True)
            assert uitkomst['ok'] is False and uitkomst['fout']['code'] == 'plugin'
            st = srv._read_json('website_telemetrie_status')
            assert st['gelukt'] is False and st['fout']['code'] == 'plugin' and 'laatst_gelukt' not in st
        finally:
            self._seed()

    # ── Endpoints ─────────────────────────────────────────────────────────
    def test_endpoints_voorbeeld_en_versturen(self, app, monkeypatch):
        verzonden = self._nep_winkel(monkeypatch)
        try:
            self._seed(creds=self.CREDS)
            status, body, _ = req(app, 'POST', '/api/website/voorbeeld', body={})
            assert status == 200 and body['bericht'] == {} and body['max_bytes'] == 8192
            status, body, _ = req(app, 'POST', '/api/website/voorbeeld',
                                  body={'instellingen': {'onderdelen': {'hop_kg': True}}})
            assert status == 200 and body['bericht']['waarden'] == {'hop_kg': 1}
            # Versturen terwijl hij uit staat → 409, niets verstuurd.
            status, body, _ = req(app, 'POST', '/api/website/verstuur', body={})
            assert status == 409 and verzonden == []
            status, body, _ = req(app, 'POST', '/api/website/verstuur',
                                  body={'instellingen': {'enabled': True, 'onderdelen': {'hop_kg': True}}})
            assert status == 200 and body['ok'] is True and len(verzonden) == 1
            # Nog eens binnen tien seconden → de app houdt hem zelf tegen.
            status, body, _ = req(app, 'POST', '/api/website/verstuur',
                                  body={'instellingen': {'enabled': True, 'onderdelen': {'hop_kg': True}}})
            assert body['ok'] is False and body['fout']['code'] == 'te_snel' and len(verzonden) == 1
            assert req(app, 'POST', '/api/website/voorbeeld', body=b'[1]')[0] == 400
        finally:
            self._seed()

    def test_endpoint_test_leest_alleen(self, app, monkeypatch):
        verzonden = self._nep_winkel(monkeypatch, antwoord={'versie': '1.1.0', 'ontvangen': None,
                                                            'vers': False, 'max_leeftijd': 10800})
        try:
            self._seed(creds=self.CREDS)
            status, body, _ = req(app, 'POST', '/api/website/test', body={})
            assert status == 200 and body['ok'] is True and body['antwoord']['versie'] == '1.1.0'
            assert [v['method'] for v in verzonden] == ['GET']
            assert srv._read_json('website_telemetrie_status') is None
            self._seed()
            status, body, _ = req(app, 'POST', '/api/website/test', body={})
            assert body['ok'] is False and body['fout']['code'] == 'geen_wc'
        finally:
            self._seed()

    def test_alleen_beheer(self, app, monkeypatch):
        verzonden = self._nep_winkel(monkeypatch)
        admin = {'X-Remote-User-Name': 'admin'}
        assert req(app, 'POST', '/api/data/gebruikers_rollen',
                   body={'gebruikers': {'admin': 'beheer', 'piet': 'productie'}}, headers=admin)[0] == 200
        try:
            self._seed(creds=self.CREDS)
            piet = {'X-Remote-User-Name': 'piet'}
            for pad in ('/api/website/voorbeeld', '/api/website/test', '/api/website/verstuur'):
                assert req(app, 'POST', pad, body={}, headers=piet)[0] == 403
            for key in ('website_telemetrie', 'website_telemetrie_status'):
                assert req(app, 'POST', f'/api/data/{key}', body={}, headers=piet)[0] == 403
                assert req(app, 'POST', f'/api/data/{key}', body=[], headers=admin)[0] == 422
            assert verzonden == []
        finally:
            assert req(app, 'POST', '/api/data/gebruikers_rollen', body={}, headers=admin)[0] == 200
            self._seed()

    def test_bron_uit_config_yaml(self):
        versie = re.search(r'^version:\s*"([^"]+)"', (Path(srv.__file__).parent / 'config.yaml').read_text(), re.M)
        assert srv._app_versie() == versie.group(1)
