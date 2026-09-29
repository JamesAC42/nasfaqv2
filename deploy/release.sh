#!/usr/bin/env bash
# Mutates production: run only as an authorized release of a validated revision.
set -euo pipefail
release_sha=${1:?Usage: release.sh FULL_COMMIT_SHA KUBE_CONTEXT EXPECTED_API_SERVER}
kube_context=${2:?Explicit Kubernetes context required}
expected_server=${3:?Expected production API server required}
[[ "$release_sha" =~ ^[0-9a-f]{40}$ ]] || { echo 'Expected a full lowercase Git SHA' >&2; exit 1; }
deploy_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
release_tmp=$(mktemp -d)
kube=(kubectl --context "$kube_context" --request-timeout=30s)
# Set once games are paused for this release; if the release then fails, reopen them on the way out
# (without announcing the version, which may not be fully live).
games_paused=0
finish() {
  local status=$?
  if (( games_paused )); then
    "${kube[@]}" -n nasfaq apply -f "$release_tmp/rendered/abort.yaml" || true
    "${kube[@]}" -n nasfaq wait --for=condition=complete --timeout=180s "job/api-abort-sha-$release_sha" || true
  fi
  rm -rf -- "$release_tmp"
  exit "$status"
}
trap finish EXIT
bash "$deploy_dir/render-release.sh" "$release_sha" "$release_tmp/rendered"
# Fail closed if a local alias points at a different cluster.
server=$("${kube[@]}" config view --minify -o 'jsonpath={.clusters[0].cluster.server}')
[[ "$expected_server" == https://* && "$server" == "$expected_server" ]] || {
  echo 'Refusing release: context does not target the NASFAQ production cluster' >&2; exit 1;
}
"${kube[@]}" apply -f "$release_tmp/rendered/bootstrap/"
"${kube[@]}" -n nasfaq apply -f "$release_tmp/rendered/migration.yaml"
"${kube[@]}" -n nasfaq wait --for=condition=complete --timeout=300s "job/api-migrate-sha-$release_sha"
# Game tables live in api-games's memory, and restarting it refunds whatever is unfinished. Pause new
# games and let the ones in play finish first (up to 10 minutes). Best effort: if the drain can't
# finish, the release goes ahead and the restart refunds, as it always has.
games_paused=1
"${kube[@]}" -n nasfaq apply -f "$release_tmp/rendered/drain.yaml"
"${kube[@]}" -n nasfaq wait --for=condition=complete --timeout=900s "job/api-drain-sha-$release_sha" \
  || echo 'Games did not finish draining; releasing anyway (the restart refunds them)' >&2
# No application Deployment is touched until migrations have succeeded.
"${kube[@]}" apply -f "$release_tmp/rendered/workloads/"
for deployment in api-web api-scheduler api-games app-client holonews superchatscraper ytscraper nasfaq-redis; do
  "${kube[@]}" -n nasfaq rollout status "deployment/$deployment" --timeout=300s
done
curl --fail --silent --show-error --connect-timeout 10 --max-time 20 --retry 3 \
  https://holo.nasfaq.biz/api/health
# Live: reopen games and announce the version, so open pages offer a refresh.
"${kube[@]}" -n nasfaq apply -f "$release_tmp/rendered/reopen.yaml"
"${kube[@]}" -n nasfaq wait --for=condition=complete --timeout=180s "job/api-reopen-sha-$release_sha"
games_paused=0
