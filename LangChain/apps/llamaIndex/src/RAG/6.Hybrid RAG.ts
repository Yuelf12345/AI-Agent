/**
 * Hybrid RAG（混合 RAG）
 *
 * 同时使用 向量数据库（语义检索）+ 知识图谱（关系推理）双路检索，取长补短：
 *
 *                     ┌→ Vector DB → 语义相似检索 ──┐
 * 用户查询 → 查询分析 ─┼→ Graph DB → 实体关系推理 ──┼→ RRF 融合 → LLM 生成回答
 *                     └→ Web Search →（可选）──────┘
 *
 * 为什么混合？
 * - Vector DB：擅长语义相似性检索，但缺乏结构化关系推理
 * - Graph DB：擅长关系推理和路径遍历，但语义泛化能力弱
 * - 混合后同时获得语义理解和结构推理能力
 *
 * 融合策略：Reciprocal Rank Fusion (RRF)
 *   score = Σ 1/(k + rank_i)  其中 k=60（标准 RRF 常数）
 *   来自不同检索器的文档按排名加权融合
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
import { FILE_DIR, STORAGE_DIR, CACHE_NAIVE, CACHE_GRAPH_INDEX } from "../constants.ts";

// ═══════════════════════════════════════════════════════════════════════
//  Step 0: 初始化全局配置
// ═══════════════════════════════════════════════════════════════════════
initGlobalSettings();

// ═══════════════════════════════════════════════════════════════════════
//  加载文档 + 切分
// ═══════════════════════════════════════════════════════════════════════
let chunks: string[] = [];
let nodes: TextNode[] = [];

const hasCachedNodes = fs.existsSync(CACHE_NAIVE);

if (hasCachedNodes) {
  console.log("📂 检测到缓存的节点数据，直接加载...");
  const cached = JSON.parse(fs.readFileSync(CACHE_NAIVE, "utf-8"));
  nodes = cached.map(
    (item: { text: string; id_: string }) =>
      new TextNode({ text: item.text, id_: item.id_ }),
  );
  chunks = nodes.map((n) => n.text);
  console.log(`📊 从缓存加载 ${chunks.length} 个 chunk`);
} else {
  // Step 1: 加载文件
  const reader = new SimpleDirectoryReader();
  const documents = await reader.loadData({ directoryPath: FILE_DIR });
  console.log(`✅ 共加载 ${documents.length} 个文档`);
  const fullText = documents.map((d: Document) => d.text).join("\n\n");
  console.log(`📊 合并后总字符数: ${fullText.length}`);

  // Step 2: 切分
  const splitter = new LLMChunk({ chunkSize: 512, chunkOverlap: 20 });
  chunks = await splitter.splitText(fullText);
  nodes = chunks.map((text, i) => new TextNode({ text, id_: `llm-chunk-${i}` }));
  console.log(`📊 切分出 ${nodes.length} 个 chunk`);

  // 缓存切分结果
  const cacheDir = path.dirname(CACHE_NAIVE);
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(
    CACHE_NAIVE,
    JSON.stringify(nodes.map((n) => ({ text: n.text, id_: n.id_ })).sort()),
    "utf-8",
  );
  console.log(`💾 切分结果已缓存到 ${CACHE_NAIVE}`);
}

// ═══════════════════════════════════════════════════════════════════════
//  Step 3a: 构建向量索引（用于语义检索）
// ═══════════════════════════════════════════════════════════════════════
const storageContext = await storageContextFromDefaults({ persistDir: STORAGE_DIR });
const hasExistingIndex = fs.existsSync(path.join(STORAGE_DIR, "docstore.json"));

let vectorIndex: VectorStoreIndex;
if (hasExistingIndex) {
  console.log("📂 检测到已有持久化向量索引，直接加载...");
  vectorIndex = await VectorStoreIndex.init({ storageContext });
  console.log("✅ 向量索引加载完成");
} else {
  console.log("⏳ 正在构建向量索引...");
  vectorIndex = await VectorStoreIndex.init({ nodes, storageContext });
  console.log("✅ 向量索引构建完成 | 📦 节点数:", nodes.length);
}

// ═══════════════════════════════════════════════════════════════════════
//  Step 3b: 构建知识图谱（用于关系推理）
//  ── 复用 5.Graph RAG.ts 的核心构建管线
// ═══════════════════════════════════════════════════════════════════════

// ─── 实体抽取 ───────────────────────────────────────────────────────
async function extractEntities(chunkText: string, chunkIdx: number): Promise<{
  triples: Triple[];
  claims: Claim[];
}> {
  const prompt = `从以下文本中提取两类信息：实体关系三元组 和 事实性声明。

## 第一部分：三元组 (Triple)
每行一个，格式: 主体 | 关系 | 客体
主体和客体必须是名词性实体，关系必须是动词性短语。
只提取最重要的 3-5 个三元组，避免过度抽取噪声关系。

## 第二部分：声明 (Claim)
每行一个，格式: 实体 | 声明内容 | 状态 | 置信度
- 声明内容: 完整的陈述句子，保留原文关键信息
- 状态: 肯定的 / 否定的 / 可能的
- 置信度: 高 / 中 / 低（明确陈述=高，暗示=中，推测=低）

## 输出格式
===三元组===
(三元组内容)
===声明===
(声明内容)

示例:
===三元组===
CRISPE框架 | 包含 | 五个核心要素
BROKE框架 | 适用于 | 目标设定场景
===声明===
CRISPE框架 | CRISPE框架是一个提示词框架 | 肯定的 | 高
BROKE框架 | BROKE框架不适用于简单任务 | 否定的 | 中

文本:
${chunkText}

输出:`;

  const resp = await llm.chat({
    messages: [{ role: "user", content: prompt }],
  });
  const raw = (resp.message.content as string).trim();

  // 解析三元组
  const tripleSection = raw.split("===声明===")[0] || "";
  const triples: Triple[] = tripleSection
    .replace("===三元组===", "")
    .trim()
    .split("\n")
    .filter(line => line.includes("|"))
    .map(line => {
      const parts = line.split("|").map(s => s.trim());
      return { subject: parts[0] || "", relation: parts[1] || "", object: parts[2] || "" };
    })
    .filter(t => t.subject && t.relation && t.object);

  // 解析声明
  const claimSection = raw.split("===声明===")[1] || "";
  const claims: Claim[] = claimSection
    .trim()
    .split("\n")
    .filter(line => line.includes("|"))
    .map(line => {
      const parts = line.split("|").map(s => s.trim());
      return {
        subject: parts[0] || "",
        claim: parts[1] || "",
        status: (parts[2] || "可能的") as "肯定的" | "否定的" | "可能的",
        confidence: (parts[3] || "中") as "高" | "中" | "低",
        sourceChunk: chunkIdx,
      };
    })
    .filter(c => c.subject && c.claim);

  return { triples, claims };
}

// ─── 构建图 ────────────────────────────────────────────────────────
function buildGraph(triples: { chunkIdx: number; triple: Triple }[]): {
  graph: Graph;
  entityIndex: EntityIndex;
  stats: { entityCount: number; relationCount: number };
} {
  const graph: Graph = new Map();
  const entityIndex: EntityIndex = new Map();

  for (const { chunkIdx, triple } of triples) {
    const subject = triple.subject.replace(/\s+/g, "").trim();
    const relation = triple.relation.replace(/\s+/g, "").trim();
    const object = triple.object.replace(/\s+/g, "").trim();
    if (!subject || !relation || !object) continue;

    if (!graph.has(subject)) graph.set(subject, new Map());
    if (!graph.has(object)) graph.set(object, new Map());

    const subEdges = graph.get(subject)!;
    if (!subEdges.has(relation)) subEdges.set(relation, new Set());
    subEdges.get(relation)!.add(object);

    // 反向关系
    const objEdges = graph.get(object)!;
    const reverseRelation = `被${relation}`;
    if (!objEdges.has(reverseRelation)) objEdges.set(reverseRelation, new Set());
    objEdges.get(reverseRelation)!.add(subject);

    if (!entityIndex.has(subject)) entityIndex.set(subject, new Set());
    entityIndex.get(subject)!.add(chunkIdx);
    if (!entityIndex.has(object)) entityIndex.set(object, new Set());
    entityIndex.get(object)!.add(chunkIdx);
  }

  let relationCount = 0;
  for (const edges of graph.values()) {
    for (const targets of edges.values()) {
      relationCount += targets.size;
    }
  }

  return { graph, entityIndex, stats: { entityCount: graph.size, relationCount } };
}

// ─── 社区检测（BFS 连通分量）─────────────────────────────────────
function detectCommunities(graph: Graph): Set<string>[] {
  const visited = new Set<string>();
  const communities: Set<string>[] = [];

  for (const entity of graph.keys()) {
    if (visited.has(entity)) continue;

    const community = new Set<string>();
    const queue = [entity];
    visited.add(entity);

    while (queue.length > 0) {
      const current = queue.shift()!;
      community.add(current);

      const edges = graph.get(current);
      if (edges) {
        for (const targets of edges.values()) {
          for (const neighbor of targets) {
            if (!visited.has(neighbor)) {
              visited.add(neighbor);
              queue.push(neighbor);
            }
          }
        }
      }
    }
    communities.push(community);
  }

  return communities;
}

// ─── 社区摘要 ──────────────────────────────────────────────────────
async function summarizeCommunity(
  community: Set<string>,
  entityIndex: EntityIndex,
  chunks: string[],
): Promise<string> {
  const relatedChunkIds = new Set<number>();
  for (const entity of community) {
    const chunkIds = entityIndex.get(entity);
    if (chunkIds) {
      for (const id of chunkIds) relatedChunkIds.add(id);
    }
  }

  const contextText = [...relatedChunkIds]
    .sort((a, b) => a - b)
    .map(id => `[片段 ${id}]\n${chunks[id]}`)
    .join("\n\n");

  const entityList = [...community].join("、");

  const prompt = `以下是一个知识图谱"社区"中包含的实体和相关的原文片段。请生成一段简洁的摘要，概括这个社区的核心主题。

社区包含的实体: ${entityList}

相关原文:
${contextText.slice(0, 3000)}

摘要（200字以内）:`;

  const resp = await llm.chat({
    messages: [{ role: "user", content: prompt }],
  });
  return resp.message.content as string;
}

// ─── 序列化/反序列化 ──────────────────────────────────────────────
function serializeGraph(graph: Graph): { subject: string; relation: string; object: string }[] {
  const edges: { subject: string; relation: string; object: string }[] = [];
  for (const [subject, relations] of graph) {
    for (const [relation, targets] of relations) {
      for (const object of targets) {
        edges.push({ subject, relation, object });
      }
    }
  }
  return edges;
}

function deserializeGraph(edges: { subject: string; relation: string; object: string }[]): Graph {
  const graph: Graph = new Map();
  for (const { subject, relation, object } of edges) {
    if (!graph.has(subject)) graph.set(subject, new Map());
    const relations = graph.get(subject)!;
    if (!relations.has(relation)) relations.set(relation, new Set());
    relations.get(relation)!.add(object);
  }
  return graph;
}

function serializeEntityIndex(index: EntityIndex): { entity: string; chunks: number[] }[] {
  return [...index.entries()].map(([entity, chunks]) => ({ entity, chunks: [...chunks] }));
}

function deserializeEntityIndex(data: { entity: string; chunks: number[] }[]): EntityIndex {
  const index: EntityIndex = new Map();
  for (const { entity, chunks } of data) {
    index.set(entity, new Set(chunks));
  }
  return index;
}

// ─── 构建完整图索引 ───────────────────────────────────────────────
async function buildGraphIndex(chunks: string[]): Promise<{
  graph: Graph;
  entityIndex: EntityIndex;
  communities: Community[];
  claims: Claim[];
}> {
  if (fs.existsSync(CACHE_GRAPH_INDEX)) {
    console.log("📂 检测到图索引缓存，直接加载（跳过构建）...");
    const raw = JSON.parse(fs.readFileSync(CACHE_GRAPH_INDEX, "utf-8"));
    const graph = deserializeGraph(raw.graphEdges);
    const entityIndex = deserializeEntityIndex(raw.entityIndexData);
    return { graph, entityIndex, communities: raw.communities, claims: raw.claims };
  }

  console.log("⏳ 正在逐 chunk 抽取三元组和声明（构建知识图谱）...");
  type CachedTriple = { chunkIdx: number; triple: Triple };
  const allTriples: CachedTriple[] = [];
  const allClaims: Claim[] = [];
  for (let i = 0; i < chunks.length; i++) {
    process.stdout.write(`   [${i + 1}/${chunks.length}] 正在抽取...`);
    const { triples, claims } = await extractEntities(chunks[i]!, i);
    for (const triple of triples) allTriples.push({ chunkIdx: i, triple });
    allClaims.push(...claims);
    console.log(` ✓ ${triples.length} 个三元组, ${claims.length} 条声明`);
  }

  console.log("🔗 正在构建知识图谱...");
  const { graph, entityIndex } = buildGraph(allTriples);

  console.log("🏘️  正在检测社区...");
  const rawCommunities = detectCommunities(graph);

  console.log("⏳ 正在生成社区摘要...");
  const communities: Community[] = [];
  for (let i = 0; i < rawCommunities.length; i++) {
    process.stdout.write(`   [${i + 1}/${rawCommunities.length}] 正在生成摘要...`);
    const summary = await summarizeCommunity(rawCommunities[i]!, entityIndex, chunks);
    communities.push({ id: i, entities: [...rawCommunities[i]!], summary });
    console.log(" ✓");
  }

  const cacheDir = path.dirname(CACHE_GRAPH_INDEX);
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(CACHE_GRAPH_INDEX, JSON.stringify({
    graphEdges: serializeGraph(graph),
    entityIndexData: serializeEntityIndex(entityIndex),
    communities,
    claims: allClaims,
  }), "utf-8");
  console.log(`💾 图索引已缓存到 ${CACHE_GRAPH_INDEX}`);

  return { graph, entityIndex, communities, claims: allClaims };
}

// ─── 构建图索引 ────────────────────────────────────────────────────
console.log("⏳ 正在构建知识图谱索引...");
const { graph, entityIndex, communities, claims } = await buildGraphIndex(chunks);
console.log(`✅ 知识图谱构建完成！ ${graph.size} 个实体, ${communities.length} 个社区`);

// ═══════════════════════════════════════════════════════════════════════
//  Step 4: 双路检索 + RRF 融合
// ═══════════════════════════════════════════════════════════════════════

/**
 * 向量检索：使用 LlamaIndex VectorStoreIndex 做语义相似度检索
 */
