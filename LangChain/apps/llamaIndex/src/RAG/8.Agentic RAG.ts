/**
 * Agentic RAG - 基于 Agent 的动态检索增强生成系统
 * 
 * 核心特性：
 * 1. ReAct 循环：Thought → Action → Observation
 * 2. 多工具调用：检索、搜索、计算等
 * 3. 记忆系统：短期对话历史 + 长期用户偏好
 * 4. 智能路由：基于问题类型自动选择工具
 * 5. 错误处理：超时、降级、重试机制
 */

import path from "path";
import fs from "fs";
import * as readline from "readline";

// ─── LlamaIndex 核心模块 ────────────────────────────────────────────
import { SimpleDirectoryReader } from "@llamaindex/readers/directory";
import { Document, TextNode } from "@llamaindex/core/schema";
import {
  VectorStoreIndex,
  storageContextFromDefaults,
} from "llamaindex";
import { Settings } from "@llamaindex/core/global";

// ─── 本地模块 ────────────────────────────────────────────────────────
import { initGlobalSettings } from "../config.ts";
import { tokenTracker } from "../llm.ts";
import { LLMChunk } from "../check/index.ts";
import { FILE_DIR, STORAGE_DIR, CACHE_NAIVE } from "../constants.ts";

// ═══════════════════════════════════════════════════════════════════════
//  Step 0: 初始化全局配置
// ═══════════════════════════════════════════════════════════════════════
initGlobalSettings();

// ═══════════════════════════════════════════════════════════════════════
//  缓存检查：如果已有持久化索引，直接加载，跳过整个构建流程
// ═══════════════════════════════════════════════════════════════════════
const storageContext = await storageContextFromDefaults({ persistDir: STORAGE_DIR });

let index: VectorStoreIndex;
const hasExistingIndex = fs.existsSync(path.join(STORAGE_DIR, "docstore.json"));

if (hasExistingIndex) {
  console.log("📂 检测到已有持久化索引，直接加载...");
  index = await VectorStoreIndex.init({ storageContext });
  console.log(`✅ 索引加载完成`);
} else {
  // 没有持久化索引 → 加载或构建节点

  // ═══════════════════════════════════════════════════════════════════
  //  Step 1-2: 加载文件 + 切分（优先从缓存加载）
  // ═══════════════════════════════════════════════════════════════════
  let nodes: TextNode[];
  const hasCachedNodes = fs.existsSync(CACHE_NAIVE);

  if (hasCachedNodes) {
    console.log("📂 检测到切分缓存，直接加载...");
    const cached = JSON.parse(fs.readFileSync(CACHE_NAIVE, "utf-8"));
    nodes = cached.map(
      (item: { text: string; id_: string }) =>
        new TextNode({ text: item.text, id_: item.id_ }),
    );
    console.log(`📊 从缓存加载 ${nodes.length} 个 chunk`);
  } else {
    // Step 1: 加载文件
    const reader = new SimpleDirectoryReader();
    const documents = await reader.loadData({ directoryPath: FILE_DIR });
    console.log(`✅ 共加载 ${documents.length} 个文档`);
    const fullText = documents.map((d: Document) => d.text).join("\n\n");
    console.log(`📊 合并后总字符数: ${fullText.length}`);

    // Step 2: 切分
    const splitter = new LLMChunk({ chunkSize: 512, chunkOverlap: 20 });
    const chunks = await splitter.splitText(fullText);
    nodes = chunks.map((text, i) => new TextNode({ text, id_: `llm-chunk-${i}` }));
    console.log(`📊 切分出 ${nodes.length} 个 chunk`);

    // 缓存切分结果（避免下次重新 LLM 切分）
    const cacheDir = path.dirname(CACHE_NAIVE);
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(
      CACHE_NAIVE,
      JSON.stringify(nodes.map((n) => ({ text: n.text, id_: n.id_ })).sort()),
      "utf-8",
    );
    console.log(`💾 切分结果已缓存到 ${CACHE_NAIVE}`);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Step 3: 向量化 & 建索引（含持久化）
  // ═══════════════════════════════════════════════════════════════════
  console.log("⏳ 正在生成 embedding 并构建向量索引...");
  index = await VectorStoreIndex.init({ nodes, storageContext });
  console.log(`✅ 向量数据库构建完成`);
  console.log(`   📦 节点数: ${nodes.length}`);
  console.log(`   💾 持久化路径: ${STORAGE_DIR}`);
}

// ═══════════════════════════════════════════════════════════════════════
//  Step 1-2: 定义 Agentic RAG 工具集
// ═══════════════════════════════════════════════════════════════════════

interface Tool {
  name: string;
  description: string;
  parameters: Record<string, any>;
  execute: (params: any) => Promise<any>;
}

// 工具1: 知识库检索
const retrievalTool: Tool = {
  name: "retrieve",
  description: "从本地知识库检索与查询相关的信息片段。适用于回答关于文档内容的问题。",
  parameters: {
    query: { type: "string", description: "检索查询文本" },
    topK: { type: "number", default: 5, description: "返回结果数量（默认5）" }
  },
  execute: async ({ query, topK = 5 }: { query: string; topK?: number }) => {
    const retriever = index.asRetriever({ similarityTopK: topK });
    const nodes = await retriever.retrieve(query);
    
    return nodes.map((n, i) => ({
      index: i + 1,
      text: n.node.text,
      score: n.score,
      metadata: n.node.metadata
    }));
  }
};

// 工具2: 计算器
const calculatorTool: Tool = {
  name: "calculate",
  description: "执行数学计算。适用于需要数值计算的场景。",
  parameters: {
    expression: { type: "string", description: "数学表达式，如 '2 + 2' 或 '100 * 0.15'" }
  },
  execute: async ({ expression }: { expression: string }) => {
    try {
      // 安全的表达式求值（仅允许基本运算）
      const sanitized = expression.replace(/[^0-9+\-*/().\s]/g, '');
      const result = Function(`"use strict"; return (${sanitized})`)();
      return { expression, result };
    } catch (error) {
      return { error: "无法计算该表达式", expression };
    }
  }
};

// 工具注册表
class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  
  register(tool: Tool) {
    this.tools.set(tool.name, tool);
  }
  
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }
  
  list(): Tool[] {
    return Array.from(this.tools.values());
  }
  
  getDescription(): string {
    return this.list().map(t => 
      `- ${t.name}: ${t.description}\n  参数: ${JSON.stringify(t.parameters, null, 2)}`
    ).join("\n\n");
  }
}

