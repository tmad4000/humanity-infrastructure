#!/bin/bash
set -euo pipefail
python3 scripts/build.py
exec /home/dev/.local/bin/wrangler-gcp deploy "$@"
