import path from "path";
import fs from "fs";
import * as readline from "readline";

// ─── LlamaIndex 核心模块 ────────────────────────────────────────────
import { SimpleDirectoryReader } from "@llamaindex/readers/directory";
import { VectorStoreIndex, storageContextFromDefaults, } from "llamaindex";
import { Document, TextNode } from "@llamaindex/core/schema";
import { OpenAIEmbedding } from '@llamaindex/openai'
import { Settings } from '@llamaindex/core/global'

// ─── 本地模块 ────────────────────────────────────────────────────────
import llm from '../llm.ts'
import { FixedSizeChunk, SemanticChunk, RecursiveChunk, LLMChunk, SentenceSplitter, TokenTextSplitter, SentenceWindowNodeParser } from "../check/index.ts";
import { FILE_DIR, STORAGE_DIR, CACHE_NAIVE } from "../constants.ts";

//  Step 0: 全局配置 — 设置 Embedding 模型和 LLM
// ═══════════════════════════════════════════════════════════════════════
const configureSettings = () => {
    Settings.embedModel = new OpenAIEmbedding({
        model: "text-embedding-v3", // 阿里云通义千问 embedding 模型
    });
    Settings.llm = llm;
    console.log("⚙️  全局配置完成 — Embedding: text-embedding-v3, LLM: 已就绪");
}

// Step0: 全局配置
configureSettings();

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
        console.log("📂 检测到缓存的节点数据，直接加载...");
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

//  Step 4: 构建 Corrective

// ═══════════════════════════════════════════════════════════════════════
//  Grader（评分器）：用 LLM 判断 chunk 与 query 的相关性
// ═══════════════════════════════════════════════════════════════════════
interface GradeResult {
  score: number;       // 1-10
  isRelevant: boolean; // score >= 4
}

async function gradeRelevance(query: string, chunkText: string): Promise<GradeResult> {
  const prompt = `你是一个严格的检索质量评分器。请判断以下"文档片段"是否**直接包含**了用户问题的答案。

评分标准（只输出一个整数，不要输出其他内容）：
- 1~3 分：文档中完全没提到问题相关内容，或只列了名词但没有解释
- 4~6 分：文档中**提到了**相关信息，但**没有完整解释**或内容很简略
- 7~10 分：文档**直接且完整地**回答了用户问题，包含具体细节或解释

举例：
  用户问题: "什么是CRISPE框架"
  - 文档只说"常用框架包括CRISPE" → 给 3 分（只是提到）
  - 文档详细解释了CRISPE每个字母的含义 → 给 8 分（直接回答了）

用户查询: ${query}
文档片段: ${chunkText.slice(0, 1200)}
分数:`;

  const resp = await llm.chat({
    messages: [{ role: "user", content: prompt }],
  });
  const raw = (resp.message.content as string).trim();
  const score = parseInt(raw, 10);
  const validScore = isNaN(score) ? 1 : Math.max(1, Math.min(10, score));
  return { score: validScore, isRelevant: validScore >= 4 };
}

// ═══════════════════════════════════════════════════════════════════════
//  知识精炼：逐一评分，只保留相关 chunk
// ═══════════════════════════════════════════════════════════════════════
interface RefinedChunk {
  text: string;
  score: number;
}

async function refineChunks(
  query: string,
  nodes: { node: { text: string }; score?: number }[],
): Promise<{
  refined: RefinedChunk[];  // 评分≥4的
  maxScore: number;         // 最高分（用于路由决策）
  avgScore: number;         // 平均分
}> {
  const results: RefinedChunk[] = [];
  let totalScore = 0;

  for (const n of nodes) {
    const grade = await gradeRelevance(query, n.node.text);
    totalScore += grade.score;
    if (grade.isRelevant) {
      results.push({ text: n.node.text, score: grade.score });
    }
  }

  const maxScore = results.length > 0 ? Math.max(...results.map(r => r.score)) : 1;
  const avgScore = nodes.length > 0 ? totalScore / nodes.length : 1;

  return { refined: results, maxScore, avgScore };
}


// ═══════════════════════════════════════════════════════════════════════
//  Web Search：当本地知识库不够用时，补充外部信息
//  支持两种模式：
//  A) Tavily API（推荐，需申请免费 key）
//  B) 降级模式：直接让 LLM 基于自身知识回答
// ═══════════════════════════════════════════════════════════════════════

// ─── 方案 A：Tavily Search ──────────────────────────────────────────
// 使用前需要: npm install @langchain/community
// import { TavilySearchResults } from "@langchain/community/tools/tavily_search";
// const webSearchTool = new TavilySearchResults({ maxResults: 3 });
// async function webSearch(query: string) {
//   const results = await webSearchTool.invoke(query);
//   return results.map((r: any) => `[来源: ${r.url}]\n${r.content}`).join("\n\n");
// }

