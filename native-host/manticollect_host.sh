#!/bin/sh
DIR="$(cd "$(dirname "$0")" && pwd)"
exec node "$DIR/manticollect_host.js"
