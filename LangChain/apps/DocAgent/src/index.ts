import path from "path";
import fs from "fs";
import * as readline from "readline";

// ─── LlamaIndex 核心模块 ────────────────────────────────────────────
import { SimpleDirectoryReader } from "@llamaindex/readers/directory";
import { TextFileReader } from "@llamaindex/readers/text";
import { TextNode } from "@llamaindex/core/schema";
import { sentenceChunk, recursiveChunk } from './chunk.ts'
import {
  VectorStoreIndex,
  storageContextFromDefaults,
} from "llamaindex";

// ─── 本地模块 ────────────────────────────────────────────────────────
import { initGlobalSettings } from "./config.ts";
import llm, { tokenTracker } from "./llm.ts";
import { FILE_DIR, STORAGE_AGENTIC_DIR, CACHE_AGENTIC, CACHE_EXISTING_INDEX } from "./constants.ts";

// ═══════════════════════════════════════════════════════════════════════
//  Step 1: 初始化全局配置
// ═══════════════════════════════════════════════════════════════════════
initGlobalSettings();

// ═══════════════════════════════════════════════════════════════════════
//  Step 2: 加载文档 + 切分 + 构建向量索引（独立存储路径）
// ═══════════════════════════════════════════════════════════════════════
// 加载 & 切分（有缓存跳过）
let index: VectorStoreIndex;
let nodes: TextNode[];
const hasExistingIndex = fs.existsSync(CACHE_EXISTING_INDEX);
const hasNodesCache = fs.existsSync(CACHE_AGENTIC);
const storageContext = await storageContextFromDefaults({ persistDir: STORAGE_AGENTIC_DIR });

const loadFile = async (directoryPath: string) => {
  const reader = new SimpleDirectoryReader();
  const documents = await reader.loadData({ directoryPath, overrideReader: new TextFileReader() });
  console.log(`✅ 共加载 ${documents.length} 个文档`);
  return documents;
}

// ═══════════════════════════════════════════════════════════════════
//  Step 3: 向量化 & 建索引（含持久化）
// ═══════════════════════════════════════════════════════════════════
if (hasExistingIndex) {
  console.log("📂 检测到已有持久化索引，直接加载...");
  index = await VectorStoreIndex.init({ storageContext });
  console.log(`✅ 索引加载完成`);
} else {
  if (hasNodesCache) {
    console.log("📂 检测到切分缓存，直接加载...");
    const cached = JSON.parse(fs.readFileSync(CACHE_AGENTIC, "utf-8"));
    nodes = cached.map(
      (item: { text: string; id_: string }) =>
        new TextNode({ text: item.text, id_: item.id_ }),
    );
    console.log(`📊 从缓存加载 ${nodes.length} 个 chunk`);
  } else {
    const documents = await loadFile(FILE_DIR);
    nodes = await sentenceChunk(documents);
  }
  console.log("⏳ 正在生成 embedding 并构建向量索引...");
  index = await VectorStoreIndex.init({ nodes, storageContext });
  console.log(`✅ 向量数据库构建完成`);
  console.log(`   📦 节点数: ${nodes.length}`);
  console.log(`   💾 持久化路径: ${STORAGE_AGENTIC_DIR}`);
}


// ═══════════════════════════════════════════════════════════════════════
//  Step 4: 定义工具集
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


