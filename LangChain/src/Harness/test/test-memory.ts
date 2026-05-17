/**
 * Memory 系统学习与测试脚本
 * 
 * 逐步展示三层记忆架构：
 *   Step 1: WorkingMemory — Agent 推理中间状态
 *   Step 2: ShortTermMemory — 对话历史 + 滑动窗口
 *   Step 3: CompositeMemory — 组合三层记忆 + 为 LLM 构造上下文
 *   Step 4: LongTermMemory — RAG 向量检索持久化（需要 Chroma）
 * 
 * 运行方式：
 *   tsx src/Harness/test/test-memory.ts
 * 
 * 前置条件：
 *   Step 4 需要 Chroma 服务运行中: chroma run --host localhost --port 8000
 */

import { ShortTermMemory } from "../src/services/memory/shortTermMemory.ts";
import { WorkingMemory } from "../src/services/memory/workingMemory.ts";
import { CompositeMemory } from "../src/services/memory/compositeMemory.ts";
import type { MemoryMessage } from "../src/services/memory/baseMemory.ts";
import { LongTermMemory } from "../src/services/memory/longTermMemory.ts";

// ==================== 辅助函数 ====================

function makeMessage(role: MemoryMessage["role"], content: string, extra?: Partial<MemoryMessage>): MemoryMessage {
  return {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    role,
    content,
    timestamp: new Date(),
    ...extra,
  };
}

