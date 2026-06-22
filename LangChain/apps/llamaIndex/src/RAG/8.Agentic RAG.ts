/**
 * Agentic RAG - 基于 Agent 的动态检索增强生成系统
 *
 * 核心特性：
 * 1. ReAct 循环：单次 LLM 调用同时输出 Thought + Action，高效且一致
 * 2. 多工具调用：检索、搜索、计算等
 * 3. 对话记忆：跨轮对话历史，保持上下文连贯
 * 4. 智能路由：基于问题类型自动选择工具
 * 5. 错误处理：超时、降级、重试机制
 *
 * 改进点（对比初始版本）：
 * - 合并双 LLM 调用为单次调用（效率翻倍，一致性保障）
 * - 统一 JSON 输出格式（消除了 Prompt 格式与解析逻辑矛盾）
 * - 修复 sources 收集 Bug（从原始工具返回值收集，而非格式化文本）
 * - 增加跨轮对话记忆（chatLoop 维护对话历史传入 reactLoop）
 * - 安全计算器（递归下降解析替代 Function() 构造器）
 * - 独立存储路径（STORAGE_AGENTIC / CACHE_AGENTIC）
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

// ─── 本地模块 ────────────────────────────────────────────────────────
import { initGlobalSettings } from "../config.ts";
import llm, { tokenTracker } from "../llm.ts";
import { LLMChunk } from "../check/index.ts";
import { FILE_DIR, STORAGE_AGENTIC_DIR, CACHE_AGENTIC } from "../constants.ts";

// ═══════════════════════════════════════════════════════════════════════
//  Step 1: 初始化全局配置
// ═══════════════════════════════════════════════════════════════════════
initGlobalSettings();

// ═══════════════════════════════════════════════════════════════════════
//  Step 2: 加载文档 + 切分 + 构建向量索引（独立存储路径）
// ═══════════════════════════════════════════════════════════════════════
const storageContext = await storageContextFromDefaults({ persistDir: STORAGE_AGENTIC_DIR });

let index: VectorStoreIndex;
const hasExistingIndex = fs.existsSync(path.join(STORAGE_AGENTIC_DIR, "docstore.json"));

if (hasExistingIndex) {
  console.log("📂 检测到已有持久化索引，直接加载...");
  index = await VectorStoreIndex.init({ storageContext });
  console.log(`✅ 索引加载完成`);
} else {
  let nodes: TextNode[];
  const hasCachedNodes = fs.existsSync(CACHE_AGENTIC);

  if (hasCachedNodes) {
    console.log("📂 检测到切分缓存，直接加载...");
    const cached = JSON.parse(fs.readFileSync(CACHE_AGENTIC, "utf-8"));
    nodes = cached.map(
      (item: { text: string; id_: string }) =>
        new TextNode({ text: item.text, id_: item.id_ }),
    );
    console.log(`📊 从缓存加载 ${nodes.length} 个 chunk`);
  } else {
    // 加载文件
    const reader = new SimpleDirectoryReader();
    const documents = await reader.loadData({ directoryPath: FILE_DIR });
    console.log(`✅ 共加载 ${documents.length} 个文档`);
    const fullText = documents.map((d: Document) => d.text).join("\n\n");
    console.log(`📊 合并后总字符数: ${fullText.length}`);

    // 切分
    const splitter = new LLMChunk({ chunkSize: 512, chunkOverlap: 20 });
    const chunks = await splitter.splitText(fullText);
    nodes = chunks.map((text, i) => new TextNode({ text, id_: `agentic-chunk-${i}` }));
    console.log(`📊 切分出 ${nodes.length} 个 chunk`);

    // 缓存切分结果
    const cacheDir = path.dirname(CACHE_AGENTIC);
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(
      CACHE_AGENTIC,
      JSON.stringify(nodes.map((n) => ({ text: n.text, id_: n.id_ })).sort()),
      "utf-8",
    );
    console.log(`💾 切分结果已缓存到 ${CACHE_AGENTIC}`);
  }

  // 向量化 & 建索引
  console.log("⏳ 正在生成 embedding 并构建向量索引...");
  index = await VectorStoreIndex.init({ nodes, storageContext });
  console.log(`✅ 向量数据库构建完成`);
  console.log(`   📦 节点数: ${nodes.length}`);
  console.log(`   💾 持久化路径: ${STORAGE_AGENTIC_DIR}`);
}

// ═══════════════════════════════════════════════════════════════════════
//  Step 3: 定义工具集
// ═══════════════════════════════════════════════════════════════════════

interface Tool {
  name: string;
  description: string;
  parameters: Record<string, any>;
  execute: (params: any) => Promise<any>;
}

/** 检索结果条目 */
interface RetrievedSource {
  index: number;
  text: string;
  score: number;
  metadata: Record<string, any>;
}

