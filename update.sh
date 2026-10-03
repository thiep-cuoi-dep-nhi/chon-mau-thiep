#!/usr/bin/env bash
set -euo pipefail

template="${1:-1}"
if [ "$#" -gt 0 ]; then shift; fi
case "$template" in
  1|2|3|4|5|6) node "deploy-mau${template}.mjs" "$@" ;;
  *)
    echo "Cách dùng: ./update.sh [1|2|3|4|5|6] [--dry-run|--info /duong-dan/info.json]" >&2
    exit 1
    ;;
esac
