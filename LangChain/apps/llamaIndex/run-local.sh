#!/bin/bash

MODEL="qwen2.5:7b"

# ---------- 1. 检查 Ollama 服务 ----------
if ! curl -s -o /dev/null -w "%{http_code}" http://localhost:11434/api/tags 2>/dev/null | grep -q 200; then
  echo "❌ Ollama 服务未运行"
  read -p "是否启动 Ollama？(y/n): " choice
  if [ "$choice" = "y" ] || [ "$choice" = "Y" ]; then
    echo "⏳ 正在启动 Ollama..."
    open -a Ollama
    for i in $(seq 1 30); do
      if curl -s -o /dev/null -w "%{http_code}" http://localhost:11434/api/tags 2>/dev/null | grep -q 200; then
        echo "✅ Ollama 已就绪"
        break
      fi
      if [ "$i" -eq 30 ]; then
        echo "❌ Ollama 启动超时，请手动运行: ollama serve"
        exit 1
      fi
      sleep 1
    done
  else
    echo "🚫 已取消，退出"
    exit 1
  fi
fi
echo "✅ Ollama 服务运行中"

# ---------- 2. 检查 qwen2.5:7b 模型 ----------
echo "🔍 检测到模型 $MODEL 未加载到内存"
read -p "是否将 $MODEL 加载到内存？(y/n): " load_choice
if [ "$load_choice" = "y" ] || [ "$load_choice" = "Y" ]; then
  echo "⏳ 正在加载模型 $MODEL 到内存..."
  curl -s -X POST http://localhost:11434/api/generate \
    -d "{\"model\": \"$MODEL\", \"prompt\": \"ping\", \"stream\": false}" > /dev/null 2>&1
  if [ $? -eq 0 ]; then
    echo "✅ 模型 $MODEL 已加载就绪"
  else
    echo "❌ 模型 $MODEL 加载失败，请执行: ollama pull $MODEL"
    exit 1
  fi
else
  echo "🚫 已取消加载，退出"
  exit 1
fi

# ---------- 3. 启动应用 ----------
echo "🚀 正在启动本地 LLM 应用..."
LOCAL=local tsx --env-file=../../.env src/index.ts