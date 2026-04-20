# @agorap2p/seed — Status

Last updated: 2026-04-20

## Shipped

- **Terminal UI (`--tui`)** — live ANSI dashboard, three panels (network stats, files served, new accounts), 1-second redraw, clean Ctrl-C. `src/tui.mjs`.
- **Event plumbing** — `SwarmNode` and `ObjectStore` are `EventEmitter`s; emit `peer` / `served` / `new-object` / `new-author`.
- **Rename** — user-facing strings moved from "riot" to "agora": package `@agorap2p/seed`, bin `agora-seed`, log prefix, default data dir `~/.agora-seed` (with `~/.riot-seed` back-compat). Protocol strings (`riot:…` topics, DHT keys, data channel label) intentionally kept — see SPEC.md.
- **npm publish config** — `publishConfig.access: public`, `files` allowlist, repo link, `engines: node >=20`. `npm pack --dry-run` yields 8 files, 12.1 kB.
- **Dockerfile** — multi-stage, non-root `agora` user, tini, volume `/data`, EXPOSE 9876. Bundled with `.dockerignore`.
- **README** — user-facing run instructions (npx + Docker).
- **Smoke test** — `test/tui.test.mjs` drives the TUI with fake store/node and asserts all panels render. Green.

## Verified locally

- `node test/tui.test.mjs` → OK
- `node src/index.mjs --help` → renamed output
- `node src/index.mjs --tui --seed-all --data /tmp/… --port 9976` → renders live for 8s, 1 Hz redraw, joined global swarm, found 1 DHT node, clean exit on SIGTERM
- `node src/index.mjs --seed-all` (no TUI) → unchanged log behavior (default path preserved for systemd / pipes)
- `npm pack --dry-run` → clean tarball

## Pending / needs user action

- [ ] `docker build -t agora-seed packages/seed` + `docker run` smoke — Docker daemon wasn't running in the verification session.
- [ ] `npm publish` — requires `npm login` as a maintainer of the `@agorap2p` scope; scope may need to be registered first.
- [ ] `ghcr.io/vortex-303/agora-seed` image push — needs a GH Action or manual `docker push`.
- [ ] GitHub Action for tag → publish (npm + GHCR in one pipeline). Not yet scaffolded.

## Known caveats

- **Native dep install time**: `node-datachannel` prebuilts cover mainstream platforms; exotic CPUs trigger a source build (cmake + g++).
- **TUI in Docker**: needs `docker run -it`. Non-TTY invocations should drop `--tui`.
- **HTTP dashboard** binds to `127.0.0.1` — remote access requires an SSH tunnel or reverse proxy (by design; prevents accidental public exposure).
- **Bandwidth counters** are approximate: outbound is true bytes-on-wire of sync responses; inbound estimates from `JSON.stringify(obj)` size per new-object event (ignores framing + WebRTC overhead).

## File map

```
packages/seed/
├─ src/
│  ├─ index.mjs          CLI entrypoint, arg parsing, wiring
│  ├─ swarm-node.mjs     WebRTC swarm + peer gossip + EventEmitter
│  ├─ store.mjs          JSONL-backed ObjectStore + EventEmitter
│  ├─ dht-publisher.mjs  BitTorrent DHT publish/lookup (riot:profile:<pk>)
│  ├─ dashboard.mjs      HTTP dashboard on :9876
│  └─ tui.mjs            ANSI terminal UI
├─ test/
│  └─ tui.test.mjs       TUI smoke test
├─ Dockerfile
├─ .dockerignore
├─ .npmignore
├─ README.md             user-facing
├─ SPEC.md               technical spec
├─ STATUS.md             this file
└─ package.json          @agorap2p/seed
```

## Next obvious work

1. GitHub Action: tag push → `npm publish` + GHCR image (matrix: linux/amd64, linux/arm64).
2. systemd unit template in `packages/seed/deploy/agora-seed.service` for one-liner VPS install.
3. Optional `--quiet` flag for non-TUI non-verbose mode (useful in Docker logs).
4. `/api/events` SSE endpoint — same event stream the TUI uses, for remote scraping / Grafana.