async function vectorRetrieve(query: string, topK: number): Promise<RetrievedChunk[]> {
  const retriever = vectorIndex.asRetriever({ similarityTopK: topK });
  const nodes = await retriever.retrieve({ query });

  return nodes.map((node, rank) => {
    const id_ = (node.node as any).id_ ?? "";
    const chunkIndex = parseInt(id_.replace("llm-chunk-", ""), 10);
    return {
      chunkIndex: isNaN(chunkIndex) ? -1 : chunkIndex,
      text: (node.node as TextNode).text,
      vectorScore: node.score ?? 0,
      graphScore: 0,
      rankVector: rank + 1,
      rankGraph: 0,  // 图中未找到
    };
  });
}

/**
 * 图谱检索：识别查询实体 → BFS 遍历 → 返回相关 chunk
 */
async function graphRetrieve(query: string, topK: number): Promise<RetrievedChunk[]> {
  // Step 1: 识别查询中的实体
  const prompt = `分析以下问题，提取其中提到的关键实体（专有名词、技术概念、框架名称）。
每行输出一个实体名，如果没有则输出"无"。

问题: ${query}

实体:`;

  const resp = await llm.chat({
    messages: [{ role: "user", content: prompt }],
  });
  const raw = (resp.message.content as string).trim();
  const queryEntities = raw.split("\n").map(s => s.trim()).filter(s => s.length > 0 && s !== "无");

  if (queryEntities.length === 0) return [];

  // Step 2: 在图谱中定位实体
  let matchedEntities = queryEntities.filter(e => graph.has(e));

  if (matchedEntities.length === 0) {
    // 精确匹配失败 → LLM 语义匹配兜底
    // 🎯 优化: 只取前 50 个实体，避免全量实体列表塞入 Prompt 浪费 token
    const allEntities = [...graph.keys()];
    const TOP_N_ENTITIES = 50;
    const truncatedEntities = allEntities.length > TOP_N_ENTITIES
      ? allEntities.slice(0, TOP_N_ENTITIES)
      : allEntities;
    const matchPrompt = `以下是一个知识图谱中的部分实体列表。用户查询中包含以下实体名，请判断图谱中是否有与之指代同一实体的名称。
只输出匹配到的图谱实体名（一行一个），如果没有匹配输出"无"。

图谱实体列表（前${TOP_N_ENTITIES}个）:
${truncatedEntities.join("\n")}

用户查询实体:
${queryEntities.join(", ")}

匹配的图谱实体:`;

    const matchResp = await llm.chat({
      messages: [{ role: "user", content: matchPrompt }],
    });
    const matchRaw = (matchResp.message.content as string).trim();
    if (matchRaw !== "无") {
      matchedEntities = matchRaw.split("\n").map(s => s.trim()).filter(s => graph.has(s));
    }
  }

  if (matchedEntities.length === 0) return [];

  console.log(`      🔗 图内匹配到实体: ${matchedEntities.join(", ")}`);

  // Step 3: BFS 遍历邻居
  const relatedEntities = new Set<string>();
  const visited = new Set<string>();

  for (const entity of matchedEntities) {
    const queue: { entity: string; depth: number }[] = [{ entity, depth: 0 }];
    visited.add(entity);

    while (queue.length > 0) {
      const { entity: current, depth } = queue.shift()!;

      // 深度 0 的原始实体得分高，深度 1 的邻居次之
      relatedEntities.add(current);

      if (depth >= 1) continue; // 只遍历 1 层邻居（保持结果精炼）

      const edges = graph.get(current);
      if (edges) {
        for (const targets of edges.values()) {
          for (const neighbor of targets) {
            if (!visited.has(neighbor)) {
              visited.add(neighbor);
              queue.push({ entity: neighbor, depth: depth + 1 });
            }
          }
        }
      }
    }
  }

  // Step 4: 收集相关 chunk
  const relatedChunkIds = new Set<number>();
  const entityDepthMap = new Map<string, number>(); // entity → depth

  for (const entity of matchedEntities) entityDepthMap.set(entity, 0);
  for (const entity of relatedEntities) {
    if (!entityDepthMap.has(entity)) entityDepthMap.set(entity, 1);
  }

  for (const entity of relatedEntities) {
    const chunkIds = entityIndex.get(entity);
    if (chunkIds) {
      for (const id of chunkIds) relatedChunkIds.add(id);
    }
  }

  // Step 5: 构建结果（带 graphScore 衰减）
  const results: RetrievedChunk[] = [];
  let rank = 0;
  for (const chunkId of relatedChunkIds) {
    rank++;
    // 计算 graphScore：检查该 chunk 涵盖的实体的最小深度
    let minDepth = 999;
    for (const entity of relatedEntities) {
      const eChunks = entityIndex.get(entity);
      if (eChunks && eChunks.has(chunkId)) {
        const depth = entityDepthMap.get(entity) ?? 999;
        minDepth = Math.min(minDepth, depth);
      }
    }
    const graphScore = minDepth === 0 ? 1.0 : minDepth === 1 ? 0.7 : 0.4;

    results.push({
      chunkIndex: chunkId,
      text: chunks[chunkId] ?? "",
      vectorScore: 0,
      graphScore,
      rankVector: 0,
      rankGraph: rank,
    });
  }

  // 按 graphScore 降序，取 topK
  return results.sort((a, b) => b.graphScore - a.graphScore).slice(0, topK);
}

