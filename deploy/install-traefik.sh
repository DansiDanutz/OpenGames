#!/usr/bin/env bash
# Runs on the server, from the unpacked release:
#   PLAY_DOMAIN=play.example.org RELEASE=<commit> TRAEFIK=<container> bash deploy/install-traefik.sh
# Undo: docker network disconnect opengames-edge <container>; docker compose -p opengames down
# (the leaderboards stay in the volume opengames_data)
set -euo pipefail
: "${PLAY_DOMAIN:?}" "${RELEASE:?}" "${TRAEFIK:?}"
export PLAY_DOMAIN RELEASE
MIN_FREE_MB=4000
compose() { docker compose -f deploy/compose.traefik.yml "$@"; }
stop() { echo "STOP: $1" >&2; exit 1; }

# 1. Is there room, and is nothing else in the way?
free_mb=$(df -Pm / | awk 'NR==2 {print $4}')
[ "$free_mb" -ge "$MIN_FREE_MB" ] || stop "only $free_mb MB free on the disk"
docker inspect "$TRAEFIK" >/dev/null 2>&1 || stop "no container called $TRAEFIK"
if [ -z "$(docker ps -q --filter label=com.docker.compose.project=opengames)" ] && ss -lunH | awk '{print $4}' | grep -qE ':3478$'; then stop "UDP port 3478 is in use"; fi

# 2. Build before touching anything that runs.
compose build

# 3. Start, and let Traefik reach this one network. Traefik is not restarted.
previous=$(docker ps --filter label=com.docker.compose.project=opengames --format '{{.Image}}' | head -1)
compose up -d --no-build
id=$(compose ps -q server)
docker network inspect opengames-edge --format '{{range .Containers}}{{println .Name}}{{end}}' | grep -qx "$TRAEFIK" || docker network connect opengames-edge "$TRAEFIK"

# 4. Does it answer, inside and through Traefik?
for _ in $(seq 1 30); do
  state=$(docker inspect -f '{{.State.Health.Status}}' "$id"); [ "$state" = healthy ] && break; sleep 2
done
[ "$state" = healthy ] || { compose logs --tail 30 server; stop "the server is $state; the image before was: ${previous:-none}"; }
for _ in $(seq 1 30); do
  code=$(curl -s -o /dev/null -m 5 -w '%{http_code}' ${CURL_OPTIONS:-} --resolve "$PLAY_DOMAIN:443:127.0.0.1" "https://$PLAY_DOMAIN/health" || true); [ "$code" = 200 ] && break; sleep 3
done
[ "$code" = 200 ] || stop "the server runs, but https://$PLAY_DOMAIN/health gave $code. Is the name pointing here?"
echo "OK $RELEASE at https://$PLAY_DOMAIN; the image before was: ${previous:-none}"
