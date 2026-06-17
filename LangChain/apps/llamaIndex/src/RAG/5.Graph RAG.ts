/**
 * Graph RAG（图 RAG）
 *
 * 用知识图谱替代向量检索，捕获实体间的**关系结构**：
 *
 * 索引阶段:
 *   文档 → 切分 → LLM 实体抽取 → 构建图(邻接表) → 社区检测 → 社区摘要
 *
 * 查询阶段:
 *   用户查询 → LLM 命名实体识别 → 在图谱中定位 → BFS遍历邻居
 *   → 收集社区摘要 → LLM 生成回答
 *
 * 与 Naive RAG 的关键区别:
 * - Naive RAG: 语义相似度匹配文本片段
 * - Graph RAG: 实体关系推理，发现间接关联
 */

import path from "path";
import fs from "fs";
import * as readline from "readline";

// ─── LlamaIndex 核心模块 ────────────────────────────────────────────
import { SimpleDirectoryReader } from "@llamaindex/readers/directory";
import { Document, TextNode } from "@llamaindex/core/schema";
import { OpenAIEmbedding } from '@llamaindex/openai'
import { Settings } from '@llamaindex/core/global'

// ─── 本地模块 ────────────────────────────────────────────────────────
import llm from '../llm.ts'
import { LLMChunk } from "../check/index.ts";
import { FILE_DIR, CACHE_NAIVE, CACHE_GRAPH_INDEX } from "../constants.ts";

// ═══════════════════════════════════════════════════════════════════════
//  类型定义
// ═══════════════════════════════════════════════════════════════════════

/** 三元组: (主体, 关系, 客体) */
interface Triple {
  subject: string;
  relation: string;
  object: string;
}

/** 图结构: entity → { relation → Set<targetEntity> } */
type Graph = Map<string, Map<string, Set<string>>>;

/** 实体 → chunk索引 映射（用于回溯原文） */
type EntityIndex = Map<string, Set<number>>;

/** 社区: 一组实体 */
interface Community {
  id: number;
  entities: string[];
  summary: string;
}

/** 声明: 带状态和置信度的陈述（比三元组更丰富） */
interface Claim {
  subject: string;       // 关联的主体实体
  claim: string;         // 声明内容（完整陈述）
  status: "肯定的" | "否定的" | "可能的";
  confidence: "高" | "中" | "低";
  sourceChunk: number;   // 来源 chunk 索引
}

// ═══════════════════════════════════════════════════════════════════════
//  Step 0: 全局配置 — 设置 LLM
// ═══════════════════════════════════════════════════════════════════════
const configureSettings = () => {
  Settings.llm = llm;
  console.log("⚙️  全局配置完成 — LLM: 已就绪");
}

// Step0: 全局配置
configureSettings();

// ═══════════════════════════════════════════════════════════════════════
//  加载文档 + 切分（复用 Naive 的缓存）
// ═══════════════════════════════════════════════════════════════════════
let chunks: string[] = [];
const hasCachedNodes = fs.existsSync(CACHE_NAIVE);

if (hasCachedNodes) {
  console.log("📂 检测到缓存的节点数据，直接加载...");
  const cached = JSON.parse(fs.readFileSync(CACHE_NAIVE, "utf-8"));
  chunks = cached.map((item: { text: string }) => item.text);
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
  console.log(`📊 切分出 ${chunks.length} 个 chunk`);

  // 缓存切分结果
  const cacheDir = path.dirname(CACHE_NAIVE);
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(
    CACHE_NAIVE,
    JSON.stringify(chunks.map((text) => ({ text }))),
    "utf-8",
  );
  console.log(`💾 切分结果已缓存到 ${CACHE_NAIVE}`);
}

