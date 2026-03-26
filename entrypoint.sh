#!/bin/sh
# Fix /data permissions (HA mounts the volume as root at runtime)
# then drop to non-root appuser before starting the server.
chown -R appuser:appuser /data
exec su-exec appuser python3 /app/server.py