const registry = new ToolRegistry();
registry.register(retrievalTool);
registry.register(calculatorTool);

console.log(`✅ 已注册 ${registry.list().length} 个工具`);

// ═══════════════════════════════════════════════════════════════════════
//  Step 3: 实现 ReAct 循环
// ═══════════════════════════════════════════════════════════════════════

interface ReactHistory {
  thought: string;
  action: string;
  observation?: string;
}

const MAX_ITERATIONS = 5;

const REACT_SYSTEM_PROMPT = `你是一个智能助手，使用 ReAct (Reasoning + Acting) 模式回答问题。

可用工具：
{tools_description}

工作流程：
1. Thought: 分析当前情况，决定下一步需要什么信息或操作
2. Action: 选择工具并执行，格式为 TOOL_NAME[parameters]
3. Observation: 查看工具返回的结果
4. 重复以上步骤直到有足够信息回答问题

当你可以回答问题时，使用：Finish[最终答案]

重要规则：
- 每次只执行一个工具
- 仔细观察工具返回的结果
- 如果信息不足，继续检索或搜索
- 如果信息充足，立即给出答案
- 不要编造信息，基于观察到的内容回答
- 对于简单问答可以直接 Finish，无需使用工具

示例 1（需要检索）：
Question: CRISPE框架是什么？
Thought: 我需要从知识库检索CRISPE框架的定义和要素
Action: retrieve["CRISPE框架", 5]
Observation: [检索到5个相关片段...]
Thought: 我已经获得了足够的信息来回答这个问题
Finish: CRISPE框架是一种提示词工程框架...

示例 2（需要计算）：
Question: 100的15%是多少？
Thought: 这是一个数学计算问题，我需要使用计算器
Action: calculate["100 * 0.15"]
Observation: {"expression": "100 * 0.15", "result": 15}
Thought: 计算完成，我可以给出答案了
Finish: 100的15%是15。

示例 3（简单问答）：
Question: 你好
Thought: 这是一个简单的问候，不需要使用工具
Finish: 你好！有什么可以帮助你的吗？

当前问题：{question}
历史对话：
{history}

请开始你的思考：`;

