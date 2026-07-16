# pytest-suite voor server.py (ERP-plan 3.2).
#
# Twee lagen:
#  1. unit-tests op de pure helpers (key-/upload-validatie, schemavalidatie,
#     append-only-guard, secrets-maskering, atomic write);
#  2. integratietests tegen een échte ThreadingHTTPServer op een efemere
#     poort met een tijdelijke DATA_DIR — de 409/422-paden, /api/commit,
#     /api/nextnr (atomair onder parallelle clients), rate-limiting en upload.
#
# Draaien: python3 -m pytest

import base64
import http.client
import http.server
import json
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
    httpd = http.server.ThreadingHTTPServer(('127.0.0.1', 0), srv.BrouwerijHandler)
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
        pad = srv.DATA_DIR / 'journaal.json'
        pad.write_text(json.dumps([{'id': 1, 'netto_cent': 100}]))
        # aanvullen mag
        assert srv._append_only_ok('journaal', [{'id': 1, 'netto_cent': 100}, {'id': 2}])
        # muteren en weglaten niet
        assert not srv._append_only_ok('journaal', [{'id': 1, 'netto_cent': 999}])
        assert not srv._append_only_ok('journaal', [{'id': 2}])
        assert not srv._append_only_ok('journaal', [])
        # niet-append-only keys blijven vrij
        assert srv._append_only_ok('batches', [])
        pad.unlink()

    def test_ontbrekend_bestand_blokkeert_niet(self, app):
        assert srv._append_only_ok('journaal', [{'id': 1}])


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
        assert json.loads((srv.DATA_DIR / 'tanks.json').read_text()) == [{'id': 1}, {'id': 2}]

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
        assert json.loads((srv.DATA_DIR / 'lots.json').read_text()) == [{'id': 1}]

    def test_commit_conflict_schrijft_niets(self, app):
        req(app, 'POST', '/api/data/verpakkingen', body=[{'id': 1}])
        status, body, _ = req(app, 'POST', '/api/commit', body={
            'data': {'verpakkingen': [], 'onderdelen': [{'id': 9}]},
            'versions': {'verpakkingen': 'verouderde-hash'},
        })
        assert status == 409
        assert 'verpakkingen' in body['conflicts']
        assert json.loads((srv.DATA_DIR / 'verpakkingen.json').read_text()) == [{'id': 1}]
        assert not (srv.DATA_DIR / 'onderdelen.json').exists()

    def test_commit_appendonly_schending_schrijft_niets(self, app):
        # Zorg (volgorde-onafhankelijk) dat het journaal een regel heeft;
        # leegmaken via commit moet dan integraal geweigerd worden.
        (srv.DATA_DIR / 'journaal.json').write_text(json.dumps([{'id': 900}]))
        status, body, _ = req(app, 'POST', '/api/commit', body={
            'data': {'journaal': [], 'artikelen': [{'id': 3}]},
        })
        assert status == 422 and body['key'] == 'journaal'
        assert not (srv.DATA_DIR / 'artikelen.json').exists()

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
        # POST met sentinel + gewijzigde host → geheim blijft op disk staan
        status, _, _ = req(app, 'POST', '/api/data/smtp_creds',
                           body={'host': 'nieuw.x', 'password': srv._SECRET_SENTINEL})
        assert status == 200
        op_disk = json.loads((srv.DATA_DIR / 'smtp_creds.json').read_text())
        assert op_disk == {'host': 'nieuw.x', 'password': 'supergeheim'}

    def test_audit_log_wordt_server_side_geschreven(self, app):
        req(app, 'POST', '/api/data/recepten', body=[{'id': 1}])
        logs = list(srv.AUDIT_DIR.glob('audit_*.jsonl'))
        assert logs, 'server-audit ontbreekt'
        regels = [json.loads(r) for r in logs[0].read_text().splitlines() if r.strip()]
        assert any(r.get('key') == 'recepten' for r in regels)
