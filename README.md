# dsh-client-bind

[简体中文](./README.md) | [English](./README.en.md)

令牌门禁的对话级机器绑定插件，适用于 [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh) Web GUI。

访客通过带参数的入口 URL 打开 GUI：`?ssh=<ssh 别名>` 选择目标机器，配置了部署令牌时还须携带 `?token=<令牌>` 通过鉴权。插件在对话首回合由**服务端确定性代码**注入绑定提示：已绑定机器的详情（ssh 别名、登陆用户名、机器说明等），外加其余已配置机器的清单——严格匹配、无 IP 反解兜底。

## 特性

- **令牌门禁（可选）**：配置部署令牌后，入口 URL 必须携带匹配的 `?token=`；留空则不鉴权
- **ssh 别名选机器**：与 `~/.ssh/config` 天然对齐，agent 优先用别名访问机器
- **每机器 agent 说明**：系统、shell、包管理器、注意事项——随绑定注入给 agent
- **全量机器注入**：除绑定机器外，其余已配置机器也随首回合一并注入，agent 可按名称/别名切换访问
- **配置卡片**：设置 → 插件内管理机器（增删改、令牌重生成、复制入口 URL）
- **一键密钥**：ed25519 密钥对生成 + 自动维护 `~/.ssh/config` 别名块（仅动自己标记的块，不碰用户手写的 Host）
- **自托管信标**：心跳脚本经 index 注入下发，浏览器每 30 秒上报，无需任何上游补丁
- **主题自适应**：卡片全部使用 `--dsw-alias-*` 设计令牌，明暗主题自动跟随

## 安装

**方式一 · git clone**（推荐，便于跟随更新）：

```bash
cd <profile>/node_modules    # 通常是 /root/.dsh/profiles/web/node_modules
git clone https://github.com/cdle/dsh-client-bind.git
```

然后把 `"dsh-client-bind"` 加入 profile manifest（`<profile>/package.json`）：

```json
{
  "dsh": {
    "profile": {
      "bundles": [ "...", "dsh-client-bind" ]
    }
  }
}
```

**方式二 · npm 包**（待发布后）：`pnpm add dsh-client-bind` 或经插件市场安装。

重启 dsh 生效。

## 配置

两处都可以：bundle patch 种子（部署即生效）或设置 → 插件 → **机器绑定** 卡片（用户层覆盖种子）。

```yaml
- insert:
    - id: client-bind
      name: dsh-client-bind
- id: client-bind
  config:
    token: ""            # 部署级访问令牌：可选；留空不鉴权
    machines: []         # 机器列表：留空后在卡片里添加
```

每台机器的字段：

| 字段 | 说明 |
|---|---|
| 机器名称 | 注入给 agent 展示 |
| ssh 别名 | **机器身份** = URL 里 `ssh=` 的值；也是生成 `~/.ssh/config` 块的 Host |
| 登陆用户名 | 注入给 agent |
| IP | 仅展示，不参与识别 |
| 给 agent 的说明 | 系统、shell、包管理器、sudo 注意事项等 |

生成部署令牌：`node -e 'console.log(require("crypto").randomBytes(12).toString("hex"))'`

## 使用

1. 设置 → 插件 → **机器绑定**，配置令牌（可选）并添加机器
2. 每台机器点 **复制入口 URL**，形如 `http://<host>:3080/?token=<令牌>&ssh=<别名>`
3. 在该机器的浏览器打开入口 URL
4. 开新对话——首回合即出现绑定提示（已绑定机器详情 + 其余已配置机器清单）；此后"本机/这台电脑/我电脑"一律指该机器，提到其他机器则经其 ssh 别名访问，命令按目标机器的系统语法执行
5. 需要免密 ssh 时点 **🔑 生成密钥**，把公钥追加到目标机器的 `authorized_keys`

## 安全说明

- 令牌防的是**误绑与冒充**，不是加密：局域网内拿到 URL 即可进入对应绑定
- `notes` 会注入到每个绑定该机器的对话—— secrets（sudo 密码等）放这里的前提是你接受这一点
- 令牌经 localStorage 持久化，仅在该浏览器后续访问时自动上报
- 插件不监听公网；部署是否暴露公网由你的 dsh 配置决定

## 插件开发契约（四条踩坑实录）

给要写 dsh 双面插件的人：

1. **客户端入口收录**：必须 `"exports": { "./client": "./dist/client.js" }`。`dsh-client-modules` 只服务能解析该子路径的包。宿主半区正常但卡片不出现，多半是这条。
2. **settings 注册**：`ctx.inject(["settings"], (sctx) => { scope = sctx.settings.register(ns, Config, { base: config }) })`——回调参数是**上下文**，服务在 `.settings` 上。直接在参数上调 `.register` 会抛错且命名空间静默消失。
3. **index 注入行**：字段是 `kind: "script"` 不是 `type`——写错会让 index 渲染抛异常、全站 400，而 boot 依然"成功"。
4. **卡片样式**：只用 `--dsw-alias-*` 令牌（`label-primary/secondary/tertiary`、`border-l2`、`bg-layer-3`、`brand-primary`、`label-error`），13px 正文 / 12px 次要、圆角 8。硬编码颜色必破明暗主题。

## License

[MIT](./LICENSE)
