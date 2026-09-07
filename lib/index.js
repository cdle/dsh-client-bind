import Schema from "@deepseek-ai/schemastery";
import { readFile, readdir, writeFile, mkdir, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export const name = "client-bind";
export const inject = ["webServer"];
export const SETTINGS_NAMESPACE = "client-bind";

const BIND_DIR = join(homedir(), ".dsh", "client-bind");
const STATE_PATH = join(BIND_DIR, "state.json");
const SSH_DIR = join(homedir(), ".ssh");

export const Config = Schema.object({
  token: Schema.string().description("部署级访问令牌（可选）：配置后入口 URL 必须携带 ?token=<它>，不匹配拒绝；留空则不鉴权，仅凭 ssh= 绑定。"),
  machines: Schema.array(
    Schema.object({
      label: Schema.string().description("机器名称（注入给 agent 展示）"),
      ip: Schema.string().description("机器 IP（仅展示用，不参与识别）"),
      username: Schema.string().description("登陆用户名"),
      sshAlias: Schema.string().description("ssh 配置别名 = URL 里 ssh= 的值，作为机器身份（必填）"),
      notes: Schema.string().description("给 agent 看的机器说明（系统、shell、包管理器、注意事项等）")
    })
  ).description("机器列表：入口 URL 用 ssh=<ssh 别名> 选择绑定目标")
});

function machineBullet(m) {
  const pick = (v) => String(v ?? "").trim();
  const alias = pick(m?.sshAlias);
  const parts = [];
  const name = pick(m?.label) || alias;
  if (name) parts.push("「" + name + "」");
  if (alias) parts.push("ssh 访问：" + alias);
  if (pick(m?.username)) parts.push("登陆用户名：" + pick(m.username));
  if (pick(m?.ip)) parts.push("IP：" + pick(m.ip));
  if (pick(m?.notes)) parts.push("机器说明：" + pick(m.notes));
  return parts.length ? "- " + parts.join("，") : "";
}

function renderNotice(machine, others, state) {
  const pick = (v) => String(v ?? "").trim();
  const lines = [
    "<system-reminder>",
    "client-bind 插件注入（对话级机器绑定，服务端确定性代码，非模型推断）",
    "",
    "本对话已绑定到访客机器「" + (pick(machine.label) || pick(machine.sshAlias)) + "」："
  ];
  if (pick(machine.sshAlias)) lines.push("- ssh 访问：" + pick(machine.sshAlias));
  if (pick(machine.username)) lines.push("- 登陆用户名：" + pick(machine.username));
  if (pick(state.ip)) lines.push("- 来源 IP：" + pick(state.ip) + (pick(state.ts) ? "（绑定时间 " + pick(state.ts) + "）" : ""));
  if (pick(machine.notes)) lines.push("- 机器说明：" + pick(machine.notes));
  const bullets = (Array.isArray(others) ? others : []).map(machineBullet).filter(Boolean);
  if (bullets.length) lines.push("", "其他可用机器（本对话未绑定，需要时经其 ssh 别名访问）：", ...bullets);
  lines.push(
    "",
    "自本消息起，在整个对话内：用户说\"本机/这台电脑/我电脑\"一律指上述已绑定机器；用户按名称或别名提到其他可用机器时，经其 ssh 别名访问；相关指令经对应 ssh 别名在目标机器上执行，命令语法以该机器系统为准（Windows 用 cmd/PowerShell）；路径、系统信息、包管理器以目标机器为准；需要提权而未配置密码时先向用户索要，不要猜测；对某台机器没有访问权限时明确告知用户。",
    "</system-reminder>"
  );
  return lines.join("\n");
}

let createUserMessage;
try {
  ({ createUserMessage } = await import("@deepseek-ai/dsh-llm"));
} catch {
  createUserMessage = (input) => Object.freeze({ ...input, role: "user", id: "cb_" + randomBytes(16).toString("hex") });
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeState(state) {
  await mkdir(BIND_DIR, { recursive: true });
  const tmp = STATE_PATH + ".tmp";
  await writeFile(tmp, JSON.stringify(state));
  await rename(tmp, STATE_PATH);
}

function peerIp(req) {
  const raw = String(req?.socket?.remoteAddress ?? "");
  return raw.startsWith("::ffff:") ? raw.slice(7) : raw;
}

export function apply(ctx, config) {
  let scope;
  ctx.inject(["settings"], (sctx) => {
    scope = sctx.settings.register(SETTINGS_NAMESPACE, Config, { base: config ?? {} });
  });
  const readConfig = () => {
    try {
      const section = scope?.get?.();
      if (section && typeof section === "object") return section;
    } catch {}
    return config ?? {};
  };
  const readMachines = () => {
    const machines = readConfig().machines;
    return Array.isArray(machines) ? machines.filter((m) => m && typeof m.sshAlias === "string" && m.sshAlias.trim()) : [];
  };
  const byAlias = (alias) => {
    const a = String(alias ?? "").trim();
    return readMachines().find((m) => m.sshAlias.trim() === a);
  };

  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: "/client-bind/hello",
    handler: async (req, res) => {
      try {
        const url = new URL(req.url, "http://local");
        const token = (url.searchParams.get("token") ?? "").trim();
        const machineParam = (url.searchParams.get("ssh") ?? "").trim();
        res.setHeader("Cache-Control", "no-store");
        const cfgToken = String(readConfig().token ?? "").trim();
        if (cfgToken && token !== cfgToken) {
          res.statusCode = 404;
          res.end();
          return;
        }
        const machine = machineParam ? byAlias(machineParam) : undefined;
        if (machineParam && !machine) {
          res.statusCode = 404;
          res.end();
          return;
        }
        await writeState({
          ts: new Date().toISOString(),
          token: cfgToken,
          machine: machine?.sshAlias ?? "",
          label: machine?.label ?? "",
          ip: peerIp(req),
          ua: String(req.headers["user-agent"] ?? "").slice(0, 200),
          bound: Boolean(machine)
        });
        res.statusCode = 204;
        res.end();
      } catch {
        res.statusCode = 204;
        res.end();
      }
    }
  }), "client-bind: hello beacon route");

  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: "/client-bind/pubkeys",
    handler: async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      try {
        await mkdir(SSH_DIR, { recursive: true });
        const files = (await readdir(SSH_DIR)).filter((f) => f.endsWith(".pub")).sort();
        const keys = [];
        for (const file of files) {
          try {
            const publicKey = (await readFile(join(SSH_DIR, file), "utf8")).trim();
            if (publicKey) keys.push({ file, publicKey });
          } catch {}
        }
        res.end(JSON.stringify({ keys }));
      } catch (error) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: String(error?.message ?? error) }));
      }
    }
  }), "client-bind: pubkeys route");

  const PING_SCRIPT = [
    "(function(){",
    'var KT="client-bind.token",KM="client-bind.machine";',
    "try{",
    'var q=new URLSearchParams(location.search);',
    'if(q.get("token"))localStorage.setItem(KT,q.get("token"));',
    'var a=q.get("ssh");if(a)localStorage.setItem(KM,a);',
    'var t=localStorage.getItem(KT);if(!t)return;',
    'var m=localStorage.getItem(KM)||"";',
    'var p=function(){try{fetch("/client-bind/hello?token="+encodeURIComponent(t)+(m?"&ssh="+encodeURIComponent(m):""),{keepalive:true}).catch(function(){})}catch(e){}};',
    "p();setInterval(p,30000);",
    'document.addEventListener("visibilitychange",function(){if(!document.hidden)p();});',
    "}catch(e){}",
    "})();"
  ].join("");
  ctx.on("webserver/index-inject", (table) => {
    table.push({ kind: "script", placement: "body", text: PING_SCRIPT });
  });

  const decided = new WeakSet();
  ctx.on("agent/pre-step", async ({ agent, messages, step, signal }, next) => {
    const decision = await next();
    try {
      if (signal?.aborted) return decision;
      if (!decision || decision.kind !== "enter") return decision;
      if (step !== 1 || decided.has(agent.session)) return decision;
      decided.add(agent.session);
      const state = await readJson(STATE_PATH, null);
      if (!state || state.bound !== true || !state.machine) return decision;
      const machine = byAlias(state.machine);
      if (!machine) return decision;
      const others = readMachines().filter((m) => String(m?.sshAlias ?? "").trim() !== String(machine.sshAlias ?? "").trim());
      const text = renderNotice(machine, others, state);
      const message = createUserMessage({
        content: [{ type: "text", text: text }],
        source: { kind: "plugin", plugin: name }
      });
      const lastClaimed = decision.messages.findLastIndex((m) => messages.includes(m));
      const at = lastClaimed >= 0 ? lastClaimed + 1 : decision.messages.length;
      return { kind: "enter", messages: decision.messages.toSpliced(at, 0, message) };
    } catch {
      return decision;
    }
  });
}
