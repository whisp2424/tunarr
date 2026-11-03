#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
root=$(mktemp -d "${TMPDIR:-/tmp}/tunarr-snapshot-test.XXXXXXXX")
writer_pid=
cleanup() {
  if [[ -n "$writer_pid" ]]; then
    kill "$writer_pid" 2>/dev/null || true
    wait "$writer_pid" 2>/dev/null || true
  fi
  chmod -R u+rwX -- "$root"
  rm -r -- "$root"
}
trap cleanup EXIT

source_dir="$root/live data"
destination="$root/test data"
mkdir -p "$source_dir"/{channel-lineups,images,cache,streams,backups,data.ms,logs}
printf '%s\n' '{"token":"private-fixture"}' > "$source_dir/settings.json"
printf 'lineup\n' > "$source_dir/channel-lineups/example.json"
printf 'image\n' > "$source_dir/images/example.png"
printf 'subtitle\n' > "$source_dir/cache/subtitle.ass"
printf 'exclude\n' > "$source_dir/streams/example"

python3 -u - "$source_dir/db.db" "$root/ready" <<'PY' &
import pathlib
import sqlite3
import sys
import time

connection = sqlite3.connect(sys.argv[1])
connection.execute('pragma journal_mode=wal')
connection.execute('pragma wal_autocheckpoint=0')
connection.execute('create table channels (name text)')
connection.execute('insert into channels values (?)', ('WAL channel',))
connection.commit()
pathlib.Path(sys.argv[2]).touch()
while True:
    time.sleep(1)
PY
writer_pid=$!
for _ in {1..100}; do
  [[ -e "$root/ready" ]] && break
  kill -0 "$writer_pid" 2>/dev/null || { printf 'SQLite fixture failed to start.\n' >&2; exit 1; }
  sleep 0.05
done
[[ -e "$root/ready" && -s "$source_dir/db.db-wal" ]] || { printf 'SQLite WAL fixture is unavailable.\n' >&2; exit 1; }

output=$("$repo_root/scripts/tunarr-dev-snapshot.sh" "$source_dir" "$destination")
[[ "$output" != *private-fixture* ]] || { printf 'Snapshot output leaked fixture content.\n' >&2; exit 1; }
[[ $(sqlite3 -readonly "$destination/db.db" 'select name from channels;') == 'WAL channel' ]] || { printf 'Snapshot missed the committed WAL row.\n' >&2; exit 1; }
[[ $(sqlite3 -readonly "$destination/db.db" 'pragma integrity_check;') == ok ]] || { printf 'Snapshot integrity check failed.\n' >&2; exit 1; }
for entry in settings.json channel-lineups/example.json images/example.png cache/subtitle.ass; do
  cmp "$source_dir/$entry" "$destination/$entry" || { printf 'Snapshot differs for %s.\n' "$entry" >&2; exit 1; }
done
for entry in streams backups data.ms logs; do
  [[ ! -e "$destination/$entry" ]] || { printf 'Unexpected copied directory %s.\n' "$entry" >&2; exit 1; }
done
[[ $(stat -c '%a' "$destination") == 700 ]] || { printf 'Snapshot directory is not private.\n' >&2; exit 1; }
[[ $(stat -c '%a' "$destination/settings.json") == 600 ]] || { printf 'Snapshot settings are not private.\n' >&2; exit 1; }

mkdir "$root/fake-bin"
cat > "$root/fake-bin/sudo" <<'SUDO'
#!/usr/bin/env bash
set -euo pipefail
if [[ ${1:-} == '-v' ]]; then
  if [[ -n ${SNAPSHOT_TEST_DIRECTORY:-} ]]; then
    chmod u+rx "$SNAPSHOT_TEST_DIRECTORY"
  fi
  chmod u+r "$SNAPSHOT_TEST_DATABASE"
  : > "$SNAPSHOT_TEST_SUDO_MARKER"
else
  exec "$@"
fi
SUDO
chmod +x "$root/fake-bin/sudo"
chmod 000 "$source_dir/db.db"
PATH="$root/fake-bin:$PATH" SNAPSHOT_TEST_DATABASE="$source_dir/db.db" SNAPSHOT_TEST_SUDO_MARKER="$root/sudo-used" \
  "$repo_root/scripts/tunarr-dev-snapshot.sh" "$source_dir" "$root/privileged-copy" >/dev/null
[[ -e "$root/sudo-used" ]] || { printf 'Unreadable source did not request sudo.\n' >&2; exit 1; }
[[ $(sqlite3 -readonly "$root/privileged-copy/db.db" 'select name from channels;') == 'WAL channel' ]] || { printf 'Privileged snapshot missed the WAL row.\n' >&2; exit 1; }

chmod 000 "$source_dir"
PATH="$root/fake-bin:$PATH" SNAPSHOT_TEST_DATABASE="$source_dir/db.db" SNAPSHOT_TEST_DIRECTORY="$source_dir" SNAPSHOT_TEST_SUDO_MARKER="$root/sudo-used" \
  "$repo_root/scripts/tunarr-dev-snapshot.sh" "$source_dir" "$root/restricted-copy" >/dev/null
[[ $(sqlite3 -readonly "$root/restricted-copy/db.db" 'select name from channels;') == 'WAL channel' ]] || { printf 'Restricted directory snapshot missed the WAL row.\n' >&2; exit 1; }
chmod u+w "$source_dir"

printf 'keep\n' > "$destination/sentinel"
if "$repo_root/scripts/tunarr-dev-snapshot.sh" "$source_dir" "$destination" >/dev/null 2>&1; then
  printf 'Existing destination was accepted.\n' >&2
  exit 1
fi
[[ $(cat "$destination/sentinel") == keep ]] || { printf 'Existing destination changed.\n' >&2; exit 1; }
if "$repo_root/scripts/tunarr-dev-snapshot.sh" "$source_dir" "$source_dir/new" >/dev/null 2>&1; then
  printf 'Destination inside live data was accepted.\n' >&2
  exit 1
fi
mkdir "$root/invalid-source"
printf 'not a sqlite database' > "$root/invalid-source/db.db"
if "$repo_root/scripts/tunarr-dev-snapshot.sh" "$root/invalid-source" "$root/incomplete" >/dev/null 2>&1; then
  printf 'An invalid database was accepted.\n' >&2
  exit 1
fi
[[ -d "$root/incomplete" && $(stat -c '%a' "$root/incomplete") == 700 ]] || { printf 'Failed snapshot was not left private.\n' >&2; exit 1; }

ln -s /tmp "$source_dir/images/link"
if "$repo_root/scripts/tunarr-dev-snapshot.sh" "$source_dir" "$root/symlink-copy" >/dev/null 2>&1; then
  printf 'Source symlink was accepted.\n' >&2
  exit 1
fi
[[ ! -e "$root/symlink-copy" ]] || { printf 'Symlink rejection left a destination.\n' >&2; exit 1; }
printf 'Snapshot checks passed.\n'