async function generateThought(
  question: string,
  history: ReactHistory[]
): Promise<string> {
  const prompt = REACT_SYSTEM_PROMPT
    .replace("{question}", question)
    .replace("{history}", formatHistory(history))
    .replace("{tools_description}", registry.getDescription());
  
  const response = await Settings.llm.invoke(prompt);
  const content = typeof response === 'string' ? response : response.content || response.message?.content;
  
  // 提取 Thought 部分
  const thoughtMatch = content.match(/Thought:\s*(.+?)(?:\nAction:|$)/s);
  return thoughtMatch ? thoughtMatch[1].trim() : content;
}

async function decideAction(
  thought: string
): Promise<{ tool: string; params: any; response?: string }> {
  const prompt = `
基于以下思考，选择合适的工具：

思考：${thought}

可用工具：
${registry.getDescription()}

输出 JSON 格式：
{
  "tool": "工具名称或'finish'",
  "params": {},
  "response": "最终答案（仅当tool为'finish'时需要）"
}

注意：
- 如果需要检索，使用 retrieve，params: {"query": "...", "topK": 5}
- 如果需要计算，使用 calculate，params: {"expression": "..."}
- 如果可以回答问题，使用 finish，params: {}，并提供 response
`;
  
  const response = await Settings.llm.invoke(prompt);
  const content = typeof response === 'string' ? response : response.content || response.message?.content;
  
  try {
    // 尝试解析 JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const decision = JSON.parse(jsonMatch[0]);
      return {
        tool: decision.tool || "finish",
        params: decision.params || {},
        response: decision.response
      };
    }
  } catch (error) {
    console.warn("⚠️ JSON 解析失败，使用正则降级");
  }
  
  // 降级：使用正则解析
  const finishMatch = content.match(/Finish\[([\s\S]+?)\]/s);
  if (finishMatch) {
    return { tool: "finish", params: {}, response: finishMatch[1].trim() };
  }
  
  const actionMatch = content.match(/(\w+)\[([\s\S]+?)\]/s);
  if (actionMatch) {
    const toolName = actionMatch[1];
    const paramsStr = actionMatch[2];
    
    // 尝试解析参数
    try {
      const params = JSON.parse(paramsStr);
      return { tool: toolName, params };
    } catch {
      // 简单参数解析
      return { 
        tool: toolName, 
        params: { query: paramsStr.trim() } 
      };
    }
  }
  
  throw new Error("无法解析 Action 决策");
}

async function executeTool(
  toolName: string,
  params: any
): Promise<string> {
  const tool = registry.get(toolName);
  
  if (!tool) {
    return `错误：未找到工具 "${toolName}"`;
  }
  
  try {
    const result = await tool.execute(params);
    
    // 格式化结果为文本
    if (Array.isArray(result)) {
      return result.map((item) => 
        `[${item.index}] (相似度: ${(item.score * 100).toFixed(1)}%)\n${item.text.substring(0, 200)}...`
      ).join("\n\n");
    }
    
    return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
  } catch (error) {
    return `工具执行错误：${error instanceof Error ? error.message : String(error)}`;
  }
}

function formatHistory(history: ReactHistory[]): string {
  if (history.length === 0) return "无";
  
  return history.map((h, i) => 
    `[第${i + 1}轮]\nThought: ${h.thought}\nAction: ${h.action}${h.observation ? `\nObservation: ${h.observation.substring(0, 150)}...` : ''}`
  ).join("\n\n");
}