// ─── Multi-Query：将宽泛查询拆解为多个不同角度的子查询 ──────────────
/**
 * 当查询包含宽泛词（"有哪些"/"列出"/"所有"等）时，
 * 用 LLM 将其改写为 3-5 个不同语义角度的子查询，以并行检索提升召回率。
 *
 * Multi-Query 原理：单 query 只探索了 Embedding 空间的一个点，
 * 多个不同角度的 query 覆盖更大区域，提高"列举所有 X"类问题的召回率。
 *
 * 例如："常用提示词框架有哪些" → ["提示词框架", "prompt engineering 设计模式", "提示词设计模板"]
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

  // 用 LLM 扩展查询（Multi-Query：生成多个角度不同的 query）
  const expandPrompt = `用户提问："${originalQuery}"

这是一个宽泛的问题，请从 3-5 个不同的角度改写为具体的子查询，用于向量检索。

每个子查询必须从**截然不同的语义角度**出发，不能相似。
输出必须确保多样性，否则检索会重复命中同一批结果。

✅ 好例子（角度完全不同）：
  - "提示词框架列表"           ← 框架枚举角度
  - "prompt engineering 设计模式"  ← 英文专业术语角度
  - "提示词结构化和方法论"       ← 方法论角度

❌ 坏例子（角度雷同）：
  - "提示词框架"、"提示词框架列表"、"框架有哪些"  ← 全部框架列举角度
  - "应用场景"、"设计原则"、"实现方法"            ← 全部抽象概念

约束：
- 至少 2 个 query 使用与用户提问不同的语言（如中英混搭）
- 每个 query 必须能从不同语义维度命中不同的知识库内容
- 如果两个 query 的词重叠 > 60%，说明角度不够多样

输出格式：仅输出 JSON 字符串数组，不要其他内容。
如：["提示词框架", "prompt engineering design patterns", "提示词设计模式"]`;

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

// ─── LLM 重排序：对检索结果用 LLM 重新打分 ──────────────────────────
/**
 * 用 LLM 对检索结果重新打分排序（cross-encoder 替代方案）。
 *
 * 向量检索（bi-encoder）只做语义相似度，无法区分"相关但没回答"和"真正回答了"。
 * LLM 重排序模拟 cross-encoder 效果：让 LLM 判断每个 chunk 对问题的回答质量。
 *
 * 为控制成本，仅在 chun k 数量 ≤ 12 时执行，超量回退到向量分排序。
 */
const RERANK_THRESHOLD = 12;

async function rerankResults(
  results: RetrievedSource[],
  originalQuery: string
): Promise<RetrievedSource[]> {
  if (results.length <= 1 || results.length > RERANK_THRESHOLD) {
    return results; // 太少无需排序，超量回退向量分
  }

  const rerankPrompt = `以下是针对同一问题检索到的 ${results.length} 个文本片段。请判断每个片段对回答问题的"直接帮助程度"（0-100分）。

评分标准：
- 90-100：直接包含问题的答案内容，如列举了具体的技术/方法/条目
- 70-89：包含与答案密切相关的内容，稍加整理即可得到答案
- 50-69：提到了相关领域的概念，但只是背景介绍或注意事项，未直接回答问题
- 30-49：仅包含查询中的关键词散落在不同地方，实际信息量很低
- 0-29：不相关

⚠️ 注意：请判断片段是否**直接能回答**用户的问题，而不是仅包含查询关键词就视为相关。

问题：${originalQuery}

${results.map((r, i) => `[片段 ${i}]\n${r.text.substring(0, 400)}`).join("\n\n")}

请严格按 JSON 数组格式输出，每个元素包含 index 和 score：
[{ "index": 0, "score": 85 }, { "index": 1, "score": 30 }, ...]`;

  try {
    const resp = await llm.chat({ messages: [{ role: "user", content: rerankPrompt }] });
    const content = String(resp.message?.content ?? resp);
    const arrMatch = content.match(/\[[\s\S]*\]/);
    if (arrMatch) {
      const scores = JSON.parse(arrMatch[0]) as Array<{ index: number; score: number }>;
      if (Array.isArray(scores) && scores.length === results.length) {
        // 按 LLM 分重新排序
        const scoreMap = new Map<number, number>();
        for (const s of scores) {
          scoreMap.set(s.index, s.score);
        }

        const reranked = results
          .map((item, i) => ({
            ...item,
            score: scoreMap.has(i) ? scoreMap.get(i)! / 100 : item.score, // LLM 分归一化到 0-1
          }))
          .sort((a, b) => b.score - a.score)
          .map((item, i) => ({ ...item, index: i + 1 }));

        console.log(`   📊 LLM 重排序完成: top-1 得分 ${(reranked[0]!.score * 100).toFixed(0)}/100`);
        return reranked;
      }
    }
  } catch {
    console.warn("   ⚠️ LLM 重排序失败，保留原始排序");
  }

  return results;
}

