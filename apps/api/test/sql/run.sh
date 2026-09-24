#!/usr/bin/env bash
# 用真的 Postgres 驗證 supabase/migrations（依序全部套用）＋ seed（跑兩次驗證可重跑）＋ 狀態轉換函式（含兩連線併發）。
#
#   DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm --filter api test:sql
#
# DATABASE_URL 必須是「拋棄式」資料庫、以 superuser 連線（會建立角色、dblink extension、測試資料）。
# 為避免誤跑到正式／共用資料庫：資料庫裡已經有 public.bookings 就拒絕執行。
# 選用：DBLINK_CONN 指定第二條連線的 libpq 連線字串（預設用目前的資料庫與使用者走 Unix socket）。
set -euo pipefail

: "${DATABASE_URL:?請設定 DATABASE_URL（拋棄式 Postgres，例如 postgres://postgres:postgres@localhost:5432/postgres）}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -X -q)

if [ "$("${PSQL[@]}" -Atc "select to_regclass('public.bookings') is not null")" = "t" ]; then
  echo "拒絕執行：這個資料庫已經有 public.bookings，請改用拋棄式資料庫" >&2
  exit 1
fi

echo "▶ $("${PSQL[@]}" -Atc 'select version()')"
"${PSQL[@]}" -f "$HERE/00_supabase_roles.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "▶ migration $(basename "$f")"
  "${PSQL[@]}" -f "$f"
done
"${PSQL[@]}" -f "$ROOT/supabase/seed.sql"
"${PSQL[@]}" -f "$ROOT/supabase/seed.sql"
echo "▶ seed.sql ×2"

for f in "$HERE"/[1-9]*.sql; do
  echo "▶ $(basename "$f")"
  # 只顯示 PASS 與錯誤訊息；psql 失敗時 pipefail 會讓整個腳本失敗
  "${PSQL[@]}" -v c2conn="${DBLINK_CONN:-}" -f "$f" 2>&1 \
    | sed -n -e 's/.*NOTICE:  /  /p' -e '/ERROR:/p' -e '/DETAIL:/p' -e '/CONTEXT:/p'
done
echo "✔ SQL 測試全部通過"
