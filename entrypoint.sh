#!/bin/sh
# Fix /data permissions (HA mounts the volume as root at runtime)
# then drop to non-root appuser before starting the server.
chown -R appuser:appuser /data
# Off-volume backupdoel (ERP-plan 0.5): /backup wordt door HA als root
# gemount; maak de addon-submap aan en geef appuser er schrijfrechten,
# anders faalt de dagelijkse offsite-ZIP met Permission denied. Alleen
# de eigen submap chown'en — nooit heel /backup (bevat HA-snapshots).
if [ -d /backup ]; then
    mkdir -p /backup/brewadmin
    chown appuser:appuser /backup/brewadmin
fi
exec su-exec appuser python3 /app/server.py
