#!/bin/bash
# dsh-client-bind gate 一键安装：token 门禁反代 + dsh 回绑回环。
# 可用环境变量覆盖默认值:
#   LISTEN=0.0.0.0:3080  UPSTREAM=127.0.0.1:3082  SETTINGS=/root/.dsh/settings.yaml
#   HOST_REWRITE=192.168.1.1   (转发给 dsh 的 Host 头，需在 dsh --trusted-host 列表内)
set -e
LISTEN="${LISTEN:-0.0.0.0:3080}"
UPSTREAM="${UPSTREAM:-127.0.0.1:3082}"
SETTINGS="${SETTINGS:-/root/.dsh/settings.yaml}"
HOST_REWRITE="${HOST_REWRITE:-192.168.1.1}"
SRC="$(cd "$(dirname "$0")" && pwd)/gate.mjs"
DEST=/usr/local/lib/dsh-client-bind-gate

install -D -m 0644 "$SRC" "$DEST/gate.mjs"

cat > /etc/systemd/system/dsh-gate.service <<EOF
[Unit]
Description=client-bind token gate (reverse proxy in front of dsh web)
After=network.target dsh-web.service
Requires=dsh-web.service

[Service]
ExecStart=/usr/bin/node $DEST/gate.mjs --listen $LISTEN --upstream $UPSTREAM --settings $SETTINGS --host-rewrite $HOST_REWRITE
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

# dsh web 回绑回环 + 换端口（幂等）
UNIT=/etc/systemd/system/dsh-web.service
if grep -q -- "--host 0.0.0.0" "$UNIT"; then
  sed -i 's/--host 0\.0\.0\.0/--host 127.0.0.1 --port 3082/' "$UNIT"
  echo "[install] dsh-web rebound to 127.0.0.1:3082"
fi

systemctl daemon-reload
systemctl enable --now dsh-gate >/dev/null 2>&1 || systemctl restart dsh-gate
systemctl restart dsh-web
systemctl restart dsh-poll-gateway 2>/dev/null || true

GATE_PORT="${LISTEN##*:}"
echo "[install] done: gate $LISTEN -> $UPSTREAM; verify with:"
echo "  curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$GATE_PORT/   # expect 403"