function separator(title: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${"=".repeat(60)}\n`);
}

// ==================== Step 1: WorkingMemory ====================

async function testWorkingMemory() {
  separator("Step 1: WorkingMemory — Agent 推理中间状态");

  const wm = new WorkingMemory();

  // 设置当前任务
  wm.setCurrentTask("帮我分析 RAG 系统的设计");
  console.log("当前任务:", wm.getState().currentTask);

  // 添加推理步骤（模拟 ReAct Thought）
  wm.addReasoningStep("用户想了解 RAG 系统设计，我需要先检索相关文档");
  wm.addReasoningStep("从向量库中找到了 3 篇相关文档");
  wm.addReasoningStep("文档中提到 RAG 的核心流程是：检索 → 构造 Prompt → 生成");

  console.log("\n推理步骤:");
  wm.getState().reasoningSteps.forEach((step, i) => {
    console.log(`  Step ${i + 1}: ${step}`);
  });

  // 缓存工具结果
  wm.setToolResult("vectorSearch", { count: 3, topDoc: "RAG 概念介绍" });
  wm.setVariable("analysisResult", "RAG 是检索增强生成技术");

  console.log("\n工具结果:", JSON.stringify(wm.getState().toolResults, null, 2));
  console.log("自定义变量:", wm.getState().variables);

  // 搜索工作记忆
  console.log("\n搜索 'RAG':");
  const searchResults = await wm.search("RAG");
  searchResults.forEach(r => {
    console.log(`  [${r.source}] score=${r.score.toFixed(2)}: ${r.message.content.slice(0, 50)}`);
  });

  // 清空工作记忆（推理结束后）
  wm.clear();
  console.log("\n推理结束后清空, count:", wm.count());
}

// ==================== Step 2: ShortTermMemory ====================

async function testShortTermMemory() {
  separator("Step 2: ShortTermMemory — 对话历史 + 滑动窗口");

  // 窗口大小=5，只保留最近5条非 system 消息
  const stm = new ShortTermMemory({ windowSize: 5, enableSummary: true });

  // 系统消息（永远保留）
  await stm.add(makeMessage("system", "你是一个知识助手，请基于文档回答问题。"));

  // 模拟10轮对话
  const conversations = [
    "什么是 RAG？",
    "RAG 是检索增强生成技术...",
    "它解决了什么问题？",
    "它解决了知识时效性、私有数据访问和幻觉问题...",
    "Embedding 是什么？",
    "Embedding 将文本转为向量...",
    "向量数据库有哪些？",
    "常见的有 Chroma、Pinecone、FAISS...",
    "混合检索是什么？",
    "混合检索结合了向量检索和关键词检索...",
  ];

  for (const [i, content] of conversations.entries()) {
    const role = i % 2 === 0 ? "user" : "assistant";
    await stm.add(makeMessage(role, content));
  }

  console.log("窗口大小=5，添加了10条消息后:");
  console.log(`  实际保留: ${stm.count()} 条`);
  console.log(`  摘要缓存: ${stm.getSummary() ? stm.getSummary().slice(0, 80) + "..." : "无"}`);

  console.log("\n对话历史（滑动窗口后的内容）:");
  stm.getHistory().forEach((msg, i) => {
    console.log(`  ${i + 1}. [${msg.role}] ${msg.content.slice(0, 40)}...`);
  });

  // 搜索短期记忆
  console.log("\n搜索 '向量':");
  const results = await stm.search("向量");
  results.forEach(r => {
    console.log(`  score=${r.score.toFixed(2)}: [${r.message.role}] ${r.message.content.slice(0, 40)}...`);
  });
}

// ==================== Step 3: CompositeMemory ====================

async function testCompositeMemory() {
  separator("Step 3: CompositeMemory — 组合三层记忆");

  const memory = new CompositeMemory(
    { windowSize: 6, enableSummary: false },
    { importanceThreshold: 0.6 }, // 只有 importance>=0.6 才存入长期记忆
  );

  // 添加对话消息
  console.log("模拟一段对话:\n");

  // 系统提示
  await memory.add(makeMessage("system", "你是一个知识助手"));
  console.log("  [system] 你是一个知识助手 → ShortTerm only");

  // 闲聊（importance 低，不会存入 LongTerm）
  await memory.add(makeMessage("user", "你好"));
  console.log("  [user] 你好 → ShortTerm (importance 低,不入 LongTerm)");

  // 重要问题（importance 高，会同时存入 LongTerm）
  const importantMsg = makeMessage("user", "RAG 的定义和核心流程是什么？这个技术如何解决 LLM 的三大问题？", {
    importance: 0.8,
  });
  await memory.add(importantMsg);
  console.log("  [user] RAG 定义... → ShortTerm + LongTerm (importance=0.8)");

  // 重要回答
  await memory.add(makeMessage("assistant", "RAG（检索增强生成）是一种结合信息检索与文本生成的技术架构。它解决了LLM的知识时效性、私有数据访问和幻觉问题。核心流程是：检索→构造Prompt→生成。", {
    importance: 0.9,
  }));
  console.log("  [assistant] RAG 回答... → ShortTerm + LongTerm (importance=0.9)");

  // 工具调用
  await memory.add(makeMessage("tool", "3 篇文档被检索到", {
    tool_calls: [{ tool: "vectorSearch", parameters: { query: "RAG" } }],
    tool_result: { count: 3 },
  }));
  console.log("  [tool] 3篇文档 → ShortTerm + Working");

  // 查看各层状态
  console.log("\n--- 各层记忆状态 ---");
  console.log(`  ShortTerm: ${memory.getShortTerm().count()} 条`);
  console.log(`  Working: ${memory.getWorking().count()} 条`);
  console.log(`  Working 任务: ${memory.getWorking().getState().currentTask}`);

  // 获取 LLM 上下文
  console.log("\n--- 为 LLM 构造的 Prompt 上下文 ---");
  const context = await memory.getContext("RAG 是什么");
  console.log(context.toPrompt());

  // 统一搜索
  console.log("\n--- 统一搜索 'RAG' ---");
  const searchResults = await memory.search("RAG");
  searchResults.forEach(r => {
    console.log(`  [${r.source}] score=${r.score.toFixed(2)}: ${r.message.content.slice(0, 50)}...`);
  });
}

// ==================== Step 4: LongTermMemory (需要 Chroma) ====================

async function testLongTermMemory() {
  separator("Step 4: LongTermMemory — RAG 向量检索持久化");
  console.log("⚠️ 此步骤需要 Chroma 服务运行中");
  console.log("   chroma run --host localhost --port 8000\n");

  try {
    const ltm = new LongTermMemory();
    await ltm.initialize();

    // 存入重要知识
    console.log("存入重要知识:");
    await ltm.add(makeMessage("assistant", "RAG 是检索增强生成技术，核心流程包括索引阶段和查询阶段。", {
      importance: 0.9,
      conversationId: "conv_001",
    }));

    await ltm.add(makeMessage("assistant", "Embedding 将文本转为向量，语义相似的文本向量距离更近。", {
      importance: 0.8,
      conversationId: "conv_001",
    }));

    await ltm.add(makeMessage("user", "你好", {
      importance: 0.2, // 低重要性，应该被跳过
    }));

    console.log(`\n长期记忆数量: ${ltm.count()} (低重要性消息被跳过)`);

    // 搜索
    console.log("\n搜索 'RAG':");
    const results = await ltm.search("RAG");
    results.forEach(r => {
      console.log(`  score=${r.score.toFixed(2)}: ${r.message.content.slice(0, 50)}...`);
    });

  } catch (error: any) {
    console.log(`⚠️ LongTermMemory 测试失败: ${error.message}`);
    console.log("请确保 Chroma 服务正在运行");
  }
}

// ==================== Main ====================

async function main() {
  console.log("=== Memory 系统学习与测试 ===\n");
  console.log("三层记忆架构:");
  console.log("  ┌─────────────────────────────┐");
  console.log("  │  ShortTermMemory (对话历史)  │  ← 滑动窗口");
  console.log("  ├─────────────────────────────┤");
  console.log("  │  LongTermMemory  (持久知识) │  ← RAG/Chroma");
  console.log("  ├─────────────────────────────┤");
  console.log("  │  WorkingMemory   (推理状态) │  ← scratchpad");
  console.log("  └─────────────────────────────┘");

  await testWorkingMemory();
  await testShortTermMemory();
  await testCompositeMemory();
  await testLongTermMemory();

  console.log("\n=== Memory 学习总结 ===");
  console.log("1. WorkingMemory: 推理过程中的临时状态，推理结束清空");
  console.log("2. ShortTermMemory: 对话历史，滑动窗口控制大小");
  console.log("3. LongTermMemory: 重要知识持久化，通过 RAG 语义检索");
  console.log("4. CompositeMemory: 统一入口，自动路由 + 为 LLM 构造上下文");
}

main().catch(console.error);