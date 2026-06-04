#!/bin/bash

# 停止本地 Ollama 服务，释放内存
if curl -s -o /dev/null -w "%{http_code}" http://localhost:11434/api/tags 2>/dev/null | grep -q 200; then
  echo "⏹️  正在停止本地 Ollama 服务..."
  killall ollama 2>/dev/null
  echo "✅ Ollama 已停止，内存已释放"
else
  echo "ℹ️  Ollama 未运行，无需停止"
fi

# 启动远程 LLM 应用
echo "🚀 正在连接远程 LLM 应用..."
tsx --env-file=../../.env ./index.ts