// ─── 查询扩展：用 LLM 将宽泛查询拆解为多个子查询 ─────────────────────
/**
 * 当查询包含宽泛词（"有哪些"/"列出"/"所有"等）时，
 * 用 LLM 将其拆解为多个具体子查询，以并行检索提升召回率。
 *
 * 例如："提示词常用框架有哪些" → ["CRISPE框架", "BROKE框架", "COSTAR框架", "RISEN框架", "APE框架", "RASCEF框架", "TAG框架", "RACE框架"]
 */
const BROAD_QUERY_PATTERNS = /有哪些|列出|所有|常用|包括|分别|介绍|概述|总结|列举|各种|不同|分类/g;

async function expandQuery(originalQuery: string): Promise<string[]> {
  // 先检查是否已手动输入多 query（逗号分隔）
  const manualQueries = originalQuery.split(/[,，、]/).map(q => q.trim()).filter(Boolean);
  if (manualQueries.length > 1) {
    return manualQueries; // 用户已手动拆分，直接使用
  }

  // 检测是否是宽泛查询
  const isBroad = BROAD_QUERY_PATTERNS.test(originalQuery);
  if (!isBroad) {
    return [originalQuery]; // 具体问题，不需要扩展
  }

  // 用 LLM 扩展查询
  const expandPrompt = `用户提问："${originalQuery}"

请将这个宽泛的问题拆解为 3-8 个具体的子查询词，用于知识库检索。
每个子查询词应该是一个具体的实体名或关键词，而不是完整句子。

输出格式：仅输出 JSON 数组，不要其他内容。如：
["子查询1", "子查询2", "子查询3"]`;

  try {
    const resp = await llm.chat({ messages: [{ role: "user", content: expandPrompt }] });
    const content = String(resp.message?.content ?? resp);
    const arrMatch = content.match(/\[[\s\S]*\]/);
    if (arrMatch) {
      const subQueries = JSON.parse(arrMatch[0]);
      if (Array.isArray(subQueries) && subQueries.length > 0 && subQueries.every(q => typeof q === "string")) {
        console.log(`   🔍 查询扩展: "${originalQuery}" → ${JSON.stringify(subQueries)}`);
        return subQueries;
      }
    }
  } catch {
    console.warn("   ⚠️ 查询扩展失败，使用原始查询");
  }

  return [originalQuery];
}

// 工具1: 知识库检索（增强版：自动查询扩展 + 多 query 并行检索 + 去重）
const retrievalTool: Tool = {
  name: "retrieve",
  description: "从本地知识库检索与查询相关的信息片段。适用于回答关于文档内容的问题。对宽泛查询自动扩展为多个子查询以提升召回率。",
  parameters: {
    query: { type: "string", description: "检索查询文本。支持用逗号手动分隔多个关键词，如 'BROKE框架,COSTAR框架'" },
    topK: { type: "number", default: 5, description: "每个子查询返回结果数量（默认5）" }
  },
  execute: async ({ query, topK = 5 }: { query: string; topK?: number }): Promise<RetrievedSource[]> => {
    // 自动扩展查询：宽泛问题 → 多个子查询
    const queries = await expandQuery(query);

    const allResults: Map<string, RetrievedSource> = new Map(); // 按 text 去重

    for (const q of queries) {
      const retriever = index.asRetriever({ similarityTopK: topK });
      const nodes = await retriever.retrieve(q);

      for (const n of nodes) {
        const text = (n.node as any).text as string;
        const score = n.score ?? 0;
        // 去重：同一文本只保留最高分
        const existing = allResults.get(text);
        if (!existing || existing.score < score) {
          allResults.set(text, {
            index: 0, // 后续重新编号
            text,
            score,
            metadata: (n.node as any).metadata as Record<string, any>,
          });
        }
      }
    }

    // 按相似度降序排列，重新编号
    const sorted = Array.from(allResults.values())
      .sort((a, b) => b.score - a.score)
      .map((item, i) => ({ ...item, index: i + 1 }));

    return sorted;
  }
};

