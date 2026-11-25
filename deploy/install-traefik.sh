#!/usr/bin/env bash
# Runs on the server, from the unpacked release:
#   PLAY_DOMAIN=play.example.org RELEASE=<commit> TRAEFIK=<container> bash deploy/install-traefik.sh
# A release that was built before is used again, not rebuilt, so the same command with an old RELEASE goes back.
# Remove: docker network disconnect opengames-edge <container>; docker compose -p opengames down
# (the leaderboards stay in the volume opengames_data)
# If somebody recreates the Traefik container, run this again: the new one is not on opengames-edge.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${PLAY_DOMAIN:?}" "${RELEASE:?}" "${TRAEFIK:?}"
export PLAY_DOMAIN RELEASE
MIN_FREE_MB=4000
compose() { docker compose -f deploy/compose.traefik.yml "$@"; }
stop() { echo "STOP: $1" >&2; exit 1; }

# 1. Is there room, and is nothing else in the way?
free_mb=$(df -Pm "$(docker info -f '{{.DockerRootDir}}')" | awk 'NR==2 {print $4}')
[ "$free_mb" -ge "$MIN_FREE_MB" ] || stop "only $free_mb MB free on the disk"
docker inspect "$TRAEFIK" >/dev/null 2>&1 || stop "no container called $TRAEFIK"
if [ -z "$(docker ps -q --filter label=com.docker.compose.project=opengames)" ] && [ -n "$(ss -lunH 'sport = :3478')" ]; then stop "UDP port 3478 is in use"; fi

# 2. Build before touching anything that runs.
docker image inspect "opengames-server:$RELEASE" >/dev/null 2>&1 || compose build

# 3. Start, and let Traefik reach this one network. Traefik is not restarted.
previous=$(docker ps --filter label=com.docker.compose.project=opengames --format '{{.Image}}' | sed -n '1s/^opengames-server://p')
failed() {
  compose logs --tail 30 server >&2 || true
  if [ -n "$previous" ] && [ "$previous" != "$RELEASE" ]; then
    RELEASE=$previous compose up -d --no-build && stop "$1. Went back to $previous"
  fi
  stop "$1. There is no earlier release to go back to"
}
compose up -d --no-build || failed "the server did not start"
id=$(compose ps -aq server)
[ -n "$id" ] || failed "there is no server container"
on_edge() { [ -n "$(docker inspect -f '{{with index .NetworkSettings.Networks "opengames-edge"}}yes{{end}}' "$TRAEFIK")" ]; }
on_edge || docker network connect opengames-edge "$TRAEFIK"

# 4. Does it answer, inside and through Traefik?
for _ in $(seq 1 30); do
  state=$(docker inspect -f '{{.State.Health.Status}}' "$id"); [ "$state" = healthy ] && break; sleep 2
done
[ "$state" = healthy ] || failed "the server is $state"
for _ in $(seq 1 30); do
  code=$(curl -s -o /dev/null -m 5 -w '%{http_code}' ${CURL_OPTIONS:+"$CURL_OPTIONS"} --resolve "$PLAY_DOMAIN:443:127.0.0.1" "https://$PLAY_DOMAIN/health" || true); [ "$code" = 200 ] && break; sleep 3
done
# Not a reason to go back: the server is well, so it is the name, the certificate or Traefik.
[ "$code" = 200 ] || stop "the server runs, but https://$PLAY_DOMAIN/health gave $code. Is the name pointing here?"
echo "OK $RELEASE at https://$PLAY_DOMAIN; before: ${previous:-none}"
