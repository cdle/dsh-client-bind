window.__ModuleLoader__.load({
  id: "dsh-client-bind",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");

    var NAMESPACE = "client-bind";

    var FIELDS = [
      ["label", "机器名称"],
      ["ip", "IP（仅展示）"],
      ["username", "登陆用户名"],
      ["sshAlias", "ssh 别名（= URL 里 ssh= 的值）"],
      ["notes", "给 agent 的说明"]
    ];

    var inputStyle = { font: "inherit", fontSize: 13, padding: "7px 12px", borderRadius: 8, border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-layer-3)", color: "var(--dsw-alias-label-primary)", width: "100%", boxSizing: "border-box" };
    var btnStyle = { font: "inherit", fontSize: 12, padding: "5px 10px", borderRadius: 8, cursor: "pointer", border: "1px solid var(--dsw-alias-border-l2)", background: "none", color: "var(--dsw-alias-label-secondary)", whiteSpace: "nowrap" };
    var btnPrimary = { font: "inherit", fontSize: 13, padding: "6px 16px", borderRadius: 8, cursor: "pointer", border: "1px solid transparent", background: "var(--dsw-alias-label-primary)", color: "var(--dsw-alias-bg-layer-3)" };
    var muted = { fontSize: 12, color: "var(--dsw-alias-label-tertiary)" };
    var cardStyle = { border: "1px solid var(--dsw-alias-border-l2)", borderRadius: 8, padding: 10, marginBottom: 12, background: "var(--dsw-alias-bg-layer-3)" };

    function normalize(stored) {
      stored = stored || {};
      var machines = Array.isArray(stored.machines) ? stored.machines : [];
      return {
        token: typeof stored.token === "string" ? stored.token : "",
        injectTemplate: typeof stored.injectTemplate === "string" ? stored.injectTemplate : "",
        machines: machines.map(function (m) {
          m = m || {};
          return {
            label: typeof m.label === "string" ? m.label : "",
            ip: typeof m.ip === "string" ? m.ip : "",
            username: typeof m.username === "string" ? m.username : "",
            sshAlias: typeof m.sshAlias === "string" ? m.sshAlias : "",
            notes: typeof m.notes === "string" ? m.notes : ""
          };
        })
      };
    }

    function randomToken() {
      var bytes = new Uint8Array(12);
      crypto.getRandomValues(bytes);
      return Array.from(bytes).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
    }

    exports.inject = ["slots", "settingsScope", "connection", "remote"];
    function apply(ctx) {
      var scope = ctx.settingsScope.bind({ namespace: NAMESPACE });
      ctx.slots.inject("settings.plugin.item", function () {
        return ctx.slots.register({
          name: "settings.plugin.item",
          key: NAMESPACE,
          inject: function () { return { scope: scope }; }
        }, ClientBindCard);
      });
    }

    function ClientBindCard(props) {
      var scope = props.scope;
      var snapshot = React.useSyncExternalStore(
        React.useCallback(function (listener) { return scope.subscribe(listener); }, [scope]),
        function () { return scope.getSnapshot(); }
      );
      var stored = normalize(snapshot.value);
      var draftState = React.useState(null);
      var draft = draftState[0];
      var setDraft = draftState[1];
      var value = draft || stored;
      var savingState = React.useState(false);
      var saving = savingState[0];
      var setSaving = savingState[1];
      var msgState = React.useState("");
      var msg = msgState[0];
      var setMsg = msgState[1];
      var keygenState = React.useState({});
      var keygen = keygenState[0];
      var setKeygen = keygenState[1];
      var dirty = draft !== null;
      var readonly = snapshot.writable === false;

      function touch(next) { setDraft(next); setMsg(""); }
      function setField(i, key, v) {
        var next = JSON.parse(JSON.stringify(value));
        next.machines[i][key] = v;
        touch(next);
      }
      function addRow() {
        var next = JSON.parse(JSON.stringify(value));
        next.machines.push({ label: "", ip: "", username: "", sshAlias: "", notes: "" });
        touch(next);
      }
      function delRow(i) {
        var next = JSON.parse(JSON.stringify(value));
        next.machines.splice(i, 1);
        touch(next);
      }
      function regenToken() {
        var next = JSON.parse(JSON.stringify(value));
        next.token = randomToken();
        touch(next);
      }
      function validate() {
        var seen = {};
        for (var i = 0; i < value.machines.length; i++) {
          var m = value.machines[i];
          var a = m.sshAlias.trim();
          if (!a) return "第 " + (i + 1) + " 台机器的 ssh 别名不能为空";
          if (!/^[A-Za-z0-9_-]+$/.test(a)) return "ssh 别名只能用字母数字-_";
          if (seen[a]) return "ssh 别名重复: " + a;
          seen[a] = true;
        }
        return "";
      }
      function save() {
        var problem = validate();
        if (problem) { setMsg(problem); return; }
        setSaving(true);
        var run = function () {
          return scope.set("token", value.token).then(function () {
            return scope.set("machines", value.machines);
          }).then(function () {
            return scope.set("injectTemplate", value.injectTemplate);
          });
        };
        run().then(function () {
          setDraft(null);
          setMsg("已保存");
        }).catch(function (e) {
          setMsg("保存失败: " + ((e && e.message) || e));
        }).then(function () { setSaving(false); });
      }
      function genKey(i) {
        var m = value.machines[i];
        if (!m.sshAlias.trim()) { setMsg("该行没有 ssh 别名"); return; }
        var next = Object.assign({}, keygen);
        next[i] = { loading: true };
        setKeygen(next);
        fetch("/client-bind/keygen", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ alias: m.sshAlias.trim() })
        }).then(function (r) { return r.json(); }).then(function (out) {
          var n2 = Object.assign({}, keygen);
          n2[i] = out.error ? { error: out.error } : { publicKey: out.publicKey, identityFile: out.identityFile, warning: out.warning, created: out.created };
          setKeygen(n2);
        }).catch(function (e) {
          var n3 = Object.assign({}, keygen);
          n3[i] = { error: String(e) };
          setKeygen(n3);
        });
      }
      function copy(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () { setMsg("已复制"); }, function () { setMsg("复制失败，请手动选择"); });
        } else { setMsg("浏览器不支持自动复制，请手动选择"); }
      }

      var openState = React.useState(false);
      var open = openState[0];
      var setOpen = openState[1];
      var summary = value.machines.length > 0 ? value.machines.length + " 台机器已配置" : "尚未配置机器";
      var children = [];
      children.push(React.createElement("div", { key: "h2", style: { fontSize: 13, color: "var(--dsw-alias-label-tertiary)", lineHeight: 1.6, marginBottom: 8 } },
        "URL 带 ?ssh=<ssh 别名> 即完成对话级绑定；配置了部署令牌时还须携带 ?token=<令牌>，未配置则不鉴权。ssh 精确匹配、无 IP 兜底。"));

      children.push(React.createElement("div", { key: "authtoken", style: { marginTop: 4, marginBottom: 14 } },
        React.createElement("div", { style: { fontSize: 12, marginBottom: 4, color: "var(--dsw-alias-label-secondary)" } }, "部署级访问令牌 token（可选：留空则不鉴权）"),
        React.createElement("div", { style: { display: "flex", gap: 8 } },
          React.createElement("input", {
            style: Object.assign({}, inputStyle, { fontFamily: "monospace" }),
            value: value.token,
            placeholder: "留空则不鉴权",
            onChange: function (e) {
              var next = JSON.parse(JSON.stringify(value));
              next.token = e.target.value;
              touch(next);
            }
          }),
          React.createElement("button", { style: btnStyle, onClick: regenToken, title: "重新生成令牌" }, "🎲 重新生成"))));

      value.machines.forEach(function (m, i) {
        var qs = value.token.trim() ? "?token=" + encodeURIComponent(value.token.trim()) + "&ssh=" + encodeURIComponent(m.sshAlias.trim()) : "?ssh=" + encodeURIComponent(m.sshAlias.trim());
        var url = m.sshAlias.trim() ? location.origin + qs : "";
        var row = [React.createElement("div", { key: "rt", style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 6 } },
          React.createElement("span", { style: { fontWeight: 600, fontSize: 13 } }, m.label || "机器 " + (i + 1)),
          React.createElement("button", { style: btnStyle, onClick: function () { genKey(i); } }, "🔑 生成密钥"),
          url ? React.createElement("button", { style: btnStyle, onClick: function () { copy(url); } }, "复制入口 URL") : null,
          React.createElement("span", { style: { flex: 1 } }),
          React.createElement("button", { style: Object.assign({}, btnStyle, { color: "var(--dsw-alias-label-error)" }), onClick: function () { delRow(i); } }, "删除"))];
        FIELDS.forEach(function (f) {
          var isNotes = f[0] === "notes";
          row.push(React.createElement("label", { key: f[0], style: { display: "block", marginBottom: 6 } },
            React.createElement("span", { style: { display: "block", fontSize: 12, marginBottom: 3, color: "var(--dsw-alias-label-tertiary)" } }, f[1]),
            isNotes
              ? React.createElement("textarea", {
                  style: Object.assign({}, inputStyle, { minHeight: 44, resize: "vertical" }),
                  value: m.notes,
                  onChange: function (e) { setField(i, "notes", e.target.value); }
                })
              : React.createElement("input", {
                  style: Object.assign({}, inputStyle, f[0] === "ip" || f[0] === "sshAlias" ? { fontFamily: "monospace" } : {}),
                  value: m[f[0]],
                  onChange: function (e) { setField(i, f[0], e.target.value); }
                })));
        });
        if (url) row.push(React.createElement("div", { key: "url", style: Object.assign({}, muted, { marginBottom: 6, wordBreak: "break-all" }) }, "入口 URL: ", url));
        var kg = keygen[i];
        if (kg) {
          if (kg.loading) row.push(React.createElement("div", { key: "kg", style: muted }, "正在生成密钥…"));
          else if (kg.error) row.push(React.createElement("div", { key: "kg", style: { fontSize: 12, color: "var(--dsw-alias-label-error)", marginBottom: 6 } }, kg.error));
          else {
            row.push(React.createElement("div", { key: "kg", style: { marginBottom: 6 } },
              React.createElement("div", { style: Object.assign({}, muted, { marginBottom: 3 }) },
                (kg.created ? "已生成 ed25519 密钥对。" : "密钥已存在。") + " 把公钥追加到该机器的 authorized_keys 后即可免密登陆：" + (kg.warning || "")),
              React.createElement("textarea", {
                readOnly: true,
                style: Object.assign({}, inputStyle, { minHeight: 52, fontFamily: "monospace", fontSize: 12 }),
                value: kg.publicKey,
                onFocus: function (e) { e.target.select(); }
              }),
              React.createElement("div", { style: { marginTop: 4 } },
                React.createElement("button", { style: btnStyle, onClick: function () { copy(kg.publicKey); } }, "复制公钥"))));
          }
        }
        children.push(React.createElement("div", { key: "row" + i, style: cardStyle }, row));
      });

      children.push(React.createElement("div", { key: "add" },
        React.createElement("button", { style: { font: "inherit", fontSize: 12, padding: "8px 10px", borderRadius: 8, cursor: "pointer", border: "1px dashed var(--dsw-alias-border-l2)", background: "none", color: "var(--dsw-alias-label-secondary)", width: "100%" }, onClick: addRow }, "+ 添加机器")));

      children.push(React.createElement("div", { key: "tpl", style: { marginTop: 12 } },
        React.createElement("div", { style: { fontSize: 12, marginBottom: 4, color: "var(--dsw-alias-label-secondary)" } },
          "注入模板（占位符 {{label}} {{sshAlias}} {{username}} {{ip}} {{notes}} {{ts}}；值为空的行整行省略；留空用内置默认）"),
        React.createElement("textarea", {
          style: Object.assign({}, inputStyle, { minHeight: 90, fontFamily: "monospace", fontSize: 12, resize: "vertical" }),
          value: value.injectTemplate,
          placeholder: "（内置默认模板）",
          onChange: function (e) {
            var next = JSON.parse(JSON.stringify(value));
            next.injectTemplate = e.target.value;
            touch(next);
          }
        })));

      children.push(React.createElement("div", { key: "actions", style: { display: "flex", alignItems: "center", gap: 10, marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--dsw-alias-border-l2)" } },
        React.createElement("span", { style: Object.assign({}, muted, { flex: 1, minWidth: 0 }) }, readonly ? "当前连接不可写（设置域未就绪）" : (msg || "")),
        dirty ? React.createElement("button", { style: btnStyle, onClick: function () { setDraft(null); setMsg(""); } }, "放弃更改") : null,
        React.createElement("button", { style: Object.assign({}, btnPrimary, saving || !dirty || readonly ? { opacity: 0.4, cursor: "default" } : {}), disabled: saving || !dirty || readonly, onClick: save }, saving ? "保存中…" : "保存")));

      return React.createElement("li", {
        style: { listStyle: "none", borderRadius: 12, border: "1px solid var(--dsw-alias-border-l2)", background: open ? "var(--dsw-alias-bg-layer-2)" : "var(--dsw-alias-bg-layer-3)", transition: "border-color .16s, background .16s" }
      },
        React.createElement("button", {
          type: "button", onClick: function () { setOpen(!open); },
          style: { appearance: "none", width: "100%", font: "inherit", textAlign: "left", cursor: "pointer", background: "none", border: "0", borderRadius: 12, color: "inherit", display: "flex", alignItems: "center", gap: 12, padding: "14px 16px" }
        },
          React.createElement("div", { style: { display: "flex", flexDirection: "column", flex: 1, gap: 2, minWidth: 0 } },
            React.createElement("span", { style: { fontSize: 15, fontWeight: 600, color: "var(--dsw-alias-label-primary)", lineHeight: 1.4 } }, "机器绑定"),
            React.createElement("span", { style: { fontSize: 13, color: "var(--dsw-alias-label-tertiary)", lineHeight: 1.5 } }, summary)),
          dirty ? React.createElement("span", { style: { whiteSpace: "nowrap", background: "var(--dsw-alias-bg-module-platform)", color: "var(--dsw-alias-label-secondary)", borderRadius: 999, flex: "none", padding: "1px 8px", fontSize: 11, fontWeight: 500, lineHeight: "17px" } }, "未保存") : null,
          React.createElement("svg", { viewBox: "0 0 24 24", width: 14, height: 14, fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", style: { flex: "none", color: "var(--dsw-alias-label-tertiary)", transform: open ? "rotate(180deg)" : "none", transition: "transform .16s" } },
            React.createElement("path", { d: "M6 9l6 6 6-6" }))),
        open ? React.createElement("div", { style: { borderTop: "1px solid var(--dsw-alias-border-l2)", margin: "0 16px", padding: "12px 0 8px" } }, children) : null);
    }

    exports.apply = apply;
    return module.exports;
  }
});
