#!/bin/zsh
# 一键启动：抓包代理 + Claude Code（这是唯一会被抓包的启动方式）
# 链路：claude → proxy(8899, 抓包) → ccr(3457, 路由) → wanqing
# 注：直接运行 ccr code 会绕过本代理（ccr 强制注入自己的地址），不会被抓包
cd "$(dirname "$0")"

# 代理没跑就后台拉起
if ! lsof -nP -iTCP:8899 -sTCP:LISTEN >/dev/null 2>&1; then
  nohup node proxy.mjs > /tmp/api-proxy.log 2>&1 &
  sleep 1
  echo "✅ 抓包代理已启动: 8899 (面板 http://127.0.0.1:8898)"
else
  echo "ℹ️ 抓包代理已在运行"
fi

# 手动注入 base URL（ccr code 不参与，不会被覆盖）
# ANTHROPIC_AUTH_TOKEN 给占位值即可跳过 /login：真正鉴权在 ccr 层（wanqing key 在 ccr 配置里）
ANTHROPIC_BASE_URL=http://127.0.0.1:8899/api/anthropic \
ANTHROPIC_AUTH_TOKEN=via-proxy-dummy-token \
exec claude "$@"
