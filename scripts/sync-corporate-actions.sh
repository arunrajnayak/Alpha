#!/bin/bash
# Sync corporate actions from NSE
# Run this locally when you want to sync corporate actions
# Usage: ./scripts/sync-corporate-actions.sh [from_date] [to_date]
# Example: ./scripts/sync-corporate-actions.sh 2024-08-11 2026-01-28

FROM_DATE=${1:-$(date -v-30d +%Y-%m-%d)}
TO_DATE=${2:-$(date +%Y-%m-%d)}

echo "Syncing corporate actions from $FROM_DATE to $TO_DATE..."

curl -s "https://alpha-velocity.vercel.app/api/admin/sync-corporate-actions?from=$FROM_DATE&to=$TO_DATE" | jq .

echo ""
echo "Done!"