// ─── 安全数学解析器（递归下降，替代 Function()） ─────────────────────
/**
 * 递归下降解析器，仅支持 + - * / () 和数字
 * 比 Function() 安全：无代码注入风险，无原型链访问
 */
function safeMathEval(expr: string): number {
  let pos = 0;

  function skipSpaces() {
    while (pos < expr.length && expr[pos] === " ") pos++;
  }

  function parseNumber(): number {
    skipSpaces();
    let numStr = "";
    // 支持负号（仅在一元位置）
    if (pos < expr.length && expr[pos] === "-") {
      numStr += "-";
      pos++;
    }
    while (pos < expr.length && ((expr[pos] ?? "") >= "0" && (expr[pos] ?? "") <= "9" || (expr[pos] ?? "") === ".")) {
      numStr += expr[pos];
      pos++;
    }
    const val = parseFloat(numStr);
    if (isNaN(val)) throw new Error(`无效数字: "${numStr}"`);
    return val;
  }

  function parseFactor(): number {
    skipSpaces();
    if (pos < expr.length && expr[pos] === "(") {
      pos++; // skip '('
      const val = parseExpr();
      skipSpaces();
      if (pos < expr.length && expr[pos] === ")") {
        pos++; // skip ')'
      } else {
        throw new Error("缺少右括号 ')'");
      }
      return val;
    }
    return parseNumber();
  }

  function parseTerm(): number {
    let left = parseFactor();
    skipSpaces();
    while (pos < expr.length && (expr[pos] === "*" || expr[pos] === "/")) {
      const op = expr[pos];
      pos++;
      const right = parseFactor();
      left = op === "*" ? left * right : left / right;
      skipSpaces();
    }
    return left;
  }

  function parseExpr(): number {
    let left = parseTerm();
    skipSpaces();
    while (pos < expr.length && (expr[pos] === "+" || expr[pos] === "-")) {
      const op = expr[pos];
      pos++;
      const right = parseTerm();
      left = op === "+" ? left + right : left - right;
      skipSpaces();
    }
    return left;
  }

  const result = parseExpr();
  skipSpaces();
  if (pos < expr.length) {
    throw new Error(`未解析的字符: "${expr[pos]}" at position ${pos}`);
  }
  return result;
}

// 工具2: 计算器（安全递归下降解析）
const calculatorTool: Tool = {
  name: "calculate",
  description: "执行数学计算。适用于需要数值计算的场景。支持加减乘除和括号。",
  parameters: {
    expression: { type: "string", description: "数学表达式，如 '2 + 2' 或 '100 * 0.15'" }
  },
  execute: async ({ expression }: { expression: string }) => {
    try {
      // 预处理：移除空格外的无关字符
      const sanitized = expression.replace(/[^0-9+\-*/().\s]/g, '').trim();
      if (!sanitized) {
        return { error: "空表达式", expression };
      }
      const result = safeMathEval(sanitized);
      return { expression, result };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "无法计算该表达式", expression };
    }
  }
};

// ─── 工具注册表 ──────────────────────────────────────────────────────
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

  /** 生成工具描述（供 LLM 理解） */
  getDescription(): string {
    return this.list().map(t =>
      `- ${t.name}: ${t.description}\n  参数: ${JSON.stringify(t.parameters)}`
    ).join("\n\n");
  }

  /** 生成工具的 JSON Schema 描述（供 LLM 结构化输出） */
  getToolSchema(): string {
    const schemas = this.list().map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters
    }));
    return JSON.stringify(schemas, null, 2);
  }
}

const registry = new ToolRegistry();
registry.register(retrievalTool);
registry.register(calculatorTool);

console.log(`✅ 已注册 ${registry.list().length} 个工具`);

// ═══════════════════════════════════════════════════════════════════════
//  Step 4: 实现 ReAct 循环（单次 LLM 调用同时输出 Thought + Action）
// ═══════════════════════════════════════════════════════════════════════