// ─── retrieve 工具：从知识库检索 ─────────────────────────────────────
const retrieveTool: Tool = {
  name: "retrieve",
  description: "从本地知识库检索与查询相关的信息片段。适用于回答关于文档内容的问题。对宽泛查询自动扩展为多个子查询以提升召回率。检索结果会自动经 LLM 重排序，把最相关的排前面。",
  parameters: {
    query: { type: "string", description: "检索查询文本。支持用逗号手动分隔多个关键词，如 'BROKE框架,COSTAR框架'" },
    topK: { type: "number", default: 5, description: "每个子查询返回结果数量（默认5）" }
  },
  execute: async ({ query, topK = 5 }: { query: string; topK?: number }): Promise<RetrievedSource[]> => {
    // 自动扩展查询：宽泛问题 → 多个子查询
    const queries = await expandQuery(query);
    console.log(`   🔎 检索查询: ${JSON.stringify(queries)}`);
    const allResults: Map<string, RetrievedSource> = new Map();

    for (const q of queries) {
      const retriever = index.asRetriever({ similarityTopK: topK });
      const nodes = await retriever.retrieve(q);
      console.log(`     query="${q}" → ${nodes.length} 条结果`);

      for (const n of nodes) {
        const text = (n.node as any).text as string;
        const score = n.score ?? 0;
        const existing = allResults.get(text);
        if (!existing || existing.score < score) {
          allResults.set(text, {
            index: 0,
            text,
            score,
            metadata: (n.node as any).metadata as Record<string, any>,
          });
        }
      }
    }

    const sorted = Array.from(allResults.values())
      .sort((a, b) => b.score - a.score)
      .map((item, i) => ({ ...item, index: i + 1 }));
    const score = sorted.map((item,i) => item.score)
    console.log(`   📊 结果得分: [${score.map(s => (s*100).toFixed(0)).join(', ')}]`);
    console.log(`   📦 去重后 ${sorted.length} 个结果, 最高分 ${((sorted[0]?.score ?? 0) * 100).toFixed(1)}%`);

    // 低分警告
    const topScore = sorted[0]?.score ?? 0;
    if (topScore < 0.5) {
      console.log(`   ⚠️ 检索结果得分偏低(${(topScore * 100).toFixed(1)}%)，知识库可能不包含相关内容`);
    }

    const reranked = await rerankResults(sorted, query);

    // 打印最终检索到的 chunk 信息
    console.log("   ┌─ 检索结果 ──────────────────────────────────");
    reranked.forEach((r, i) => {
      const firstLine = r.text.split("\n")[0]!.trim().substring(0, 60);
      console.log(`   │ [${i + 1}] (${(r.score * 100).toFixed(1)}%) ${firstLine}`);
    });
    console.log("   └─────────────────────────────────────────────");

    return reranked;
  }
};

// ─── summarize 工具：用 LLM 对文本进行摘要 ──────────────────────────
const summarizeTool: Tool = {
  name: "summarize",
  description: "对给定文本进行摘要总结。适用于将长内容浓缩为关键信息、提取要点、或结构化输出总结。",
  parameters: {
    text: { type: "string", description: "需要总结的文本内容" },
    focus: { type: "string", default: "", description: "总结的关注重点（可选），如'优缺点'、'核心步骤'、'关键结论'" },
    maxLength: { type: "number", default: 200, description: "摘要目标字数（默认200）" },
  },
  execute: async ({ text, focus, maxLength = 200 }: { text: string; focus?: string; maxLength?: number }) => {
    const prompt = `请对以下文本进行摘要总结${focus ? `，重点关注：${focus}` : ""}。
目标字数：${maxLength} 字以内。

要求：
- 提炼核心信息，保留关键数据
- 语言简洁、条理清晰
- 不添加原文没有的信息

文本内容：
${text.substring(0, 4000)}`;

    const response = await llm.chat({ messages: [{ role: "user", content: prompt }] });
    return String(response.message?.content ?? response);
  }
};

const registry = new ToolRegistry();
registry.register(summarizeTool);
registry.register(retrieveTool);

console.log(`✅ 已注册 ${registry.list().length} 个工具`);

/**
 * 计算两段观察文本的相似度（基于 Token 重叠率）
 */
function observationSimilarity(a: string, b: string): number {
  const tokenize = (s: string) => new Set(s.split(/[\s,，。、；：()（）]+/).filter(t => t.length > 1));
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  return intersection.size / Math.max(setA.size, setB.size);
}

/**
 * ReAct 主循环
 * - 单次 LLM 调用同时输出 Thought + Action（而非两次分开调用）
 */
const MAX_ITERATIONS = 5;

interface ReactStep {
  thought: string;
  action: string;
  params: any;
  observation?: string;
  rawResult?: any;      // 工具原始返回值（用于 sources 收集）
}

interface ChatMemory {
  role: "user" | "assistant";
  content: string;
}

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
- summarize: 对文本进行摘要整理。**仅当检索结果的信息分散在多个片段中真正需要合并时才使用**；如果单个片段已能回答问题，请直接 finish。params: {"text": "待总结文本", "focus": "关注点"}
- finish: 信息充足时直接回答，params: {}，必须同时提供 "response"

