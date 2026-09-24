# Hosting

The site is served live from the Arch desktop ("the desk"), with Cloudflare in
front of it and a copy of the site on Cloudflare for when the desk is asleep.

```
visitor ─▶ Cloudflare ─▶ the Worker (edge/worker.ts)
                           ├─ www.<domain>  → 308 to <domain>
                           ├─ /api/visitor  → answered right there, from what Cloudflare saw
                           └─ everything else → https://desk.<domain>
                                                  (the tunnel → kc-site on 127.0.0.1:8787, on the desk)
                                ↳ no answer in 3 s, or an error → the copy of dist/ deployed with the Worker
```

Every response says who answered it in `x-served-from`: `desk`, `copy` or
`edge`. When the copy answers, `/api/desk` says `{ "live": false }`, so the
footer and `uptime` say the desk is asleep.

| File | What it is |
| --- | --- |
| `server/site.ts`, `server/main.ts` | The desk's server. `bun run build:server` builds it into `build/server.mjs`, which runs on Node (the desk has Node 22, not Bun). |
| `edge/worker.ts`, `wrangler.jsonc` | The Worker, and the copy of the site it serves. |
| `deploy/kc-site.service` | Keeps the server running on the desk (a systemd user service, as `kc`). |
| `deploy/cloudflared.service`, `deploy/cloudflared.yml` | The tunnel: the desk dials out to Cloudflare, so no port is ever opened. |
| `deploy/deploy.sh` | `bun run deploy`: build, copy to the desk, restart, `wrangler deploy`. |

## Every time

```bash
bun run deploy
```

It builds the site and the server, copies them to `kc@archlinux:~/site`
(set `DESK=user@host` to use another machine), restarts `kc-site`, and deploys
the Worker with the new copy once `wrangler` is logged in. During the second
the server restarts, the Worker serves the copy.

## Once

Steps marked **(Khalil)** need a password, a login or a purchase. Claude can
do the rest.

### 1. A domain (Khalil)

Buy one and add it to Cloudflare (a free plan is enough). Until then the
Worker can run on `chaghouri.<account>.workers.dev`, where it always serves
the copy.

### 2. The server on the desk

`bun run deploy` puts the site in `~/site` and starts `kc-site.service`.
Lingering is already on for `kc`, so it runs whether or not anyone is logged
in. Check it:

```bash
ssh kc@archlinux 'systemctl --user status kc-site; curl -s localhost:8787/api/desk'
```

### 3. The tunnel (Khalil, on the desk)

```bash
sudo pacman -S cloudflared
cloudflared tunnel login
cloudflared tunnel create chaghouri
cloudflared tunnel route dns chaghouri desk.<domain>
```

- `login` prints a link: open it on any computer and pick the domain.
- `create` prints the tunnel's ID. It also writes `~/.cloudflared/<ID>.json`, which is the tunnel's password: it stays on the desk.
- Copy `deploy/cloudflared.yml` to `~/.cloudflared/config.yml` on the desk, filling in the ID and `desk.<domain>`.

`bun run deploy` has already copied the tunnel's service file to the desk, so
you can start the tunnel:

```bash
systemctl --user enable --now cloudflared.service
curl -sI https://desk.<domain>/
```

### 4. The Worker (Khalil logs in, on the Mac)

```bash
bunx wrangler login
```

In `wrangler.jsonc`:
- set `ORIGIN` to `"https://desk.<domain>"`;
- uncomment `routes` and `workers_dev`, and put the domain in both routes.

If Cloudflare already has a DNS record for the bare domain or `www` (a
registrar's parking page), delete it first: the Worker's routes make their own.
Then run `bun run deploy`.

### 5. Only through the Worker (optional)

`desk.<domain>` is public, so anyone who guesses it can skip the Worker. A
free WAF rule closes it: go to **Security → WAF → Custom rules**, add a rule
with the expression below, and set its action to **Block**:

```
(http.host eq "desk.<domain>" and cf.worker.upstream_zone ne "<domain>")
```

Afterwards the footer should still say "Served live from my Arch desktop". If
it says the desk is asleep instead, the rule is blocking the Worker too:
remove the rule.

## Checks

```bash
ssh kc@archlinux 'systemctl --user status kc-site cloudflared'
curl -s https://<domain>/api/visitor
curl -sI https://<domain>/ | grep x-served-from
ssh kc@archlinux 'systemctl --user stop kc-site'
curl -sI https://<domain>/ | grep x-served-from
ssh kc@archlinux 'systemctl --user start kc-site'
ssh kc@archlinux 'ss -tlnp'
```

1. Both services should be running.
2. `/api/visitor` should show your city and network.
3. `x-served-from` should say `desk`.
4. Stop the desk. `x-served-from` should now say `copy`, and the footer should say the desk is asleep.
5. Start it again.
6. `ss -tlnp` should show nothing new, apart from `127.0.0.1:8787`.

## If something's wrong

- **`kc-site` won't start.** Run `journalctl --user -u kc-site -e` on the desk. The sandboxing lines in `kc-site.service` (`NoNewPrivileges` through `MemoryMax`) haven't been tried on the desk yet. If the log blames them, delete them and deploy again.
- **The footer shows the wrong name.** The footer's "Served live from …" comes from `DESK_NAME` in `kc-site.service`.
- **No CPU temperature.** It's read from the CPU's package sensor (`coretemp`'s "Package id 0" on the desk). If there's no such sensor, `cpu` is `null` and nothing mentions it.

## What it knows about visitors

- **The desk:** logs nothing, not even addresses or paths.
- **The Worker:** keeps nothing. `/api/visitor` hands a visitor's own city and network back to their browser, which uses them to arrange the paper (`src/signals`), and that's where they stay.
- **`/api/desk`:** has uptime, load, CPU temperature, OS, kernel and core count, and nothing else. It's read at most every 10 seconds, however often it's asked.
