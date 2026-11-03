#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ $# -ne 2 ]]; then
  printf 'Usage: %s LIVE_DATA_DIR NEW_SNAPSHOT_DIR\n' "${0##*/}" >&2
  exit 2
fi

if ! command -v sqlite3 >/dev/null; then
  printf 'sqlite3 is required.\n' >&2
  exit 1
fi

source_dir=$(realpath -e -- "$1")
destination_parent=$(realpath -e -- "$(dirname -- "$2")")
destination_name=$(basename -- "$2")
destination="$destination_parent/$destination_name"

if [[ ! -d "$source_dir" ]]; then
  printf 'The source must be a Tunarr data directory.\n' >&2
  exit 1
fi
if [[ "$destination_name" == '.' || "$destination_name" == '..' || "$destination_name" == '/' || -e "$destination" || -L "$destination" ]]; then
  printf 'The snapshot destination must not already exist.\n' >&2
  exit 1
fi
if [[ "$source_dir" == '/' || "$destination" == "$source_dir/"* ]]; then
  printf 'The snapshot destination must be outside the source directory.\n' >&2
  exit 1
fi
case "$destination" in
  *"'"*|*'"'*|*'\'*|*$'\n'*|*$'\r'*)
    printf 'The snapshot path cannot contain quotes, backslashes, or newlines.\n' >&2
    exit 1
    ;;
esac

source_command=()
needs_sudo=false
if [[ ! -r "$source_dir" || ! -x "$source_dir" ]]; then
  needs_sudo=true
else
  for entry in db.db db.db-wal db.db-shm settings.json channel-lineups images cache; do
    path="$source_dir/$entry"
    if [[ -e "$path" && ! -r "$path" ]]; then
      needs_sudo=true
    elif [[ -d "$path" ]]; then
      unreadable=$(find "$path" \( ! -readable -o \( -type d ! -executable \) \) -print -quit 2>/dev/null) || needs_sudo=true
      if [[ -n "$unreadable" ]]; then
        needs_sudo=true
      fi
    fi
  done
fi
if [[ "$needs_sudo" == true ]]; then
  if ! command -v sudo >/dev/null; then
    printf 'The source is not readable. Run with an account that can use sudo.\n' >&2
    exit 1
  fi
  sudo -v
  source_command=(sudo)
fi

if ! "${source_command[@]}" test -f "$source_dir/db.db"; then
  printf 'The source must contain db.db.\n' >&2
  exit 1
fi

for entry in settings.json channel-lineups images cache; do
  path="$source_dir/$entry"
  if "${source_command[@]}" test -L "$path"; then
    printf 'The source contains a symlink in %s; resolve it before copying.\n' "$entry" >&2
    exit 1
  fi
  if "${source_command[@]}" test -d "$path"; then
    if ! symlinks=$("${source_command[@]}" find "$path" -type l -print -quit); then
      printf 'Cannot inspect %s for symlinks.\n' "$entry" >&2
      exit 1
    fi
    if [[ -n "$symlinks" ]]; then
      printf 'The source contains a symlink in %s; resolve it before copying.\n' "$entry" >&2
      exit 1
    fi
  fi
done

mkdir -m 700 -- "$destination"
success=false
finish() {
  if [[ ${#source_command[@]} -gt 0 ]]; then
    sudo chown -R "$(id -u):$(id -g)" -- "$destination"
  fi
  chmod -R u+rwX,go-rwx -- "$destination"
  if [[ "$success" != true ]]; then
    printf 'Snapshot incomplete at %s. Remove it before retrying.\n' "$destination" >&2
  fi
}
trap finish EXIT

"${source_command[@]}" sqlite3 -readonly "$source_dir/db.db" ".backup '$destination/db.db'"
for entry in settings.json channel-lineups images cache; do
  if "${source_command[@]}" test -e "$source_dir/$entry"; then
    "${source_command[@]}" cp -R --no-preserve=mode,ownership -- "$source_dir/$entry" "$destination/"
  fi
done
success=true
printf 'Snapshot created at %s\n' "$destination"