// ═══════════════════════════════════════════════════════════════════════
//  Step 2: 实体抽取（三元组 + 声明，一次 LLM 调用）
// ═══════════════════════════════════════════════════════════════════════
async function extractEntities(chunkText: string, chunkIdx: number): Promise<{
  triples: Triple[];
  claims: Claim[];
}> {
  const prompt = `从以下文本中提取两类信息：实体关系三元组 和 事实性声明。

## 第一部分：三元组 (Triple)
每行一个，格式: 主体 | 关系 | 客体
主体和客体必须是名词性实体，关系必须是动词性短语。

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

  // 解析三元组部分
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

  // 解析声明部分
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

// ═══════════════════════════════════════════════════════════════════════
//  Step 3: 图结构构建（从三元组构建邻接表 + 实体索引）
// ═══════════════════════════════════════════════════════════════════════
function buildGraph(triples: { chunkIdx: number; triple: Triple }[]): {
  graph: Graph;
  entityIndex: EntityIndex;
  stats: { entityCount: number; relationCount: number };
} {
  const graph: Graph = new Map();
  const entityIndex: EntityIndex = new Map();

  for (const { chunkIdx, triple } of triples) {
    // 标准化实体名：去除多余空格
    const subject = triple.subject.replace(/\s+/g, "").trim();
    const relation = triple.relation.replace(/\s+/g, "").trim();
    const object = triple.object.replace(/\s+/g, "").trim();

    if (!subject || !relation || !object) continue;

    // 初始化实体节点
    if (!graph.has(subject)) graph.set(subject, new Map());
    if (!graph.has(object)) graph.set(object, new Map());

    // 添加关系边 (双向)
    const subEdges = graph.get(subject)!;
    if (!subEdges.has(relation)) subEdges.set(relation, new Set());
    subEdges.get(relation)!.add(object);

    // 反向关系（自动生成"被...关系"）
    const objEdges = graph.get(object)!;
    const reverseRelation = `被${relation}`;
    if (!objEdges.has(reverseRelation)) objEdges.set(reverseRelation, new Set());
    objEdges.get(reverseRelation)!.add(subject);

    // 索引实体 → chunk 映射
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

  return {
    graph,
    entityIndex,
    stats: { entityCount: graph.size, relationCount },
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  Step 3b: 实体消歧 — 合并指代同一事物的不同实体名
// ═══════════════════════════════════════════════════════════════════════

// ─── 字符串层面的候选检测（不调用 LLM）────────────────────────────
function getMergeReason(a: string, b: string): string | null {
  const na = a.replace(/\s+/g, "");
  const nb = b.replace(/\s+/g, "");

  if (na === nb && a !== b) return "空格/格式差异";

  // 包含关系: "CRISPE" ⊆ "CRISPE框架"
  if (na.length > 2 && nb.length > 2) {
    const shorter = na.length <= nb.length ? na : nb;
    const longer = na.length > nb.length ? na : nb;
    if (longer.includes(shorter) && shorter.length >= longer.length * 0.4) {
      return `包含关系（${shorter} ⊆ ${longer}）`;
    }
  }

  // 后缀差异: "CRISPE框架" vs "CRISPE"
  const suffixes = ["框架", "方法", "技术", "系统", "模式", "算法", "模型", "协议", "工具"];
  const stripSuffix = (s: string) => {
    for (const sfx of suffixes) {
      if (s.endsWith(sfx)) return s.slice(0, -sfx.length);
    }
    return s;
  };
  const strippedA = stripSuffix(na);
  const strippedB = stripSuffix(nb);
  if (strippedA !== na && strippedB !== nb && strippedA === strippedB) {
    return "框架/方法后缀差异";
  }

  // 高字符重叠率（> 70%）
  if (na.length > 3 && nb.length > 3) {
    const charsA = new Set(na);
    const charsB = new Set(nb);
    const intersection = new Set([...charsA].filter(c => charsB.has(c)));
    const overlap = intersection.size / Math.min(charsA.size, charsB.size);
    if (overlap > 0.7) return `字符重叠率 ${(overlap * 100).toFixed(0)}%`;
  }

  return null;
}

// ─── LLM 判断两个实体是否应合并 ──────────────────────────────────
async function judgeMerge(entityA: string, entityB: string): Promise<boolean> {
  const prompt = `判断以下两个实体名称是否指代同一个事物。
只输出"是"或"否"，不要输出其他内容。

实体1: ${entityA}
实体2: ${entityB}

注意：
- "CRISPE框架"和"CRISPE" → 是（指同一个框架）
- "CoT"和"Chain of Thought" → 是（缩写和全称）
- "数据分析师"和"角色" → 否（不同概念）
- "角色"和"Role" → 否（仅当明确是同义词时才是）

它们是否指代同一个事物？`;

  const resp = await llm.chat({
    messages: [{ role: "user", content: prompt }],
  });
  const answer = (resp.message.content as string).trim();
  return answer === "是" || answer.startsWith("是");
}

// ─── 合并实体：将 remove 的所有边和索引合并到 keep
function mergeEntities(
  graph: Graph,
  entityIndex: EntityIndex,
  keep: string,
  remove: string,
  mergeLog: string[],
): void {
  const removeEdges = graph.get(remove);
  if (!removeEdges) return;

  const keepEdges = graph.get(keep)!;

  // 将 remove 的所有出边合并到 keep
  for (const [relation, targets] of removeEdges) {
    if (!keepEdges.has(relation)) keepEdges.set(relation, new Set());
    for (const target of targets) {
      keepEdges.get(relation)!.add(target);

      // 修复 target 指向 remove 的反向边
      const targetEdges = graph.get(target);
      if (targetEdges) {
        for (const [revRel, revTargets] of targetEdges) {
          if (revTargets.has(remove)) {
            revTargets.delete(remove);
            revTargets.add(keep);
          }
        }
      }
    }
  }

  // 删除 remove 节点
  graph.delete(remove);

  // 合并实体索引
  const removeChunks = entityIndex.get(remove);
  if (removeChunks) {
    if (!entityIndex.has(keep)) entityIndex.set(keep, new Set());
    for (const chunkIdx of removeChunks) {
      entityIndex.get(keep)!.add(chunkIdx);
    }
    entityIndex.delete(remove);
  }

  mergeLog.push(`  ${remove} → ${keep}`);
}

// ─── 实体消歧主流程 ────────────────────────────────────────────
async function resolveEntities(
  graph: Graph,
  entityIndex: EntityIndex,
  allTriples: { chunkIdx: number; triple: Triple }[],
): Promise<{ graph: Graph; entityIndex: EntityIndex; mergedCount: number }> {
  const allEntities = [...graph.keys()];
  console.log(`🔍 开始实体消歧，共 ${allEntities.length} 个实体...`);

  const mergeLog: string[] = [];

  // Step 1: 字符串级候选检测（无 LLM 调用）
  const candidates: [string, string, string][] = [];
  for (let i = 0; i < allEntities.length; i++) {
    for (let j = i + 1; j < allEntities.length; j++) {
      const reason = getMergeReason(allEntities[i]!, allEntities[j]!);
      if (reason) {
        candidates.push([allEntities[i]!, allEntities[j]!, reason!]);
      }
    }
  }

  if (candidates.length === 0) {
    console.log("   ✅ 未发现需要合并的候选实体");
    return { graph, entityIndex, mergedCount: 0 };
  }

  console.log(`   📋 发现 ${candidates.length} 组候选合并对:`);
  candidates.forEach(([a, b, reason]) => {
    console.log(`      "${a}" ↔ "${b}" (${reason})`);
  });

  // Step 2: LLM 逐对判断
  console.log("   🤖 LLM 正在判断是否合并...");
  let mergedCount = 0;
  for (const [entityA, entityB, reason] of candidates) {
    // 跳过已被合并掉的实体
    if (!graph.has(entityA) || !graph.has(entityB)) continue;

    process.stdout.write(`      "${entityA}" ↔ "${entityB}"...`);
    const shouldMerge = await judgeMerge(entityA, entityB);

    if (shouldMerge) {
      // 保长弃短：保留较完整的实体名
      const [keep, remove] = entityA.length >= entityB.length
        ? [entityA, entityB]
        : [entityB, entityA];
      mergeEntities(graph, entityIndex, keep, remove, mergeLog);
      mergedCount++;
      console.log(" ✅ 合并");
    } else {
      console.log(" ❌ 不合并");
    }
  }

  console.log(`   📊 共合并 ${mergedCount} 组实体`);
  if (mergeLog.length > 0) {
    console.log("   📝 合并记录:");
    mergeLog.forEach(log => console.log(log));
  }

  // Step 3: 更新缓存的三元组（将已合并的实体名统一为新名称）
  const entityNameMap = new Map<string, string>(); // oldName → newName
  for (const log of mergeLog) {
    const [from, to] = log.trim().split(" → ");
    if (!from || !to) continue;
    entityNameMap.set(from, to);
  }
  if (entityNameMap.size > 0) {
    for (const cached of allTriples) {
      if (entityNameMap.has(cached.triple.subject)) {
        cached.triple.subject = entityNameMap.get(cached.triple.subject)!;
      }
      if (entityNameMap.has(cached.triple.object)) {
        cached.triple.object = entityNameMap.get(cached.triple.object)!;
      }
    }
    // 实体消歧后，完整索引缓存由 buildGraphIndex 统一写入
  }

  return { graph, entityIndex, mergedCount };
}

// ═══════════════════════════════════════════════════════════════════════
//  Step 4: 社区检测（BFS 连通分量）
// ═══════════════════════════════════════════════════════════════════════
function detectCommunities(graph: Graph): Set<string>[] {
  const visited = new Set<string>();
  const communities: Set<string>[] = [];

  for (const entity of graph.keys()) {
    if (visited.has(entity)) continue;

    // BFS 遍历
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

// ═══════════════════════════════════════════════════════════════════════
//  Step 5: 社区摘要生成
// ═══════════════════════════════════════════════════════════════════════
async function summarizeCommunity(
  community: Set<string>,
  entityIndex: EntityIndex,
  chunks: string[],
): Promise<string> {
  // 收集社区中所有实体对应的原文
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

// ═══════════════════════════════════════════════════════════════════════
//  图/索引序列化（用于完整索引缓存）
// ═══════════════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════════════
//  构建索引管线: 实体抽取 → 建图 → 社区检测 → 摘要
// ═══════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════
//  构建索引管线: 实体抽取 → 建图 → 社区检测 → 摘要
// ═══════════════════════════════════════════════════════════════════════
async function buildGraphIndex(chunks: string[]): Promise<{
  graph: Graph;
  entityIndex: EntityIndex;
  communities: Community[];
  claims: Claim[];
}> {
  // ─── 完整索引缓存：跳过整条管线 ───────────────────────────────────
  if (fs.existsSync(CACHE_GRAPH_INDEX)) {
    console.log("📂 检测到完整索引缓存，直接加载（跳过构建、消歧、社区检测）...");
    const raw = JSON.parse(fs.readFileSync(CACHE_GRAPH_INDEX, "utf-8"));
    const graph = deserializeGraph(raw.graphEdges);
    const entityIndex = deserializeEntityIndex(raw.entityIndexData);
    return { graph, entityIndex, communities: raw.communities, claims: raw.claims };
  }

  // ─── 全量构建 ─────────────────────────────────────────────────────
  console.log("⏳ 正在逐 chunk 抽取三元组和声明（这可能需要一些时间）...");
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

  console.log("🔍 正在执行实体消歧...");
  const { graph: resolvedGraph, entityIndex: resolvedIndex } = await resolveEntities(graph, entityIndex, allTriples);

  console.log("🏘️  正在检测社区...");
  const rawCommunities = detectCommunities(resolvedGraph);

  console.log("⏳ 正在生成社区摘要...");
  const communities: Community[] = [];
  for (let i = 0; i < rawCommunities.length; i++) {
    process.stdout.write(`   [${i + 1}/${rawCommunities.length}] 正在生成摘要...`);
    const summary = await summarizeCommunity(rawCommunities[i]!, resolvedIndex, chunks);
    communities.push({ id: i, entities: [...rawCommunities[i]!], summary });
    console.log(" ✓");
  }

  // ─── 写完整索引缓存（一个文件全部包含） ─────────────────────────
  const cacheDir = path.dirname(CACHE_GRAPH_INDEX);
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(CACHE_GRAPH_INDEX, JSON.stringify({
    graphEdges: serializeGraph(resolvedGraph),
    entityIndexData: serializeEntityIndex(resolvedIndex),
    communities,
    claims: allClaims,
  }), "utf-8");
  console.log(`💾 完整索引已缓存到 ${CACHE_GRAPH_INDEX}，后续启动将跳过整条管线`);

  return { graph: resolvedGraph, entityIndex: resolvedIndex, communities, claims: allClaims };
}

// ═══════════════════════════════════════════════════════════════════════
//  Step 6: 查询流水线
// ═══════════════════════════════════════════════════════════════════════

// ─── 6a: 统一分析查询（路由 + 实体识别，一次 LLM 调用） ────────────
async function analyzeQuery(query: string): Promise<{
  mode: "local" | "global";
  entities: string[];
}> {
  const prompt = `分析以下用户问题的类型，并提取关键实体。

一、类型判断：
- "local"：询问具体实体、概念、框架的定义或细节（如"什么是CRISPE框架"、"CoT是什么"）
- "global"：询问整体分类、列表、概览（如"有哪些提示词框架"、"主要技术分支"）

二、实体提取：
只提取明确提到的专有名词、技术概念、框架名称，每行一个。

三、输出格式：
类型: local 或 global
实体:
(实体名1)
(实体名2)

问题: ${query}

类型:`;

  const resp = await llm.chat({
    messages: [{ role: "user", content: prompt }],
  });
  const raw = (resp.message.content as string).trim();

  // 解析类型
  const typeLine = raw.split("\n")[0] || "";
  const mode = typeLine.toLowerCase().includes("global") ? "global" as const : "local" as const;

  // 解析实体（从 "实体:" 之后的行）
  const entitySection = raw.split("实体:")[1] || "";
  const entities = entitySection
    .split("\n")
    .map(s => s.trim())
    .filter(s => s.length > 0 && s !== "无");

  return { mode, entities };
}

// ─── 6b: 在图谱中定位实体 → BFS 遍历邻居 ──────────────────────────
async function traverseGraph(
  queryEntities: string[],
  graph: Graph,
  entityIndex: EntityIndex,
  maxDepth: number = 2,
): Promise<{ relatedEntities: Set<string>; relatedChunks: Set<number>; }> {
  const relatedEntities = new Set<string>();
  const visited = new Set<string>();

  // 实体消歧已在构建阶段完成，直接查图
  let matchedEntities = queryEntities.filter(e => graph.has(e));

  if (matchedEntities.length === 0) {
    // 精确匹配失败 → LLM 语义匹配兜底
    console.log(`   ⚠️  精确匹配失败，尝试 LLM 语义匹配...`);
    const allEntities = [...graph.keys()];
    const prompt = `以下是一个知识图谱中的所有实体列表。用户查询中包含以下的实体名，请判断图谱中是否有与之指代同一实体的名称。
只输出匹配到的图谱实体名（一行一个），如果没有匹配输出"无"。

图谱实体列表（部分）:
${allEntities.join("\n")}

用户查询实体:
${queryEntities.join(", ")}

匹配的图谱实体:`;

    const resp = await llm.chat({
      messages: [{ role: "user", content: prompt }],
    });
    const raw = (resp.message.content as string).trim();
    if (raw !== "无") {
      matchedEntities = raw.split("\n").map(s => s.trim()).filter(s => graph.has(s));
    }
  }

  if (matchedEntities.length === 0) {
    console.log(`   ⚠️  查询实体 "${queryEntities.join(", ")}" 未在图谱中找到`);
    return { relatedEntities, relatedChunks: new Set() };
  }
  console.log(`   ✅ 图内匹配到实体: ${matchedEntities.join(", ")}`);

  for (const entity of matchedEntities) {
    // BFS 遍历
    const queue: { entity: string; depth: number }[] = [{ entity, depth: 0 }];
    visited.add(entity);

    while (queue.length > 0) {
      const { entity: current, depth } = queue.shift()!;
      relatedEntities.add(current);

      if (depth >= maxDepth) continue;

      const edges = graph.get(current);
      if (edges) {
        for (const [relation, targets] of edges) {
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

  // 收集相关实体对应的 chunk
  const relatedChunks = new Set<number>();
  for (const entity of relatedEntities) {
    const chunkIds = entityIndex.get(entity);
    if (chunkIds) {
      for (const id of chunkIds) relatedChunks.add(id);
    }
  }

  return { relatedEntities, relatedChunks };
}

// ─── 6c: 聚合上下文 → LLM 生成 ─────────────────────────────────────
async function queryGraphRAG(
  query: string,
  queryEntities: string[],
  graph: Graph,
  entityIndex: EntityIndex,
  communities: Community[],
  chunks: string[],
  claims: Claim[],
): Promise<string> {
  // 实体已在 analyzeQuery 中识别
  console.log(`   🔍 查询实体: ${queryEntities.length > 0 ? queryEntities.join(", ") : "未识别到实体"}`);

  if (queryEntities.length === 0) {
    // 没有实体 → 本地搜索无结果
    return "知识图谱中未找到相关实体信息。";
  }

  // Step 2: 图谱遍历
  const { relatedEntities, relatedChunks } = await traverseGraph(queryEntities, graph, entityIndex);
  console.log(`   🔗 图谱遍历: 找到 ${relatedEntities.size} 个相关实体, ${relatedChunks.size} 个相关片段`);

  // Step 3: 找到相关的社区
  const relatedCommunityIds = new Set<number>();
  for (const community of communities) {
    for (const entity of relatedEntities) {
      if (community.entities.includes(entity)) {
        relatedCommunityIds.add(community.id);
        break;
      }
    }
  }
  const relatedCommunities = communities.filter(c => relatedCommunityIds.has(c.id));
  console.log(`   🏘️  关联 ${relatedCommunities.length} 个社区`);

  // Step 4: 构建上下文
  let contextParts: string[] = [];

  // 4a: 社区摘要
  if (relatedCommunities.length > 0) {
    const summaries = relatedCommunities
      .map(c => `[社区 ${c.id}]\n${c.summary}`)
      .join("\n\n");
    contextParts.push(`【社区知识摘要】\n${summaries}`);
  }

  // 4b: 关联实体关系路径
  const entityRelationPaths: string[] = [];
  for (const entity of relatedEntities) {
    const edges = graph.get(entity);
    if (edges) {
      for (const [relation, targets] of edges) {
        for (const target of targets) {
          if (relatedEntities.has(target)) {
            entityRelationPaths.push(`${entity} → ${relation} → ${target}`);
          }
        }
      }
    }
  }
  if (entityRelationPaths.length > 0) {
    contextParts.push(`【实体关系路径】\n${entityRelationPaths.slice(0, 5).join("\n")}`);
  }

  // 4d: 相关声明（带状态和置信度，上限 10 条）
  const relatedClaims = claims.filter(c =>
    relatedEntities.has(c.subject));
  if (relatedClaims.length > 0) {
    const claimTexts = relatedClaims
      .slice(0, 10)
      .map(c => `[声明] ${c.claim} (${c.status})`)
      .join("\n");
    contextParts.push(`【相关声明】\n${claimTexts}`);
  }

  const context = contextParts.join("\n\n---\n\n");

  // Step 5: LLM 生成
  const finalPrompt = `请基于以下知识图谱信息，准确、简洁地回答用户问题。

${context}

【用户问题】
${query}

注意：
- 结合知识摘要、关系路径和原文来回答问题
- 如果图谱信息不足以回答，请说明"知识图谱中未找到相关信息"`;

  const resp = await llm.chat({
    messages: [{ role: "user", content: finalPrompt }],
  });
  return resp.message.content as string;
}

// ═══════════════════════════════════════════════════════════════════════
//  Global Search: 基于社区摘要回答全局性问题
// ═══════════════════════════════════════════════════════════════════════
async function globalSearch(
  query: string,
  communities: Community[],
  claims: Claim[],
): Promise<string> {
  // 有社区摘要 → 用摘要作为全局上下文
  const summaries = communities.map(c =>
    `【社区 ${c.id}】实体: ${c.entities.slice(0, 10).join(", ")}\n摘要: ${c.summary}`
  ).join("\n\n---\n\n");

  const claimSummary = claims
    .slice(0, 10)
    .map(c => `[声明] ${c.claim} (${c.status})`)
    .join("\n");

  const prompt = `请基于以下多个知识社区的信息，全面、综合地回答用户问题。

注意：
- 综合所有社区的信息，给出一个完整的回答
- 如果不同社区的信息有重叠，整合成统一观点
- 如果信息不足，请明确说明

【知识社区摘要】
${summaries}

【相关声明】
${claimSummary}

【用户问题】
${query}`;

  const resp = await llm.chat({
    messages: [{ role: "user", content: prompt }],
  });
  return resp.message.content as string;
}

// ═══════════════════════════════════════════════════════════════════════
//  执行构建
// ═══════════════════════════════════════════════════════════════════════
console.log("⏳ 正在构建 Graph RAG 索引...");
const { graph, entityIndex, communities, claims } = await buildGraphIndex(chunks);
console.log(`✅ Graph RAG 索引构建完成！`);
console.log(`   📊 ${graph.size} 个实体, ${communities.length} 个社区, ${claims.length} 条声明`);
console.log("");

// ═══════════════════════════════════════════════════════════════════════
//  交互循环
// ═══════════════════════════════════════════════════════════════════════
console.log("\n\n🤖 Graph RAG 已就绪！输入问题开始对话，输入 exit 退出");
console.log("─".repeat(60));
console.log("💡 局部查询（具体实体）:");
console.log("   • 什么是 Chain of Thought？");
console.log("   • CRISPE 框架和 BROKE 框架有什么关系？");
console.log("💡 全局查询（概览汇总）:");
console.log("   • 提示词框架有哪些分类？");
console.log("   • 推理技术主要有哪些？");
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
  let query: string;
  while (true) {
    try {
      query = await prompt();
      if (!query || ["exit","quit"].includes(query.toLowerCase())) {
        console.log("\n👋 再见！");
        rl.close();
        break;
      }

      console.log("⏳ 正在分析问题类型...");
      const { mode, entities } = await analyzeQuery(query);
      console.log(`   📋 问题类型: ${mode === "global" ? "🌐 全局性" : "🎯 局部性"}`);
      if (entities.length > 0) console.log(`   🔍 识别实体: ${entities.join(", ")}`);

      let answer: string;
      if (mode === "global") {
        console.log("📊 正在聚合社区知识...");
        answer = await globalSearch(query, communities, claims);
      } else {
        console.log("🔍 正在查询知识图谱...\n");
        answer = await queryGraphRAG(query, entities, graph, entityIndex, communities, chunks, claims);
      }

      console.log(`\n🤖 Agent [${mode === "global" ? "全局搜索" : "局部搜索"}]: ${answer}`);
      console.log("");

    } catch (err) {
      console.error("❌ 出错:", err);
    }
  }
}

chatLoop();