/**
 * Reciprocal Rank Fusion (RRF)：融合双路检索结果
 *
 * RRF Score = Σ(1 / (k + rank_i))
 * - k = 60（标准 RRF 常数）
 * - rank_i = 该文档在第 i 个检索器中的排名（1-based）
 * - 若文档未出现在某检索器结果中，rank_i = ∞，贡献为 0
 */
function reciprocalRankFusion(
  vectorResults: RetrievedChunk[],
  graphResults: RetrievedChunk[],
  topK: number,
): RetrievedChunk[] {
  const fusionMap = new Map<number, RetrievedChunk>();

  // 合并所有结果
  const allResults = [...vectorResults, ...graphResults];
  for (const item of allResults) {
    if (item.chunkIndex === -1) continue;

    if (!fusionMap.has(item.chunkIndex)) {
      fusionMap.set(item.chunkIndex, {
        chunkIndex: item.chunkIndex,
        text: item.text,
        vectorScore: 0,
        graphScore: 0,
        rankVector: 0,
        rankGraph: 0,
      });
    }

    const existing = fusionMap.get(item.chunkIndex)!;
    if (item.vectorScore > 0) {
      existing.vectorScore = item.vectorScore;
      existing.rankVector = item.rankVector;
    }
    if (item.graphScore > 0) {
      existing.graphScore = item.graphScore;
      existing.rankGraph = item.rankGraph;
    }
  }

  // 计算 RRF 分数
  const fused = [...fusionMap.values()].map((item) => {
    const rrfFromVector = item.rankVector > 0
      ? 1 / (RETRIEVAL_CONFIG.rrfK + item.rankVector)
      : 0;
    const rrfFromGraph = item.rankGraph > 0
      ? 1 / (RETRIEVAL_CONFIG.rrfK + item.rankGraph)
      : 0;
    return { ...item, rrfScore: rrfFromVector + rrfFromGraph };
  });

  // 按 RRF 分数降序排列
  return fused
    .sort((a, b) => (b as any).rrfScore - (a as any).rrfScore)
    .slice(0, topK)
    .map(({ rrfScore: _, ...rest }) => rest);
}

