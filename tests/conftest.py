# Vóór het importeren van server.py (dat bij import zijn datamappen aanmaakt)
# DATA_DIR naar een schrijfbare tijdelijke map wijzen. Zonder dit faalt de
# testcollectie met PermissionError op omgevingen zonder rechten op /data,
# zoals GitHub Actions-runners. De app-fixture in test_server.py wijst de
# mappen daarna alsnog naar zijn eigen tmp_path.
import os
import tempfile

os.environ.setdefault('BREWADMIN_DATA_DIR', tempfile.mkdtemp(prefix='brewadmin-test-data-'))
