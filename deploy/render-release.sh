#!/usr/bin/env bash
# Render local files only. Never contacts the cluster.
set -euo pipefail
release_sha=${1:?Usage: render-release.sh FULL_COMMIT_SHA EMPTY_OUTPUT_DIR}
output_dir=${2:?Output directory required}
[[ "$release_sha" =~ ^[0-9a-f]{40}$ ]] || { echo 'Expected a full lowercase Git SHA' >&2; exit 1; }
[[ ! -e "$output_dir" ]] || { echo 'Output directory must not exist' >&2; exit 1; }
deploy_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
mkdir -p "$output_dir/bootstrap" "$output_dir/workloads"
for source in "$deploy_dir"/k8s/*.yaml; do
  name=$(basename "$source")
  case "$name" in
    00-namespace.yaml|05-configmap.yaml) target="$output_dir/bootstrap/$name" ;;
    *) target="$output_dir/workloads/$name" ;;
  esac
  sed "s/IMAGE_TAG/sha-$release_sha/g" "$source" > "$target"
done
sed "s/IMAGE_TAG/sha-$release_sha/g" "$deploy_dir/jobs/api-migrate-job.yaml" > "$output_dir/migration.yaml"