async function reactLoop(userQuery: string): Promise<{
  answer: string;
  iterations: number;
  history: ReactHistory[];
  sources?: any[];
}> {
  let iterations = 0;
  const history: ReactHistory[] = [];
  let finalAnswer = "";
  let sources: any[] = [];
  
  while (iterations < MAX_ITERATIONS) {
    iterations++;
    console.log(`\n🔄 第 ${iterations}/${MAX_ITERATIONS} 轮迭代`);
    
    // 1. Thought: 分析当前状态
    const thought = await generateThought(userQuery, history);
    console.log(`💭 Thought: ${thought.substring(0, 100)}...`);
    
    // 2. Action: 决定下一步行动
    const action = await decideAction(thought);
    console.log(`🎯 Action: ${action.tool}`);
    
    const historyItem: ReactHistory = {
      thought,
      action: `${action.tool}(${JSON.stringify(action.params)})`
    };
    
    if (action.tool === "finish") {
      // 3. 给出最终答案
      console.log(`✅ 完成任务`);
      finalAnswer = action.response || await generateFinalAnswer(userQuery, history);
      break;
    }
    
    // 4. Observation: 执行工具并观察结果
    const observation = await executeTool(action.tool, action.params);
    console.log(`👁️  Observation: ${observation.substring(0, 100)}...`);
    
    historyItem.observation = observation;
    history.push(historyItem);
    
    // 收集来源（如果是检索工具）
    if (action.tool === "retrieve") {
      try {
        const obsData = JSON.parse(observation);
        if (Array.isArray(obsData)) {
          sources = obsData;
        }
      } catch {
        // 忽略解析错误
      }
    }
  }
  
  if (!finalAnswer) {
    // 达到最大迭代次数，尽力回答
    console.log("⚠️ 达到最大迭代次数，基于已有信息生成答案");
    finalAnswer = await generateBestEffortAnswer(userQuery, history);
  }
  
  return {
    answer: finalAnswer,
    iterations,
    history,
    sources: sources.length > 0 ? sources : undefined
  };
}

async function generateFinalAnswer(
  question: string,
  history: ReactHistory[]
): Promise<string> {
  const prompt = `
问题：${question}

思考过程：
${formatHistory(history)}

请基于以上思考过程和观察结果，给出准确、完整的最终答案。
`;
  
  const response = await Settings.llm.invoke(prompt);
  return typeof response === 'string' ? response : response.content || response.message?.content;
}

async function generateBestEffortAnswer(
  question: string,
  history: ReactHistory[]
): Promise<string> {
  const prompt = `
问题：${question}

已达到最大迭代次数。基于以下有限的信息，尽力给出最佳答案：

${formatHistory(history)}

如果信息不足，请明确指出。
`;
  
  const response = await Settings.llm.invoke(prompt);
  return typeof response === 'string' ? response : response.content || response.message?.content;
}

// ═══════════════════════════════════════════════════════════════════════
//  Step 7: 交互式查询
// ═══════════════════════════════════════════════════════════════════════

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function prompt(): Promise<string> {
  return new Promise((resolve) => {
    rl.question("👤 你: ", (answer) => {
      resolve(answer.trim());
    });
  });
}

async function chatLoop() {
  console.log("\n" + "=".repeat(60));
  console.log("🤖 Agentic RAG 系统已启动");
  console.log("💡 提示：输入问题，Agent 将自主决定如何使用工具");
  console.log("🛠️  可用工具：retrieve（检索）、calculate（计算）");
  console.log("🚪 退出：输入 'exit' 或 'quit'");
  console.log("=".repeat(60) + "\n");
  
  while (true) {
    let query: string;
    try {
      query = await prompt();
    } catch {
      // readline 已关闭（如 pipe 输入结束）
      break;
    }
    
    if (!query || query.toLowerCase() === "exit" || query.toLowerCase() === "quit") {
      console.log("\n👋 再见！");
      rl.close();
      tokenTracker.printUsage();
      break;
    }

    console.log("\n⏳ Agent 思考中...\n");
    
    try {
      const startTime = Date.now();
      const result = await reactLoop(query);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      
      console.log("\n" + "─".repeat(60));
      console.log("🤖 Agent 回答:");
      console.log(result.answer);
      console.log("─".repeat(60));
      
      if (result.sources && result.sources.length > 0) {
        console.log("\n📎 参考来源:");
        result.sources.forEach((source, i) => {
          console.log(`  [${i+1}] (相似度: ${(source.score * 100).toFixed(1)}%)`);
          console.log(`      ${source.text.substring(0, 80)}...`);
        });
      }
      
      console.log(`\n📊 统计:`);
      console.log(`  • 迭代次数: ${result.iterations}`);
      console.log(`  • 耗时: ${elapsed}s`);
      console.log(`  • Token 使用: 见上方日志`);
      console.log("\n" + "=".repeat(60) + "\n");
      
    } catch (err) {
      console.error("❌ 出错:", err instanceof Error ? err.message : String(err));
      console.log("💡 提示：请尝试简化问题或重新表述\n");
    }
  }
}

chatLoop();
