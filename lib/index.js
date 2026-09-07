import Schema from "@deepseek-ai/schemastery";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export const name = "client-bind";
export const inject = ["webServer"];
export const SETTINGS_NAMESPACE = "client-bind";

const BIND_DIR = join(homedir(), ".dsh", "client-bind");
const STATE_PATH = join(BIND_DIR, "state.json");
const SSH_DIR = join(homedir(), ".ssh");
const SSH_CONFIG = join(SSH_DIR, "config");

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
  ).description("机器列表：入口 URL 用 ssh=<ssh 别名> 选择绑定目标"),
  injectTemplate: Schema.string().description("绑定提示模板。占位符 {{label}} {{sshAlias}} {{username}} {{ip}} {{notes}} {{ts}}；值为空的行整行省略；留空用内置默认。")
});

const DEFAULT_TEMPLATE = [
  "<system-reminder>",
  "client-bind 插件注入（对话级机器绑定，服务端确定性代码，非模型推断）",
  "",
  "本对话已绑定到访客机器「{{label}}」：",
  "- ssh 访问：{{sshAlias}}",
  "- 登陆用户名：{{username}}",
  "- 来源 IP：{{ip}}（绑定时间 {{ts}}）",
  "- 机器说明：{{notes}}",
  "",
  "自本消息起，在整个对话内：用户说\"本机/这台电脑/我电脑\"一律指该机器；相关指令经上述 ssh 别名在该机器上执行，命令语法以该机器系统为准（Windows 用 cmd/PowerShell）；路径、系统信息、包管理器以该机器为准；需要提权而未配置密码时先向用户索要，不要猜测；对该机器没有访问权限时明确告知用户。",
  "</system-reminder>"
].join("\n");

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

function renderTemplate(tpl, map) {
  const lines = tpl.split("\n").filter((line) => {
    if (!/\{\{\w+\}\}/.test(line)) return true;
    const probed = line.replace(/\{\{(\w+)\}\}/g, (_, k) => {
      const v = map[k];
      return v === undefined || v === null || v === "" ? "\u0000EMPTY\u0000" : "";
    });
    return !probed.includes("\u0000EMPTY\u0000");
  });
  return lines
    .join("\n")
    .replace(/\{\{(\w+)\}\}/g, (_, k) => {
      const v = map[k];
      return v === undefined || v === null ? "" : String(v);
    });
}

function peerIp(req) {
  const raw = String(req?.socket?.remoteAddress ?? "");
  return raw.startsWith("::ffff:") ? raw.slice(7) : raw;
}

const blockBegin = (safe) => "# >>> client-bind " + safe;
const blockEnd = (safe) => "# <<< client-bind " + safe;

function shExec(args) {
  return new Promise((resolve) => {
    execFile(args[0], args.slice(1), { timeout: 20000 }, (error, stdout, stderr) => {
      resolve({ error, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });
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
    path: "/client-bind/keygen",
    handler: async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      const fail = (code, message) => {
        res.statusCode = code;
        res.end(JSON.stringify({ error: message }));
      };
      if (req.method !== "POST") return fail(405, "POST only");
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
        if (body.length > 16384) req.destroy();
      });
      req.on("error", () => fail(400, "request error"));
      req.on("end", async () => {
        try {
          const parsed = JSON.parse(body || "{}");
          const machine = byAlias(parsed.alias ?? parsed.machine);
          if (!machine) return fail(404, "未知机器别名");
          const alias = machine.sshAlias.trim();
          const safe = alias.replace(/[^A-Za-z0-9_-]/g, "") || "key";
          await mkdir(SSH_DIR, { recursive: true });
          const identityFile = join(SSH_DIR, "client-bind_" + safe + "_ed25519");
          let created = false;
          try {
            await readFile(identityFile);
          } catch {
            const gen = await shExec(["ssh-keygen", "-t", "ed25519", "-N", "", "-C", "client-bind " + (machine.label || safe), "-f", identityFile]);
            if (gen.error) return fail(500, "ssh-keygen 失败: " + (gen.stderr || gen.error.message));
            created = true;
          }
          const publicKey = (await readFile(identityFile + ".pub", "utf8")).trim();
          let configText = "";
          try {
            configText = await readFile(SSH_CONFIG, "utf8");
          } catch {}
          const begin = blockBegin(safe);
          const end = blockEnd(safe);
          const hasMarkers = configText.includes(begin);
          const escapedAlias = alias.replace(/[^A-Za-z0-9_-]/g, "\\$&");
          const aliasTaken = !hasMarkers && new RegExp("^\\s*Host\\s+.*\\b" + escapedAlias + "\\b", "m").test(configText);
          let warning = "";
          if (aliasTaken) {
            warning = "~/.ssh/config 已有 Host " + alias + "（非本插件管理），未改动配置；如需用新密钥请手动为该 Host 加一行: IdentityFile " + identityFile;
          } else {
            const blockLines = [
              begin,
              "Host " + alias,
              "  HostName " + (machine.ip || alias),
              machine.username ? "  User " + machine.username : null,
              "  Port 22",
              "  IdentityFile " + identityFile,
              "  IdentitiesOnly yes",
              "  StrictHostKeyChecking accept-new",
              end,
              ""
            ].filter((line) => line !== null);
            const block = blockLines.join("\n");
            const beginRe = begin.replace(/[^A-Za-z0-9_ >-]/g, "\\$&");
            const nextText = hasMarkers
              ? configText.replace(new RegExp(beginRe + "[\\s\\S]*?" + end), block)
              : configText.replace(/\s*$/, "") + (configText.trim() ? "\n\n" : "") + block;
            await writeFile(SSH_CONFIG, nextText);
          }
          res.end(JSON.stringify({ publicKey: publicKey, identityFile: identityFile, alias: alias, created: created, warning: warning }));
        } catch (error) {
          fail(500, String(error?.message ?? error));
        }
      });
    }
  }), "client-bind: keygen route");

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
      const template = String(readConfig().injectTemplate ?? "").trim() || DEFAULT_TEMPLATE;
      const text = renderTemplate(template, {
        label: machine.label ?? "",
        sshAlias: machine.sshAlias ?? "",
        username: machine.username ?? "",
        ip: state.ip ?? "",
        notes: machine.notes ?? "",
        ts: state.ts ?? ""
      });
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