重要规则：
- 每次只执行一个工具
- 仔细观察工具返回的结果再决定下一步
- 如果检索结果已覆盖所有内容，直接 finish，无需反复检索
- 如果信息充足，立即 finish
- **如果检索结果与用户问题不相关或信息不足，必须明确告知用户知识库中未找到相关内容，不得根据自身知识编造**
- **检索结果列表中的 [N] 项应全部检查，不要只看第一项就下结论**
- 不要编造信息，严格基于观察到的内容回答
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

示例 3（检索后直接 finish，不调用 summarize）：
Question: 帮我总结一下BROKE框架的优缺点
{"thought": "具体问题，需要先检索BROKE框架的详细内容", "tool": "retrieve", "params": {"query": "BROKE框架", "topK": 5}}
Observation: [检索到3个关于BROKE框架的片段，分别介绍了不同方面]
{"thought": "检索结果已包含BROKE框架的所有方面，可以直接回答", "tool": "finish", "params": {}, "response": "BROKE框架的优缺点如下：..."}

示例 4（仅当信息真正分散需合并时才用 summarize）：
Question: 帮我对比CRISPE和BROKE框架的异同
{"thought": "需要先检索两个框架的详细信息", "tool": "retrieve", "params": {"query": "CRISPE BROKE 框架对比", "topK": 5}}
Observation: [5个片段分别介绍了CRISPE和BROKE的不同方面，信息分散在多个chunk中]
{"thought": "信息分散在多个片段中，需要合并后对比", "tool": "summarize", "params": {"text": "5个片段的合并内容...", "focus": "异同对比", "maxLength": 400}}
Observation: [CRISPE和BROKE框架的异同总结]
{"thought": "对比完成，可以直接回答", "tool": "finish", "params": {}, "response": "CRISPE和BROKE框架的异同如下：..."}

示例 5（简单问答）：
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

/** 执行工具并返回格式化观测结果 */
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
      observation = rawResult.map((item: RetrievedSource) => {
        const displayText = (item.metadata?.window as string) || item.text;
        return `[${item.index}] (相似度: ${(item.score * 100).toFixed(1)}%)\n${displayText.substring(0, 1500)}${displayText.length > 1500 ? "..." : ""}`;
      }).join("\n\n");

      // 低分警告：top-1 得分低于 50% → 在 Observation 开头加提示
      const topScore = rawResult[0]?.score ?? 0;
      if (topScore < 0.5) {
        observation = `⚠️ 检索结果得分偏低（最高 ${(topScore * 100).toFixed(1)}%），知识库可能不包含与用户问题直接相关的内容，请如实告知用户。\n\n${observation}`;
      } else if (topScore < 0.7) {
        observation = `ℹ️ 检索结果相关性一般（最高 ${(topScore * 100).toFixed(1)}%），部分内容可能不够准确。\n\n${observation}`;
      }
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

/** 格式化 ReAct 步骤历史（只保留最近 3 步） */
function formatReactHistory(steps: ReactStep[]): string {
  if (steps.length === 0) return "无";
  const recent = steps.slice(-3);
  return recent.map((s, i) => {
    const stepIndex = steps.length - recent.length + i + 1;
    return (
      `[第${stepIndex}轮]\nThought: ${s.thought.substring(0, 100)}\nAction: ${s.action}(${JSON.stringify(s.params)})${s.observation ? `\nObservation: ${s.observation}` : ""}`
    );
  }).join("\n\n");
}