/**
 * 主混合检索函数
 */
async function hybridRetrieve(query: string): Promise<{
  vectorResults: RetrievedChunk[];
  graphResults: RetrievedChunk[];
  fusedResults: RetrievedChunk[];
}> {
  console.log("   🔍 [向量检索] 语义相似度检索...");
  const vectorResults = await vectorRetrieve(query, RETRIEVAL_CONFIG.vectorTopK);
  console.log(`      ✅ 向量检索: ${vectorResults.length} 个结果`);

  console.log("   🔍 [图谱检索] 实体关系推理...");
  const graphResults = await graphRetrieve(query, RETRIEVAL_CONFIG.graphTopK);
  console.log(`      ✅ 图谱检索: ${graphResults.length} 个结果`);

  console.log("   🔗 [RRF 融合] 融合双路检索结果...");
  const fusedResults = reciprocalRankFusion(vectorResults, graphResults, RETRIEVAL_CONFIG.finalTopK);
  console.log(`      ✅ 融合后: ${fusedResults.length} 个最终结果`);

  // 打印融合详情
  const vectorOnly = fusedResults.filter(r => r.graphScore === 0 && r.vectorScore > 0).length;
  const graphOnly = fusedResults.filter(r => r.vectorScore === 0 && r.graphScore > 0).length;
  const both = fusedResults.filter(r => r.vectorScore > 0 && r.graphScore > 0).length;
  console.log(`      📊 来源: 向量独有 ${vectorOnly}, 图谱独有 ${graphOnly}, 双路命中 ${both}`);

  return { vectorResults, graphResults, fusedResults };
}

