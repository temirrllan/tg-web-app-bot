#!/usr/bin/env bash
# ============================================================================
# Apply ai_readonly role setup
# ============================================================================
# Reads $AI_DB_PASSWORD from env and applies setup-ai-readonly.sql
#
# Usage:
#   AI_DB_PASSWORD='strong-password' DATABASE_URL='postgres://...' \
#     ./scripts/setup-ai-readonly.sh
#
# Or with individual vars (DB_HOST, DB_USER, etc.) — same as backend uses.
# ============================================================================

set -euo pipefail

if [ -z "${AI_DB_PASSWORD:-}" ]; then
  echo "❌ AI_DB_PASSWORD env var is required (≥32 chars recommended)" >&2
  exit 1
fi

if [ ${#AI_DB_PASSWORD} -lt 16 ]; then
  echo "⚠️  AI_DB_PASSWORD is shorter than 16 chars — consider longer for production" >&2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_FILE="$SCRIPT_DIR/setup-ai-readonly.sql"

if [ ! -f "$SQL_FILE" ]; then
  echo "❌ $SQL_FILE not found" >&2
  exit 1
fi

# Build psql connection args (DATABASE_URL takes priority)
if [ -n "${DATABASE_URL:-}" ]; then
  PSQL_ARGS=("$DATABASE_URL")
else
  PSQL_ARGS=(
    "-h" "${DB_HOST:-localhost}"
    "-p" "${DB_PORT:-5432}"
    "-U" "${DB_USER:-postgres}"
    "-d" "${DB_NAME:-habit_tracker}"
  )
  export PGPASSWORD="${DB_PASSWORD:-postgres}"
fi

echo "→ Applying ai_readonly setup..."
psql "${PSQL_ARGS[@]}" \
  -v "ai_pwd=$AI_DB_PASSWORD" \
  -f "$SQL_FILE"

echo ""
echo "✅ Done. Now add to backend .env:"
echo "   AI_DB_PASSWORD=$AI_DB_PASSWORD"