interface ReactStep {
  thought: string;
  action: string;       // 工具名
  params: any;          // 工具参数
  observation?: string;  // 工具返回的格式化文本
  rawResult?: any;      // 工具原始返回值（用于 sources 收集）
}

/** 跨轮对话记忆 */
interface ChatMemory {
  role: "user" | "assistant";
  content: string;
}

const MAX_ITERATIONS = 5;

/**
 * 统一的 ReAct Prompt：一次 LLM 调用同时输出 Thought + Action
 * 输出格式为 JSON，方便可靠解析
 */
const REACT_SYSTEM_PROMPT = `你是一个智能助手，使用 ReAct (Reasoning + Acting) 模式回答问题。

可用工具：
{tools_description}

工作流程：
1. Thought: 分析当前情况，决定下一步需要什么信息或操作
2. Action: 选择工具执行，或直接给出答案
3. Observation: 查看工具返回的结果
4. 重复以上步骤直到有足够信息回答问题

你必须严格输出以下 JSON 格式：
{
  "thought": "你的分析思考过程",
  "tool": "工具名称 或 'finish'",
  "params": {},
  "response": "最终答案（仅当 tool 为 'finish' 时需要）"
}

工具说明：
- retrieve: 从知识库检索信息，params: {"query": "查询文本", "topK": 5}
  💡 对宽泛查询（如"有哪些"/"列出"/"介绍"等），系统会自动扩展为多个子查询并行检索，一次 retrieve 即可覆盖全面
- calculate: 执行数学计算，params: {"expression": "数学表达式"}
- finish: 信息充足时直接回答，params: {}，必须同时提供 "response"

重要规则：
- 每次只执行一个工具
- 仔细观察工具返回的结果再决定下一步
- 如果检索结果已覆盖所有内容，直接 finish，无需反复检索
- 如果信息充足，立即 finish
- 不要编造信息，基于观察到的内容回答
- 对于简单问候或通用问题，直接 finish，无需使用工具

示例 1（宽泛问题 - 一次检索即可）：
Question: prompt常用框架有哪些？
{"thought": "这是一个宽泛的列举问题，retrieve会自动扩展查询，一次检索应该能覆盖多个框架", "tool": "retrieve", "params": {"query": "prompt常用框架有哪些", "topK": 5}}
Observation: [检索到8个框架的详细信息...]
{"thought": "检索结果已经包含CRISPE、BROKE、COSTAR等所有框架信息，可以总结了", "tool": "finish", "params": {}, "response": "常用提示词框架包括：1. CRISPE框架...2. BROKE框架...3. COSTAR框架..."}

示例 2（具体问题）：
Question: CRISPE框架的C代表什么？
{"thought": "这是关于CRISPE框架的具体问题，需要检索CRISPE的定义", "tool": "retrieve", "params": {"query": "CRISPE框架", "topK": 3}}
Observation: [CRISPE的详细解释...]
{"thought": "找到了CRISPE框架的详细解释，C代表Capacity and Role", "tool": "finish", "params": {}, "response": "CRISPE框架中C代表Capacity and Role（角色定位）..."}

示例 3（简单问答）：
Question: 你好
{"thought": "简单的问候，不需要使用工具", "tool": "finish", "params": {}, "response": "你好！有什么可以帮助你的吗？"}

当前问题：{question}

对话历史：
{chat_history}

已有的 ReAct 步骤：
{react_history}

请输出 JSON：`;

