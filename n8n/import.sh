#!/usr/bin/env sh
# Import the LendLoop workflows into the running n8n container, publish (activate) them,
# then restart so the production webhook and schedule are registered.
set -eu
cd "$(dirname "$0")"
docker compose exec -T n8n n8n import:workflow --separate --input=/workflows
for id in lendloop-error-handler lendloop-loan-event-notification lendloop-overdue-reminders; do
  docker compose exec -T n8n n8n publish:workflow --id="$id"
done
docker compose restart n8n