// ═══════════════════════════════════════════════════════════════════════
//  Step 5: 聊天循环
// ═══════════════════════════════════════════════════════════════════════
console.log("\n");
console.log("═".repeat(60));
console.log("🤖 Hybrid RAG 已就绪！输入问题开始对话，输入 exit 退出");
console.log("═".repeat(60));
console.log("💡 向量检索擅长: 语义相似的文本匹配（如“什么是CRISPE框架”）");
console.log("💡 图谱检索擅长: 实体关系推理（如“CRISPE和BROKE有什么联系”）");
console.log("💡 混合检索: 同时获得语义理解 + 关系推理能力");
console.log("─".repeat(60));

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
  while (true) {
    let query: string;
    try {
      query = await prompt();
    } catch {
      break;
    }
    if (!query || query.toLowerCase() === "exit" || query.toLowerCase() === "quit") {
      console.log("\n👋 再见！");
      rl.close();
      tokenTracker.printUsage();
      break;
    }

    console.log("⏳ 思考中...\n");
    try {
      // Step 1: 双路检索 + RRF 融合
      const { fusedResults } = await hybridRetrieve(query);

      if (fusedResults.length === 0) {
        console.log("\n🤖 Agent: 未检索到相关信息，请尝试换个问题。");
        console.log("");
        continue;
      }

      // Step 2: 构建上下文
      const context = fusedResults
        .map((r, i) => {
          const tags = [];
          if (r.vectorScore > 0) tags.push("📄语义");
          if (r.graphScore > 0) tags.push("🔗关系");
          return `[片段 ${i + 1}] (来源: ${tags.join(" + ")})\n${r.text}`;
        })
        .join("\n\n---\n\n");

      // Step 3: 结合社区摘要（如果有匹配的社区）
      // 查找与检索结果相关的社区
      const matchedEntityChunks = new Set<number>(fusedResults.map(r => r.chunkIndex));
      let communityContext = "";
      for (const community of communities) {
        for (const entity of community.entities) {
          const eChunks = entityIndex.get(entity);
          if (eChunks) {
            for (const cid of eChunks) {
              if (matchedEntityChunks.has(cid)) {
                communityContext += `【社区 ${community.id}】${community.summary}\n\n`;
                break;
              }
            }
          }
        }
      }

      // Step 4: LLM 生成最终回答
      let finalPrompt = `请基于以下检索到的信息，准确、简洁地回答用户问题。

【检索结果】
${context}
`;

      if (communityContext) {
        finalPrompt += `\n【相关知识社区摘要】\n${communityContext}`;
      }

      finalPrompt += `\n【用户问题】
${query}

注意：
- 片段按相关性从高到低排列，[片段 1] 最相关，[片段 N] 最不相关
- 优先使用检索到的信息回答问题
- 如果信息不足，请说明"未找到相关信息"
- 如果多个来源信息有冲突，请指出并给出你的判断`;

      const response = await llm.chat({
        messages: [{ role: "user", content: finalPrompt }],
      });

      console.log(`\n🤖 Agent [Hybrid RAG]: ${response.message.content}`);
      console.log("");
    } catch (err) {
      console.error("❌ 出错:", err);
    }
  }
}

chatLoop();