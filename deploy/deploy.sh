#!/usr/bin/env bash
# Pull, build and restart LensIQ on Voyager. Installed at ~/apps/lensiq/deploy.sh.
set -euo pipefail
cd ~/src/lensiq
git pull --ff-only
docker build -t lensiq:latest .
cd ~/apps/lensiq
docker compose up -d --force-recreate app
docker image prune -f
docker compose ps
