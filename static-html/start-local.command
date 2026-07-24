#!/bin/bash

set -u
cd "$(dirname "$0")" || exit 1
PORT="${REFLO_PORT:-8081}"
URL="http://127.0.0.1:${PORT}/"

open_browser() {
  [ "${REFLO_NO_BROWSER:-0}" = "1" ] && return
  if command -v open >/dev/null 2>&1; then open "$URL"; elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1; fi
}

if command -v lsof >/dev/null 2>&1 && lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  open_browser
  exit 0
fi

if command -v python3 >/dev/null 2>&1; then
  python3 -m http.server "$PORT" --bind 127.0.0.1 &
elif command -v python >/dev/null 2>&1; then
  python -m http.server "$PORT" --bind 127.0.0.1 &
elif command -v ruby >/dev/null 2>&1; then
  ruby -run -e httpd . -p "$PORT" -b 127.0.0.1 &
else
  echo "Python 3 또는 Ruby 실행 환경을 찾지 못했습니다."
  read -r -p "Enter 키를 누르면 종료합니다."
  exit 1
fi
SERVER_PID=$!
cleanup() { kill "$SERVER_PID" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM
sleep 1
if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
  echo "서버를 시작하지 못했습니다. ${PORT} 포트를 확인해주세요."
  exit 1
fi
open_browser
echo "REFLO 로컬 서버: $URL (이 창을 닫으면 종료됩니다.)"
wait "$SERVER_PID"
