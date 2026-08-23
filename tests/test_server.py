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
import hashlib
import http.client
import http.server
import io
import json
import re
import socket
import ssl
import threading
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
        # POST met sentinel + gewijzigde host → geheim blijft opgeslagen
        status, _, _ = req(app, 'POST', '/api/data/smtp_creds',
                           body={'host': 'nieuw.x', 'password': srv._SECRET_SENTINEL})
        assert status == 200
        opgeslagen = srv._read_json('smtp_creds')
        assert opgeslagen == {'host': 'nieuw.x', 'password': 'supergeheim'}

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
            httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
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

    # ── De tick en de alarmadministratie ────────────────────────────────────

    @staticmethod
    def _clean():
        conn = srv._db()
        with conn:
            for key in ('batches', 'gist_metingen', 'tank_alarmen'):
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
