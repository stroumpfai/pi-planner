#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

source "$SCRIPT_DIR/backend/venv/bin/activate"

# Load .env from project root if present
if [[ -f "$SCRIPT_DIR/.env" ]]; then
  set -a
  source "$SCRIPT_DIR/.env"
  set +a
fi

: "${SONAR_TOKEN:?SONAR_TOKEN environment variable is required}"

pysonar \
  --sonar-host-url=http://localhost:9000 \
  --sonar-token="$SONAR_TOKEN" \
  --sonar-project-key=pi-planner \
  -Dsonar.exclusions="design/**,frontend/src/types/api.generated.ts,backend/migrations/**"
