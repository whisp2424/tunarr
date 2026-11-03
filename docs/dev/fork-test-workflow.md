# Test fork changes with copied Tunarr data

Use this workflow for new features. Start in a separate checkout, implement the change, and verify the behavior. When testing needs realistic library or playback data, use the snapshot and test container below. For other changes, use an appropriate isolated fixture and skip the snapshot and container setup.

The test container runs on port 8001. The existing `pnpm docker-test` script builds the current checkout as `tunarr:test`.

The snapshot contains media-source credentials and other private data. Keep it in a private directory. The test instance can still contact the real media servers and may affect them. A read-only media mount does not prevent API requests to those servers.

## 1. Start from a separate checkout

Use a T3 Code worktree for the change. Record the worktree, its feature branch, and any test container and snapshot created for this run. Install dependencies with `pnpm i`, then make and test the change there. Keep the worktree until the feature is merged and the remaining work is complete.

## 2. Snapshot the live data

Choose a new destination outside the live data directory. Its parent must exist. The snapshot script refuses an existing destination or symlinked assets. It uses SQLite's online backup to include committed WAL data and copies the settings, lineups, images, and subtitle cache. It does not copy the search index, stream output, logs, or previous backups. The database and other files are copied at different times, so changes made during the copy can leave them out of sync.

```sh
LIVE_DATA=/opt/docker/media/appdata/tunarr
TEST_DATA="$HOME/.local/share/tunarr-test-$(date +%Y%m%d-%H%M%S)"
./scripts/tunarr-dev-snapshot.sh "$LIVE_DATA" "$TEST_DATA"
```

The live database in this setup is root-owned. The script requests `sudo` if the source is not readable. SQLite must be installed. The snapshot carries the live settings and credentials, including settings that send updates to external services. To disable Tunarr's channel, guide, and play-status updates in the copy before starting it, run:

```sh
sqlite3 "$TEST_DATA/db.db" 'UPDATE media_source SET send_channel_updates = 0, send_guide_updates = 0, send_play_status_updates = 0;'
```

This limits those updates; it does not isolate the test instance from the media servers or prevent other network requests.

## 3. Configure the test container

Create the ignored local configuration if it does not exist:

```sh
test -e docker/test/.env || cp docker/test/.env.example docker/test/.env
```

Set `TUNARR_TEST_DATA_DIR` in `docker/test/.env` to the snapshot path printed by the script. Set `TUNARR_TEST_PORT=8001` and select the desired `TUNARR_TEST_PIPELINE`. Do not point this setting at the live data directory.

Create `docker/test/local.compose.yaml` for mounts and network addresses on this machine. For the media stack used here, the following keeps Docker's `/library` paths valid and lets the test container reach the host's published Jellyfin port without joining the live Compose network:

```yaml
services:
  tunarr:
    volumes:
      - /mnt/gordis/Library:/library:ro
    extra_hosts:
      - "jellyfin:host-gateway"
```

This host mapping assumes Jellyfin is reachable on the host's port 8096 and that the live settings use `http://jellyfin:8096`. Adjust it for another installation. Other media sources may need their own test-only addresses or mounts. Do not mount a writable live data directory into the test container.

## 4. Build and test

Run these commands from the worktree:

```sh
pnpm docker-test config
pnpm docker-test
```

If your account cannot access the Docker daemon, run those commands with `sudo env "PATH=$PATH"` before `pnpm`. Open `http://localhost:8001/web` and verify the changed behavior with the copied data. For subtitle changes, check the selected profile, the channel subtitle switch, embedded subtitle extraction, and actual playback. Inspect `pnpm docker-test logs -f` if playback fails.

Run the relevant tests and `pnpm lint-changed`. To check the snapshot script itself, run `bash scripts/tests/tunarr-dev-snapshot.test.sh`. Preserve any uncommitted user changes. Report what was tested and what remains unverified.

## 5. Finish and clean up

After the feature is merged into `main`, clean up the resources created for that feature without waiting for a separate cleanup request. This workflow does not merge the feature by itself.

1. Confirm that the feature commit is an ancestor of the intended `main` branch. If the merge cannot be verified, leave the resources in place and report why.
2. Stop the test container created for this run with `pnpm docker-test down`, using the same Docker access method as above. The Compose project uses a shared container name, so first verify that the container and its data mount match this run. Leave a container used by another run alone.
3. Remove the recorded snapshot created for this run. Verify the exact path, that it is not a symlink, and that it is outside the live data directory. Never remove the live data directory or an existing directory supplied by the user.
4. Verify that the worktree has no uncommitted or untracked changes. Inspect ignored files and preserve the worktree if it contains user data not created for this run. Remove the merged feature worktree from the main checkout only after all work in the active session is finished. Delete a local feature branch only if this run created it and it is fully merged.

If the user asks to keep a resource, or its identity or ownership is uncertain, leave it in place and report it. This cleanup runs as part of the active agent session; it is not a background watcher for merges that occur later.

Build, push, or restart the live Compose service only when the user requests those actions. Rebuilding an image does not update an already-running container. When authorized to apply a built image, use the live Compose file to recreate only the intended service, allow it time to stop cleanly, and check its health afterward.
