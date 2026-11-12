#!/bin/sh
# Reload the viewer after certbot rotates the existing host certificate.
set -eu
if docker inspect mlog-visualizer >/dev/null 2>&1; then
    docker exec mlog-visualizer nginx -t
    docker exec mlog-visualizer nginx -s reload
fi
