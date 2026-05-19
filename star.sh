#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

PORT="${PORT:-3000}"

if [ ! -d "node_modules" ]; then
  echo "Instalando dependencias..."
  npm install
fi

if command -v lsof >/dev/null 2>&1; then
  if lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "A porta $PORT ja esta em uso."
    echo "Use outra porta assim: PORT=3001 bash star.sh"
    exit 1
  fi
fi

echo "Gerando bundle do frontend..."
npm run build

echo "Subindo projeto em modo desenvolvimento na porta $PORT..."
PORT="$PORT" npm run dev
