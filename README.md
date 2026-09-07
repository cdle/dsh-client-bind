# dsh-client-bind

Conversation-level machine binding for [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh) web.
每个对话在首个 agent 步骤被服务端**确定性**地绑定到一台访客机器 —— 不靠模型推理，不做 IP 猜测。

## How it works

1. **Token = machine identity.** Each machine has a user-defined complex token (treat it as a capability
   token). The machine's browser entry URL carries it: `http://<host>:3080/?token=<token>&ssh=<sshAlias>`.
   An injected index script stores the token in `localStorage` and pings `GET /client-bind/hello?token=<token>&ssh=<sshAlias>`
   every 30s (self-hosted beacon — no upstream patches, no frontend changes).
2. **Strict match, no fallback.** At the first agent step the plugin reads the latest beacon state and
   matches the token against the machine table **exactly**. Unknown token / no beacon / headless → no
   injection. A special `guestToken` authenticates the visit without binding any machine.
3. **Injection rides the durable channel.** The rendered notice (ssh alias, username, per-machine agent
   notes, source IP) is spliced into the step's message batch as a plugin-sourced durable user message —
   same channel as AGENTS.md, replayed after compaction, inherited by sub-agents.
4. **Settings UI.** The browser half registers a card under *Settings → Plugins → client-bind*: machines
   CRUD, token regeneration, per-machine agent notes, injection template override, and **ssh keypair
   generation** — the host runs `ssh-keygen -t ed25519`, shows the public key for copying to the target
   machine's `authorized_keys`, and maintains a marked `~/.ssh/config` alias block (`Host <alias>` +
   `IdentityFile`). The agent is instructed to access machines via the alias first.

## Install

```bash
pnpm --dir ~/.dsh/profiles/web add dsh-client-bind
```
or add `"dsh-client-bind"` to the profile's `dsh.profile.bundles`. Seed machines via the bundle's
`cordis.patch.yml` config row (composition base) or entirely through the settings card (user layer).

## Security notes

- The token travels in the URL/Referer on your LAN; treat the deployment as trust-the-LAN (same as the
  harness web itself). Tokens prevent accidental cross-machine binding and casual impersonation, not a
  determined network attacker.
- `/client-bind/keygen` is an unauthenticated host action by design (it only generates a keypair for a
  token already in your config). Gate your LAN accordingly.
- Secret material (sudo passwords etc.) belongs in the per-machine **notes** only if you accept that it
  is injected into every conversation bound to that machine.

## Layout

```
lib/index.js   host half: settings namespace, beacon + keygen routes, index script, pre-step injection
dist/client.js browser half: Plugins-settings card (ModuleLoader-wrapped, no build step)
cordis.patch.yml  bundle insertion + composition base config
```

MIT

## Plugin development contract (hard-won lessons)

A dual-face dsh plugin must satisfy all four, or half of it silently fails:

1. **Client entry discovery**: expose the browser half as `"exports": { "./client": "./dist/client.js" }`.
   The `dsh-client-modules` scanner serves `/plugins/<id>/client.js` only for packages
   resolving this subpath. Host half live + card missing = usually this.
2. **Settings namespace**: the inject callback receives the CONTEXT, not the service —
   `ctx.inject(["settings"], (sctx) => { scope = sctx.settings.register(ns, Config, { base: config }) })`.
   Calling `.register` on the bare argument throws and the namespace never appears in
   `settings.describe`, so the settings tab renders nothing for your card.
3. **Index injection rows**: the emit table wants `{ kind: "script", placement, text }` —
   `type` throws during index render and every page turns 400 (boot still "succeeds").
4. **Card styling**: use the `--dsw-alias-*` design tokens (`label-primary/secondary/tertiary`,
   `border-l2`, `bg-layer-3`, `brand-primary`, `label-error`), 13px body / 12px meta, radius 8.
   No hardcoded colors — they break in light/dark themes.