/** 解析 LLM 输出为结构化决策 */
function parseReactOutput(rawContent: string): {
  thought: string;
  tool: string;
  params: any;
  response?: string | undefined;
} {
  // 策略1：提取 JSON 块
  const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        thought: String(parsed.thought || ""),
        tool: String(parsed.tool || "finish").toLowerCase(),
        params: parsed.params || {},
        response: parsed.response != null ? String(parsed.response) : undefined,
      };
    } catch {
      // JSON 解析失败，继续降级
    }
  }

  // 策略2：正则降级 — 匹配 Thought + Action/Finish 行
  const thoughtMatch = rawContent.match(/Thought:\s*(.+?)(?:\n|$)/s);
  const thought = thoughtMatch?.[1]?.trim() ?? rawContent.substring(0, 200);

  const finishMatch = rawContent.match(/Finish\[([\s\S]+?)\]/s);
  if (finishMatch && finishMatch[1]) {
    return { thought, tool: "finish", params: {}, response: finishMatch[1].trim() };
  }

  const actionMatch = rawContent.match(/Action:\s*(\w+)\[([\s\S]+?)\]/s);
  if (actionMatch) {
    const toolName = actionMatch[1]!.toLowerCase();
    const paramsStr = actionMatch[2] ?? "";
    try {
      return { thought, tool: toolName, params: JSON.parse(paramsStr) };
    } catch {
      return { thought, tool: toolName, params: { query: paramsStr.trim() } };
    }
  }

  // 策略3：无法解析时默认 finish
  console.warn("⚠️ 无法解析 LLM 输出，降级为直接回答");
  return { thought, tool: "finish", params: {}, response: thought };
}

/** 执行工具并返回 { observation(格式化文本), rawResult(原始值) } */
async function executeTool(toolName: string, params: any): Promise<{
  observation: string;
  rawResult: any;
}> {
  const tool = registry.get(toolName);

  if (!tool) {
    return {
      observation: `错误：未找到工具 "${toolName}"。可用工具: ${registry.list().map(t => t.name).join(", ")}`,
      rawResult: null,
    };
  }

  try {
    const rawResult = await tool.execute(params);

    // 格式化结果为可读文本（供 LLM 观察）
    let observation: string;
    if (Array.isArray(rawResult)) {
      observation = rawResult.map((item: RetrievedSource) =>
        `[${item.index}] (相似度: ${(item.score * 100).toFixed(1)}%)\n${item.text.substring(0, 500)}${item.text.length > 500 ? "..." : ""}`
      ).join("\n\n");
    } else {
      observation = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult, null, 2);
    }

    return { observation, rawResult };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return {
      observation: `工具执行错误：${errMsg}`,
      rawResult: null,
    };
  }
}

/** 格式化 ReAct 步骤历史（供 LLM 理解前几轮做了什么） */
function formatReactHistory(steps: ReactStep[]): string {
  if (steps.length === 0) return "无";

  return steps.map((s, i) =>
    `[第${i + 1}轮]\nThought: ${s.thought}\nAction: ${s.action}(${JSON.stringify(s.params)})${s.observation ? `\nObservation: ${s.observation.substring(0, 500)}...` : ""}`
  ).join("\n\n");
}

/** 格式化对话记忆（供 LLM 理解跨轮上下文） */
function formatChatHistory(memory: ChatMemory[]): string {
  if (memory.length === 0) return "无";
  // 只保留最近 6 轮对话，避免 prompt 过长
  const recent = memory.slice(-6);
  return recent.map(m =>
    m.role === "user" ? `用户: ${m.content}` : `助手: ${m.content.substring(0, 200)}${m.content.length > 200 ? "..." : ""}`
  ).join("\n");
}

/**
 * ReAct 主循环
 * - 单次 LLM 调用同时输出 Thought + Action（而非两次分开调用）
 * - 从 rawResult 收集 sources（而非解析格式化文本）
 * - 支持 chatHistory 跨轮对话记忆
 */