/** 格式化对话记忆（只保留最近 6 轮） */
function formatChatHistory(memory: ChatMemory[]): string {
  if (memory.length === 0) return "无";
  const recent = memory.slice(-6);
  return recent.map(m =>
    m.role === "user" ? `用户: ${m.content}` : `助手: ${m.content}`
  ).join("\n");
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

要求：
- 如果信息不足或与问题不相关，**必须明确告知用户没有找到相关内容**
- 不要编造知识库中没有的信息
- 如果信息足够，准确总结`;

  const response = await llm.chat({ messages: [{ role: "user", content: prompt }] });
  return String(response.message?.content ?? response);
}

/** 检测到重复操作时，基于已积累的信息生成答案 */
async function summarizeExistingResults(
  question: string,
  steps: ReactStep[],
  chatHistory: ChatMemory[] = []
): Promise<string> {
  const prompt = `问题：${question}

对话历史：
${formatChatHistory(chatHistory)}

以下是已经检索到的所有信息，请基于这些信息给出完整回答：

${formatReactHistory(steps)}

要求：
- 直接给出最终答案，不要解释为什么不再检索
- 如果信息足够，完整回答
- 如果信息不足或与问题不相关，**必须明确告知用户没有找到相关内容**
- 不要编造知识库中没有的信息`;

  const response = await llm.chat({ messages: [{ role: "user", content: prompt }] });
  return String(response.message?.content ?? response);
}

/**
 * ReAct 主循环
 * - 单次 LLM 调用同时输出 Thought + Action（而非两次分开调用）
 * - 从 rawResult 收集 sources（而非解析格式化文本）
 * - 支持 chatHistory 跨轮对话记忆
 */
const reactLoop = async (
  userQuery: string,
  chatHistory: ChatMemory[] = []
): Promise<{ answer: string; iterations: number; steps: ReactStep[], sources?: RetrievedSource[] | undefined; }> => {
  let iterations = 0;
  const steps: ReactStep[] = [];
  let finalAnswer = "";
  let sources: RetrievedSource[] = [];
  while (iterations < MAX_ITERATIONS) {
    iterations++;
    console.log(`\n🔄 第 ${iterations}/${MAX_ITERATIONS} 轮迭代`);
    // TODO: 实现 ReAct 循环逻辑
    // 1. 构造 Prompt（含历史对话记忆）
    const prompt = REACT_SYSTEM_PROMPT
      .replace("{tools}", registry.getDescription())
      .replace("{question}", userQuery)
      .replace("{chat_history}", formatChatHistory(chatHistory))
      .replace("{tools_description}", registry.getToolSchema())
      .replace("{react_history}", formatReactHistory(steps));
    // 2. LLM 推理并输出 Thought + Action（JSON 格式）
    const response = await llm.chat({ messages: [{ role: "user", content: prompt }] });
    // 3. 解析 Action 并执行
    const content = String(response.message?.content ?? response);
    const decision = parseReactOutput(content);
    console.log(`💭 Thought: ${decision.thought.substring(0, 100)}...`);
    console.log(`🎯 Action: ${decision.tool}`);

    // // 检测重复检索：上一轮调了同一个工具 → 强制结束
    // if (decision.tool !== "finish" && steps.length > 0 && steps[steps.length - 1]!.action === decision.tool) {
    //   console.log("⚠️ 检测到重复操作，强制结束");
    //   finalAnswer = await summarizeExistingResults(userQuery, steps, chatHistory);
    //   steps.push({ thought: decision.thought, action: "finish", params: {} });
    //   break;
    // }

    // 4. 更新记忆 & 循环或结束
    const step: ReactStep = { thought: decision.thought, action: decision.tool, params: decision.params };
    if (decision.tool === "finish") {
      console.log(`✅ 完成任务`);
      finalAnswer = decision.response || await generateFinalAnswer(userQuery, steps, chatHistory);
      steps.push(step);
      break;
    }

    let { observation, rawResult } = await executeTool(decision.tool, decision.params);
    console.log(`👁️  Observation: ${observation.substring(0, 200)}...`);

    // 自动压缩 Observation 用于历史记录（复用 summarize 工具）
    // if (observation) {
    //   try {
    //     const compressed = await summarizeTool.execute({ text: observation, focus: "核心发现", maxLength: 80 });
    //     if (compressed) observation = compressed;
    //   } catch {
    //     observation = observation.substring(0, 100);
    //   }
    // }

    // 观察结果相似度检测：与上次 Observation 太像 → 强制结束
    if (steps.length > 0 && steps[steps.length - 1]!.observation) {
      const prevObs = steps[steps.length - 1]!.observation!;
      const similarity = observationSimilarity(observation, prevObs);
      if (similarity > 0.7) {
        console.log(`⚠️ 检测到观察结果重复（相似度 ${(similarity * 100).toFixed(0)}%），强制结束`);
        finalAnswer = await summarizeExistingResults(userQuery, steps, chatHistory);
        steps.push(step);
        break;
      }
    }

    step.observation = observation;
    step.rawResult = rawResult;
    steps.push(step);
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
  console.log("🛠️  可用工具：summarize（总结）");
  console.log("🚪 退出：输入 'exit' 或 'quit'");
  console.log("=".repeat(60) + "\n");
  // ─── 对话记忆：跨轮保持上下文 ──────────────────────────────────
  const chatMemory: ChatMemory[] = [];

  while (true) {
    let query: string;
    try {
      query = await prompt();
    } catch {
      break;
    }
    if (!query || ["exit", "quit"].includes(query.toLowerCase())) {
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