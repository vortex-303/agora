# @agorap2p/seed

P2P network node for [Agora](https://agorap2p.com) — seeds content, joins swarms, keeps the network alive.

## Run

No install:

```sh
npx -y @agorap2p/seed --seed-all --tui
```

Docker:

```sh
docker run --rm -it -v agora-seed:/data -p 9876:9876 \
  ghcr.io/vortex-303/agora-seed --seed-all --tui
```

## Flags

| Flag | Default | What |
|------|---------|------|
| `--seed-all` | off | Network-node mode — seeds everything you discover |
| `--topics a,b` | none | Comma-separated swarm topics to pin (personal mode) |
| `--tui` | off | Live terminal dashboard (peers, files served, new accounts) |
| `--data <dir>` | `~/.agora-seed` | Data directory |
| `--port <n>` | `9876` | HTTP dashboard port |
| `--budget <MB>` | `2048` | Storage cap — old neighborhood data evicted when exceeded |

## Modes

- **Personal** — `--topics riot:user:YOUR_KEY`: keeps your lobby + contacts alive.
- **Network node** — `--seed-all`: joins a neighborhood (XOR-assigned by peer ID), stores everyone's data. Contribute back to the network.

## HTTP dashboard

Even without `--tui`, a dashboard is available at `http://localhost:9876`.

## License

MIT
