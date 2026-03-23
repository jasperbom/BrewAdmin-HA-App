FROM python:3.12-alpine

WORKDIR /app

COPY server.py .
COPY dist/index.html ./static/index.html
COPY entrypoint.sh /entrypoint.sh

# su-exec: lichtgewicht tool om na rechten-fix naar non-root te wisselen.
# /data wordt aangemaakt maar HA overschrijft het volume bij runtime —
# entrypoint.sh herstelt de eigenaar dan alsnog vóór de proces-switch.
RUN apk add --no-cache su-exec \
 && adduser -D -H -s /sbin/nologin appuser \
 && mkdir -p /data \
 && chmod 644 /app/server.py /app/static/index.html \
 && chmod +x /entrypoint.sh

EXPOSE 8099

# Entrypoint draait als root, repareert /data-rechten, daarna su-exec → appuser
CMD ["/entrypoint.sh"]