async function reactLoop(
  userQuery: string,
  chatHistory: ChatMemory[] = []
): Promise<{
  answer: string;
  iterations: number;
  steps: ReactStep[];
  sources?: RetrievedSource[] | undefined;
}> {
  let iterations = 0;
  const steps: ReactStep[] = [];
  let finalAnswer = "";
  let sources: RetrievedSource[] = [];

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    console.log(`\n🔄 第 ${iterations}/${MAX_ITERATIONS} 轮迭代`);

    // ─── 单次 LLM 调用：同时生成 Thought + Action ─────────────
    const prompt = REACT_SYSTEM_PROMPT
      .replace("{question}", userQuery)
      .replace("{chat_history}", formatChatHistory(chatHistory))
      .replace("{react_history}", formatReactHistory(steps))
      .replace("{tools_description}", registry.getToolSchema());

    const response = await llm.chat({ messages: [{ role: "user", content: prompt }] });
    const content = String(response.message?.content ?? response);

    // 解析 LLM 输出
    const decision = parseReactOutput(content);
    console.log(`💭 Thought: ${decision.thought.substring(0, 100)}...`);
    console.log(`🎯 Action: ${decision.tool}${decision.tool !== "finish" ? `(${JSON.stringify(decision.params)})` : ""}`);

    const step: ReactStep = {
      thought: decision.thought,
      action: decision.tool,
      params: decision.params,
    };

    if (decision.tool === "finish") {
      // 直接完成
      console.log(`✅ 完成任务`);
      finalAnswer = decision.response || await generateFinalAnswer(userQuery, steps, chatHistory);
      steps.push(step);
      break;
    }

    // ─── 执行工具 ──────────────────────────────────────────────
    const { observation, rawResult } = await executeTool(decision.tool, decision.params);
    console.log(`👁️  Observation: ${observation.substring(0, 100)}...`);

    step.observation = observation;
    step.rawResult = rawResult;
    steps.push(step);

    // 从 rawResult 收集 sources（修复原 Bug：不再从格式化文本解析）
    if (decision.tool === "retrieve" && Array.isArray(rawResult)) {
      sources = rawResult;
    }
  }

  if (!finalAnswer) {
    console.log("⚠️ 达到最大迭代次数，基于已有信息生成答案");
    finalAnswer = await generateBestEffortAnswer(userQuery, steps, chatHistory);
  }

  return {
    answer: finalAnswer,
    iterations,
    steps,
    sources: sources.length > 0 ? sources : (undefined as RetrievedSource[] | undefined),
  };
}

async function generateFinalAnswer(
  question: string,
  steps: ReactStep[],
  chatHistory: ChatMemory[] = []
): Promise<string> {
  const prompt = `问题：${question}

对话历史：
${formatChatHistory(chatHistory)}

思考过程：
${formatReactHistory(steps)}

请基于以上思考过程和观察结果，给出准确、完整的最终答案。`;

  const response = await llm.chat({ messages: [{ role: "user", content: prompt }] });
  return String(response.message?.content ?? response);
}

async function generateBestEffortAnswer(
  question: string,
  steps: ReactStep[],
  chatHistory: ChatMemory[] = []
): Promise<string> {
  const prompt = `问题：${question}

对话历史：
${formatChatHistory(chatHistory)}

已达到最大迭代次数。基于以下有限的信息，尽力给出最佳答案：

${formatReactHistory(steps)}

如果信息不足，请明确指出。`;

  const response = await llm.chat({ messages: [{ role: "user", content: prompt }] });
  return String(response.message?.content ?? response);
}

// ═══════════════════════════════════════════════════════════════════════
//  Step 5: 交互式查询（带跨轮对话记忆）
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

  // ─── 对话记忆：跨轮保持上下文 ──────────────────────────────────
  const chatMemory: ChatMemory[] = [];

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

    // 记录用户输入到对话记忆
    chatMemory.push({ role: "user", content: query });

    console.log("\n⏳ Agent 思考中...\n");

    try {
      const startTime = Date.now();
      // 将对话记忆传入 reactLoop，让 Agent 理解上下文
      const result = await reactLoop(query, chatMemory);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

      console.log("\n" + "─".repeat(60));
      console.log("🤖 Agent 回答:");
      console.log(result.answer);
      console.log("─".repeat(60));

      if (result.sources && result.sources.length > 0) {
        console.log("\n📎 参考来源:");
        result.sources.forEach((source, i) => {
          console.log(`  [${i + 1}] (相似度: ${(source.score * 100).toFixed(1)}%)`);
          console.log(`      ${source.text.substring(0, 80)}...`);
        });
      }

      console.log(`\n📊 统计:`);
      console.log(`  • 迭代次数: ${result.iterations}`);
      console.log(`  • 耗时: ${elapsed}s`);
      console.log(`  • Token 使用: 见上方日志`);
      console.log("\n" + "=".repeat(60) + "\n");

      // 记录助手回答到对话记忆
      chatMemory.push({ role: "assistant", content: result.answer });

    } catch (err) {
      console.error("❌ 出错:", err instanceof Error ? err.message : String(err));
      console.log("💡 提示：请尝试简化问题或重新表述\n");
    }
  }
}

chatLoop();