// ─── 方案 B：降级模式（零依赖，直接用 LLM 知识） ────────────────────
async function webSearch(query: string): Promise<string> {
  const prompt = `你是一个网络搜索引擎。用户问了一个问题，但本地知识库中没有相关信息。
请根据你自身的知识，提供关于以下问题的详细、准确的信息。

注意：
1. 如果不知道答案，明确说"不知道"，不要编造
2. 尽可能提供具体的事实、数据、引用
3. 以客观陈述的方式输出，不要加"根据我的知识"等前缀

问题: ${query}

相关信息:`;

  const resp = await llm.chat({
    messages: [{ role: "user", content: prompt }],
  });
  return resp.message.content as string;
}

// ═══════════════════════════════════════════════════════════════════════
//  Step5:  路路由决策 + 最终生成
// ═══════════════════════════════════════════════════════════════════════
type Route = "high" | "medium" | "low";

function decideRoute(avgScore: number): Route {
  // 用平均分决策，防止单个高分 chunk 误导路由
  if (avgScore >= 5) return "high";
  if (avgScore >= 3) return "medium";
  return "low";
}

console.log("\n\n🤖 Corrective RAG 已就绪！输入问题开始对话，输入 exit 退出");
console.log("─".repeat(60));
console.log("💡 试试这些问题:");
console.log("   • 什么是CRISPE框架");
console.log("   • Prompt Engineering 有哪些框架");
console.log("─".repeat(60));

const retriever = index.asRetriever({ similarityTopK: 3 });

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
  let query: string;
  while (true) {
    try {
      query = await prompt();
      if (!query || query.toLowerCase() === "exit" || query.toLowerCase() === "quit") {
        console.log("\n👋 再见！");
        rl.close();
        break;
      }

      console.log("⏳ 正在检索知识库...\n");

      // ─── Phase 1: 向量检索 ──────────────────────────────────────
      const retrievedNodes = await retriever.retrieve(query);
      console.log(`📎 检索到 ${retrievedNodes.length} 个 chunk`);

      // ─── Phase 2: 评分 + 精炼 ───────────────────────────────────
      console.log("🔍 正在评估检索质量...");
      // DEBUG: 打印每个 chunk 的前 100 字
      retrievedNodes.forEach((n, i) => {
        console.log(`   [${i}] 向量分: ${((n.score ?? 0) * 100).toFixed(1)}% | ${n.node.text.slice(0, 80)}...`);
      });
      const { refined, maxScore, avgScore } = await refineChunks(query, retrievedNodes);
      // 用平均分做路由决策，防止单个高分"沾边"chunk 误导
      const route = decideRoute(avgScore);
      console.log(`   📊 最高分: ${maxScore}/10 | 平均分: ${avgScore.toFixed(1)}/10 → 路由: ${routeLabel(route)}`);
      console.log(`   ✅ 精炼后保留 ${refined.length} 个 chunk`);

      // ─── Phase 3: 3 路路由 ──────────────────────────────────────
      let finalContext = "";
      let contextSource = "";

      switch (route) {
        case "high": {
          // 直接用精炼后的检索结果
          const kept = refined.map((r, i) => `[文档片段 ${i + 1} (相关度: ${r.score}/10)]\n${r.text}`);
          finalContext = kept.join("\n\n");
          contextSource = "本地知识库";
          console.log(`   ✅ 使用 ${refined.length} 个高质量 chunk`);
          break;
        }

        case "medium": {
          // 检索结果 + Web Search 融合
          const localPart = refined.map((r, i) =>
            `[本地知识库 ${i + 1} (相关度: ${r.score}/10)]\n${r.text}`
          ).join("\n\n");

          console.log("🌐 正在补充网络搜索...");
          const webResult = await webSearch(query);

          finalContext = localPart + "\n\n─── 网络搜索结果 ───\n\n" + `[网络搜索结果]\n${webResult}`;
          contextSource = "本地知识库 + 网络搜索";
          break;
        }

        case "low": {
          // 完全放弃检索，仅用 Web Search
          console.log("🌐 检索质量过低，切换到网络搜索...");
          const webResult = await webSearch(query);
          finalContext = `[网络搜索结果]\n${webResult}`;
          contextSource = "仅网络搜索";
          break;
        }
      }

      // ─── Phase 4: LLM 生成最终回答 ─────────────────────────────
      console.log(`🧠 正在基于 ${contextSource} 生成回答...\n`);

      const finalPrompt = `请基于以下参考资料，准确、简洁地回答用户问题。

【参考资料来源: ${contextSource}】
${finalContext}

【用户问题】
${query}

注意：
- 如果是"仅网络搜索"来源，说明本地知识库未找到相关信息
- 如果资料中无相关信息，请明确说明"未找到相关内容"
- 引用资料时标注来源（本地知识库 / 网络搜索）`;

      const finalResp = await llm.chat({
        messages: [{ role: "user", content: finalPrompt }],
      });

      console.log(`\n🤖 Agent [${contextSource}]: ${finalResp.message.content}`);
      console.log("");

    } catch (err) {
      console.error("❌ 出错:", err);
    }
  }
}

function routeLabel(route: Route): string {
  switch (route) {
    case "high":   return "🟢 高质量 — 直接用检索结果";
    case "medium": return "🟡 部分相关 — 融合网络搜索";
    case "low":    return "🔴 低质量 — 仅用网络搜索";
  }
}

chatLoop()