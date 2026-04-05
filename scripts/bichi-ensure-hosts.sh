#!/usr/bin/env bash
cd "$(dirname "$0")/.."
exec node scripts/ensure-hosts.mjs
