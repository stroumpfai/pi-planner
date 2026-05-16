#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

source "$SCRIPT_DIR/backend/venv/bin/activate"

pysonar \
  --sonar-host-url=http://localhost:9000 \
  --sonar-token=sqp_8023479f1bd3ca7b785d2f37c61579715551e5be \
  --sonar-project-key=pi-planner
