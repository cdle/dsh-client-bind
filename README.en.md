# dsh-client-bind

[简体中文](./README.md) | [English](./README.en.md)

Token-gated conversation-level machine binding for the [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh) web GUI.

Visitors open the GUI through a parameterized entry URL: `?ssh=<sshAlias>` selects the target machine, and — when a deployment token is configured — `?token=<token>` authenticates the visit. At the first agent step the plugin injects a binding notice via **deterministic server-side code**: the bound machine's details (ssh alias, login user, per-machine notes) plus a roster of every other configured machine — strict matching, no IP guessing.

## Features

- **Optional token gate**: with a deployment token configured, entry URLs must carry a matching `?token=`; leave it empty and no auth applies
- **Machines by ssh alias**: naturally aligned with `~/.ssh/config`; the agent is instructed to reach machines via the alias first
- **Per-machine agent notes**: OS, shell, package manager, caveats — injected with every bound conversation
- **Full roster injection**: besides the bound machine, every other configured machine is injected at the first step, so the agent can switch targets by name/alias
- **Settings card**: manage machines (CRUD, token regeneration, copy entry URL) under Settings → Plugins
- **One-click keys**: ed25519 keypair generation plus automatic `~/.ssh/config` alias-block management (only touches blocks it owns, never user-written Host entries)
- **Self-hosted beacon**: the heartbeat script ships via index injection and reports every 30s — zero upstream patches
- **Theme aware**: the card uses only `--dsw-alias-*` design tokens; light/dark handled for you

## Install

**Option A · git clone** (recommended, easy to update):

```bash
cd <profile>/node_modules    # usually /root/.dsh/profiles/web/node_modules
git clone https://github.com/cdle/dsh-client-bind.git
```

Then add `"dsh-client-bind"` to the profile manifest (`<profile>/package.json`):

```json
{
  "dsh": {
    "profile": {
      "bundles": [ "...", "dsh-client-bind" ]
    }
  }
}
```

**Option B · npm package** (once published): `pnpm add dsh-client-bind` or install via the plugin market.

Restart dsh to apply.

## Configuration

Both places work: the bundle patch seed (effective at deploy) or the Settings → Plugins card (user layer overrides the seed).

```yaml
- insert:
    - id: client-bind
      name: dsh-client-bind
- id: client-bind
  config:
    token: ""            # deployment token: optional; empty disables the auth gate
    machines: []         # machine list: leave empty and add them in the card
```

Per-machine fields:

| Field | Meaning |
|---|---|
| Label | shown to the agent |
| ssh alias | **the machine identity** = the `ssh=` value in the URL; also the Host of the generated `~/.ssh/config` block |
| Username | injected to the agent |
| IP | display only, never used for matching |
| Notes | OS, shell, package manager, sudo caveats, etc. |

Generate a deployment token: `node -e 'console.log(require("crypto").randomBytes(12).toString("hex"))'`

## Usage

1. Settings → Plugins → the machine-binding card; set the token (optional) and add machines
2. Hit the per-machine **copy entry URL** button — you get `http://<host>:3080/?token=<token>&ssh=<alias>`
3. Open that URL in the machine's browser
4. Start a new conversation — the binding notice appears at the first step (bound machine details plus the roster of other configured machines); from then on "this machine" means that box, other machines are reached via their ssh aliases, and commands follow the target's OS syntax
5. For passwordless ssh hit the per-machine **generate key** button and append the public key to the target machine's `authorized_keys`

## Security notes

- The token guards against **accidental cross-binding and casual impersonation**, not encryption: anyone on the LAN with the URL gets the binding
- `notes` are injected into every conversation bound to that machine — keep secrets (sudo passwords etc.) there only if you accept that
- Tokens persist in localStorage and are reported automatically on later visits from that browser
- The plugin listens nowhere public; whether your deployment is exposed is your dsh configuration's decision

## Plugin development contract (four hard-won lessons)

For anyone writing a dual-face dsh plugin:

1. **Client entry discovery**: expose `"exports": { "./client": "./dist/client.js" }`. `dsh-client-modules` serves `/plugins/<id>/client.js` only for packages resolving this subpath. Host half live + card missing = usually this.
2. **Settings registration**: `ctx.inject(["settings"], (sctx) => { scope = sctx.settings.register(ns, Config, { base: config }) })` — the callback receives the **context**, the service lives on `.settings`. Calling `.register` on the bare argument throws and the namespace silently disappears.
3. **Index injection rows**: the field is `kind: "script"`, not `type` — the wrong key throws during index render and every page turns 400 while the boot still "succeeds".
4. **Card styling**: use only `--dsw-alias-*` tokens (`label-primary/secondary/tertiary`, `border-l2`, `bg-layer-3`, `brand-primary`, `label-error`), 13px body / 12px meta, radius 8. Hardcoded colors break light/dark themes.

## License

[MIT](./LICENSE)
