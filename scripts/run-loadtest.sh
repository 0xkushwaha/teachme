#!/usr/bin/env bash
# Runs the k6 load-test suite against a production build of the API + worker on :4200.
# Prereqs: docker compose stack (postgres, redis, mailpit) up; `npm run build` in backend;
#          base seed + `npx ts-node --transpile-only scripts/loadtest-seed.ts`.
# Usage: scripts/run-loadtest.sh [scenario...]   (default: all)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/loadtest-results"
mkdir -p "$OUT"
SCENARIOS=("${@:-read-workload slot-contention booking-write webhooks jobs}")

export NODE_ENV=production PORT=4200 LOG_LEVEL=warn COOKIE_SECURE=true METRICS_TOKEN=loadtest \
  TRUST_PROXY=1 THROTTLE_GLOBAL_LIMIT=100000 RUN_WORKERS_IN_API=false \
  RAZORPAY_WEBHOOK_SECRET=lt_webhook_secret DOTENV_CONFIG_PATH="$ROOT/backend/.env" \
  DATABASE_URL="postgresql://teachme:teachme_dev_password@localhost:5432/teachme?schema=public&connection_limit=40"

cd "$ROOT/backend"
node dist/server.js >"$OUT/api.log" 2>&1 & API_PID=$!
node dist/worker.js >"$OUT/worker.log" 2>&1 & WORKER_PID=$!
trap 'kill $API_PID $WORKER_PID 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do curl -sf localhost:4200/api/v1/health/ready >/dev/null && break; sleep 1; done

# Resource sampler: API/worker process CPU% + RSS, Postgres/Redis container stats, every 5s.
( while kill -0 $API_PID 2>/dev/null; do
    ts=$(date +%s)
    ps -o %cpu=,rss= -p $API_PID | awk -v t="$ts" '{print t",api,"$1","int($2/1024)}'
    ps -o %cpu=,rss= -p $WORKER_PID | awk -v t="$ts" '{print t",worker,"$1","int($2/1024)}'
    docker stats --no-stream --format '{{.Name}},{{.CPUPerc}},{{.MemUsage}}' teachme-postgres-1 teachme-redis-1 | sed "s/^/$ts,/"
    sleep 5
  done ) >"$OUT/resources.csv" 2>/dev/null & SAMPLER=$!

for s in ${SCENARIOS[@]}; do
  echo "=== $s"
  if [ "$s" = jobs ]; then (cd "$ROOT/backend" && npx ts-node --transpile-only scripts/loadtest-jobs.ts | tee "$OUT/jobs.txt"); continue; fi
  docker run --rm -i --add-host=host.docker.internal:host-gateway \
    -v "$ROOT/loadtest:/scripts:ro" -v "$OUT:/results" \
    grafana/k6:0.54.0 run --quiet --summary-export "/results/$s.json" "/scripts/$s.js" 2>&1 | tee "$OUT/$s.txt" | tail -40 || true
done
kill $SAMPLER 2>/dev/null || true
curl -s -H 'Authorization: Bearer loadtest' localhost:4200/metrics | grep -E '^(process_resident_memory_bytes|nodejs_eventloop_lag_p99_seconds) ' >"$OUT/final-metrics.txt" || true
