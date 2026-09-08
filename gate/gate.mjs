#!/usr/bin/env node
// dsh-client-bind gate — dsh web 公网暴露的前置令牌门禁反代。
//
// 用法:
//   node gate.mjs --listen 0.0.0.0:3080 --upstream 127.0.0.1:3082 \
//        --settings /root/.dsh/settings.yaml [--host-rewrite 192.168.1.1] [--cookie-name cb_gate]
//
// 令牌来源: settings.yaml 的 client-bind.token（按 mtime 缓存，面板改令牌即时生效）。
// 放行规则（按序）:
//   1. Cookie <cookie-name>=<令牌> 有效                     → 透传
//   2. ?token=<令牌> 有效                                    → 透传 + 种 HttpOnly cookie（一年）
//   3. 路径以 /client-bind/hello 开头                        → 透传（dsh 自身校验令牌，不匹配 404）
//   4. 其余一切（页面/资产//api/WebSocket）                   → 403
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import crypto from "node:crypto";

function parseArgs(argv) {
  const args = { "--cookie-name": "cb_gate" };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith("--")) args[argv[i]] = argv[i + 1] ?? "";
  }
  return args;
}
const args = parseArgs(process.argv);
const listen = args["--listen"] || "0.0.0.0:3080";
const upstream = args["--upstream"] || "127.0.0.1:3082";
const settingsPath = args["--settings"] || "/root/.dsh/settings.yaml";
const hostRewrite = args["--host-rewrite"] || "";
const cookieName = args["--cookie-name"];
const [upHost, upPort] = upstream.split(":");
const [liHost, liPort] = listen.split(":");

const HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);
const agent = new http.Agent({ keepAlive: true });

let cache = { mtimeMs: -1, token: "" };
function currentToken() {
  try {
    const st = fs.statSync(settingsPath);
    if (st.mtimeMs !== cache.mtimeMs) {
      let token = "";
      try {
        const text = fs.readFileSync(settingsPath, "utf8");
        const section = text.match(/^client-bind:\s*\n([\s\S]*?)(?=^\S|\s*$)/m);
        const t = section && section[1].match(/^\s+token:\s*(\S+)\s*$/m);
        token = t ? t[1] : "";
      } catch {}
      cache = { mtimeMs: st.mtimeMs, token };
    }
  } catch { cache = { mtimeMs: -1, token: "" }; }
  return cache.token;
}

function tokenOk(candidate, expected) {
  if (!candidate || !expected) return false;
  const a = crypto.createHash("sha256").update(String(candidate)).digest();
  const b = crypto.createHash("sha256").update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

function getCookie(headers) {
  const raw = String(headers.cookie || "");
  for (const part of raw.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === cookieName) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return "";
}

function authed(req, urlObj) {
  const token = currentToken();
  if (tokenOk(getCookie(req.headers), token)) return { ok: true, grant: false };
  const q = urlObj.searchParams.get("token");
  if (q !== null && tokenOk(q, token)) return { ok: true, grant: true };
  return { ok: false };
}

function isHello(urlObj) {
  return urlObj.pathname === "/client-bind/hello" || urlObj.pathname.startsWith("/client-bind/hello/");
}

function proxyHttp(req, res) {
  const headers = { ...req.headers };
  delete headers.connection;
  if (hostRewrite) headers.host = hostRewrite;
  const up = http.request({ host: upHost, port: Number(upPort), path: req.url, method: req.method, headers, agent }, (ur) => {
    const out = {};
    for (const [k, v] of Object.entries(ur.headers)) {
      if (HOP.has(k)) continue;
      out[k] = v;
    }
    if (res.grantCookie) {
      const existing = out["set-cookie"];
      out["set-cookie"] = Array.isArray(existing) ? [...existing, res.grantCookie] : [res.grantCookie];
    }
    res.writeHead(ur.statusCode || 502, out);
    ur.pipe(res);
  });
  up.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      res.end("client-bind gate: upstream unavailable");
    } else {
      res.destroy();
    }
  });
  req.pipe(up);
}

function grantCookieHeader(token) {
  return cookieName + "=" + encodeURIComponent(token) + "; HttpOnly; Path=/; Max-Age=31536000; SameSite=Lax";
}

const server = http.createServer((req, res) => {
  let urlObj;
  try { urlObj = new URL(req.url, "http://gate.local"); } catch { res.writeHead(400); return res.end(); }
  if (isHello(urlObj)) return proxyHttp(req, res);
  const verdict = authed(req, urlObj);
  if (!verdict.ok) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    return res.end("client-bind gate: 令牌缺失或不匹配 — 请从带 ?token= 的入口 URL 进入");
  }
  if (verdict.grant) res.grantCookie = grantCookieHeader(urlObj.searchParams.get("token"));
  proxyHttp(req, res);
});

server.on("upgrade", (req, socket, head) => {
  let urlObj;
  try { urlObj = new URL(req.url, "http://gate.local"); } catch { return socket.destroy(); }
  if (!isHello(urlObj) && !authed(req, urlObj).ok) {
    socket.write("HTTP/1.1 403 Forbidden\r\nconnection: close\r\ncontent-length: 0\r\n\r\n");
    return socket.destroy();
  }
  const target = net.connect(Number(upPort), upHost, () => {
    const lines = [req.method + " " + req.url + " HTTP/1.1"];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i];
      if (/^host$/i.test(name)) continue;
      lines.push(name + ": " + req.rawHeaders[i + 1]);
    }
    if (hostRewrite) lines.push("Host: " + hostRewrite);
    socket.write(lines.join("\r\n") + "\r\n\r\n");
    if (head.length) socket.write(head);
    socket.pipe(target);
    target.pipe(socket);
  });
  const kill = () => { socket.destroy(); target.destroy(); };
  target.on("error", kill);
  socket.on("error", kill);
});

server.listen(Number(liPort), liHost, () => {
  console.log("[dsh-gate] listening on " + listen + " -> " + upstream + " (token from " + settingsPath + ")");
});
