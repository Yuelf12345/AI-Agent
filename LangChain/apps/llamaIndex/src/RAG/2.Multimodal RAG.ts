/**
 * RAG Crash Course - Part 2: Multimodal RAG（多模态 RAG）
 *
 *
 * ─── Multimodal RAG 的三种实现方案 ───
 *
 *  方案一：统一多模态 Embedding（Unified Multimodal Embedding）
 *    所有模态（文本/图片/音频）统一 Embedding 到同一向量空间
 *    需要 CLIP 等多模态 Embedding 模型
 *    ✅ 原生多模态检索  ❌ 依赖多模态 Embedding 模型
 *
 *  方案二：图片转文本 + 文本 RAG（Image-to-Text + Text RAG）← 本文件实现
 *    用多模态 LLM（如 qwen-vl-plus / GPT-4V）将图片描述为文本
 *    图片的文本描述和文档文本统一走文本 RAG 流程
 *    ✅ 实现简单，复用现有文本 RAG  ❌ 丢失部分视觉信息
 *
 *  方案三：多模态 LLM 直接处理（Multimodal LLM Direct Processing）
 *    检索到原始多模态内容后，直接传给多模态 LLM 处理
 *    ✅ 保留完整视觉信息  ❌ 需要多模态 LLM + 多模态存储
 *
 * ─── 本实现采用方案二：Image-to-Text + Text RAG ───
 *
 *  工作流程：
 *  Step 1: 加载文本文件（PDF 等）
 *  Step 2: 加载图片文件 → 用 Vision LLM 生成文本描述（alt text）
 *  Step 3: 合并文本文档 + 图片描述文档
 *  Step 4: 统一切分 → 生成 Embedding → 构建向量索引
 *  Step 5: 文本查询 → 向量检索 → LLM 生成回答
 *
 */

import path from "path";
import fs from "fs";

// ─── LlamaIndex 核心模块 ────────────────────────────────────────────
import { SimpleDirectoryReader } from "@llamaindex/readers/directory";
import { Document, TextNode, ImageNode, ImageDocument } from "@llamaindex/core/schema";
import {
  VectorStoreIndex,
  storageContextFromDefaults,
} from "llamaindex";
import { OpenAIEmbedding, OpenAI } from "@llamaindex/openai";
import { Settings } from "@llamaindex/core/global";

// ─── 本地模块 ────────────────────────────────────────────────────────
import llm from "../llm.ts";
import {
  LLMChunk,
} from "../check/index.ts";
import {
  FILE_DIR,
  IMAGE_DIR,
  STORAGE_MULTIMODAL_DIR,
  CACHE_MULTIMODAL,
  CACHE_IMAGE_DESC,
  CACHE_DIR,
} from "../constants.ts";

// ═══════════════════════════════════════════════════════════════════════
//  Step 0: 全局配置 — 设置 Embedding 模型和 LLM
// ═══════════════════════════════════════════════════════════════════════
function configureSettings() {
  Settings.embedModel = new OpenAIEmbedding({
    model: "text-embedding-v3", // 阿里云通义千问 embedding 模型
  });
  Settings.llm = llm;
  console.log("⚙️  全局配置完成 — Embedding: text-embedding-v3, LLM: 已就绪");
}

configureSettings();

// ═══════════════════════════════════════════════════════════════════════
//  核心模块：Vision LLM — 将图片描述为文本
// ═══════════════════════════════════════════════════════════════════════

/**
 * 创建视觉语言模型（Vision LLM）
 * 使用阿里云通义千问视觉模型 qwen-vl-plus
 * 该模型支持图片输入，可以理解图片内容并生成文本描述
 */
const visionLLM = new OpenAI({
  model: "qwen-vl-plus", // 阿里云通义千问视觉模型
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

/**
 * 用 Vision LLM 为图片生成文本描述（alt text）
 *
 * 这是 Multimodal RAG 方案二的核心步骤：
 *   将图片的视觉信息转换为文本表示
 *   使图片可以被文本检索系统索引和检索
 *
 * @param imagePath - 图片文件的绝对路径
 * @returns 图片的文本描述
 */
async function describeImage(imagePath: string): Promise<string> {
  // 将图片转为 base64 编码，以便通过 OpenAI 兼容 API 传递
  const imageBuffer = fs.readFileSync(imagePath);
  const base64Image = imageBuffer.toString("base64");
  const ext = path.extname(imagePath).slice(1).toLowerCase();
  const mimeType = ext === "png" ? "image/png"
    : ext === "jpg" || ext === "jpeg" ? "image/jpeg"
    : ext === "gif" ? "image/gif"
    : ext === "webp" ? "image/webp"
    : "image/png";

  const dataUrl = `data:${mimeType};base64,${base64Image}`;

  // 调用视觉模型，生成结构化描述
  const response = await visionLLM.chat({
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: dataUrl },
          },
          {
            type: "text",
            text: `请详细描述这张图片的内容。要求：1. 如果是图表/流程图，描述其结构和关键信息2. 如果是截图/界面，描述界面元素和布局3. 如果是照片，描述场景和关键对象4. 尽可能保留图片中的文字内容和关键数据5. 输出一段完整的中文描述文本`,
          },
        ],
      },
    ],
  });

  const description = response.message.content;
  if (typeof description !== "string") {
    return JSON.stringify(description);
  }
  return description;
}

// ═══════════════════════════════════════════════════════════════════════
//  Step 1-2: 加载文本 + 加载图片并生成描述
// ═══════════════════════════════════════════════════════════════════════

/**
 * 加载所有文本文档
 */
async function loadTextDocuments(): Promise<Document[]> {
  const reader = new SimpleDirectoryReader();
  const documents = await reader.loadData({ directoryPath: FILE_DIR });
  // 过滤掉 ImageDocument（图片文件由 ImageReader 读取为 ImageDocument）
  // PDFReader 返回的是普通 Document，不会被误过滤
  const textDocs = documents.filter(
    (d) => !(d instanceof ImageDocument),
  );
  console.log(`📄 加载文本文档: ${textDocs.length} 个`);
  console.log(`   🖼️  跳过 ${documents.length - textDocs.length} 个图片`);
  return textDocs;
}

/**
 * 加载所有图片文件，并用 Vision LLM 生成文本描述
 * 结果会被缓存，避免重复调用 LLM
 */
async function loadImageDocuments(): Promise<Document[]> {
  // 检查图片目录是否存在
  if (!fs.existsSync(IMAGE_DIR)) {
    console.log("📁 图片目录不存在，跳过图片加载");
    return [];
  }

  // 获取所有图片文件
  const imageFiles = fs.readdirSync(IMAGE_DIR)
    .filter((f) => /\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(f))
    .map((f) => path.resolve(IMAGE_DIR, f));

  if (imageFiles.length === 0) {
    console.log("📁 没有找到图片文件");
    return [];
  }

  console.log(`🖼️  发现 ${imageFiles.length} 张图片，开始生成描述...`);

  // 检查是否有缓存的图片描述
  const cachedDescriptions: Record<string, string> = {};
  if (fs.existsSync(CACHE_IMAGE_DESC)) {
    const cached = JSON.parse(fs.readFileSync(CACHE_IMAGE_DESC, "utf-8"));
    Object.assign(cachedDescriptions, cached);
    console.log(`📂 从缓存加载 ${Object.keys(cachedDescriptions).length} 个图片描述`);
  }

  // 对每张图片生成描述（有缓存则跳过）
  const imageDocuments: Document[] = [];
  const newDescriptions: Record<string, string> = { ...cachedDescriptions };

  for (const imagePath of imageFiles) {
    const filename = path.basename(imagePath);

    if (cachedDescriptions[filename]) {
      // 使用缓存
      console.log(`  ⏩ ${filename} — 使用缓存描述`);
      imageDocuments.push(
        new Document({
          text: cachedDescriptions[filename],
          metadata: {
            type: "image_description",
            source: filename,
            original_path: imagePath,
          },
        })
      );
    } else {
      // 调用 Vision LLM 生成描述
      console.log(`  🔄 ${filename} — 正在生成描述...`);
      try {
        const description = await describeImage(imagePath);
        newDescriptions[filename] = description;
        console.log(`  ✅ ${filename} — 描述生成完成 (${description.length} 字)`);
        imageDocuments.push(
          new Document({
            text: description,
            metadata: {
              type: "image_description",
              source: filename,
              original_path: imagePath,
            },
          })
        );
      } catch (err) {
        console.error(`  ❌ ${filename} — 描述生成失败:`, err);
      }
    }
  }

  // 保存新的描述缓存
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(CACHE_IMAGE_DESC, JSON.stringify(newDescriptions, null, 2), "utf-8");
  console.log(`💾 图片描述缓存已更新: ${CACHE_IMAGE_DESC}`);

  return imageDocuments;
}

// ═══════════════════════════════════════════════════════════════════════
//  Step 3-4: 合并文档 + 切分 + 向量化 + 建索引
// ═══════════════════════════════════════════════════════════════════════

// 确保多模态存储目录存在
if (!fs.existsSync(STORAGE_MULTIMODAL_DIR)) fs.mkdirSync(STORAGE_MULTIMODAL_DIR, { recursive: true });

const storageContext = await storageContextFromDefaults({ persistDir: STORAGE_MULTIMODAL_DIR });

let index: VectorStoreIndex;
const hasExistingIndex = fs.existsSync(path.join(STORAGE_MULTIMODAL_DIR, "docstore.json"));

if (hasExistingIndex) {
  console.log("\n📂 检测到已有持久化多模态索引，直接加载...");
  index = await VectorStoreIndex.init({ storageContext });
  console.log(`✅ 多模态索引加载完成`);
} else {
  // 加载文本和图片
  const textDocuments = await loadTextDocuments();
  const imageDocuments = await loadImageDocuments();
  const allDocuments = [...textDocuments, ...imageDocuments];

  console.log(`\n📊 文档统计:`);
  console.log(`   📄 文本文档: ${textDocuments.length} 个`);
  console.log(`   🖼️  图片描述文档: ${imageDocuments.length} 个`);
  console.log(`   📦 总计: ${allDocuments.length} 个`);

  // 切分
  let nodes: TextNode[];
  const hasCachedNodes = fs.existsSync(CACHE_MULTIMODAL);

  if (hasCachedNodes) {
    console.log("\n📂 检测到切分缓存，直接加载...");
    const cached = JSON.parse(fs.readFileSync(CACHE_MULTIMODAL, "utf-8"));
    nodes = cached.map(
      (item: { text: string; id_: string; metadata?: Record<string, string> }) =>
        new TextNode({ text: item.text, id_: item.id_, metadata: item.metadata }),
    );
    console.log(`📊 从缓存加载 ${nodes.length} 个 chunk`);
  } else {
    console.log("\n⏳ 正在切分文档...");
    // 合并所有文本
    const textNodes: TextNode[] = [];

    for (const doc of allDocuments) {
      const text = doc.text;
      if (!text || text.trim().length === 0) continue;

      const splitter = new LLMChunk({ chunkSize: 512, chunkOverlap: 20 });
      const chunks = await splitter.splitText(text);
      const docType = doc.metadata?.type === "image_description" ? "image" : "text";
      const source = doc.metadata?.source || doc.metadata?.file_name || "unknown";

      for (let i = 0; i < chunks.length; i++) {
        textNodes.push(
          new TextNode({
            text: chunks[i],
            id_: `${docType}-${source}-chunk-${i}`,
            metadata: {
              ...doc.metadata,
              chunk_index: String(i),
            },
          })
        );
      }
    }

    nodes = textNodes;
    console.log(`📊 切分出 ${nodes.length} 个 chunk`);

    // 统计 chunk 类型
    const textChunks = nodes.filter((n) => n.metadata?.type !== "image_description");
    const imageChunks = nodes.filter((n) => n.metadata?.type === "image_description");
    console.log(`   📄 文本 chunk: ${textChunks.length} 个`);
    console.log(`   🖼️  图片描述 chunk: ${imageChunks.length} 个`);

    // 缓存切分结果
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(
      CACHE_MULTIMODAL,
      JSON.stringify(
        nodes.map((n) => ({ text: n.text, id_: n.id_, metadata: n.metadata }))
      ),
      "utf-8",
    );
    console.log(`💾 切分结果已缓存到 ${CACHE_MULTIMODAL}`);
  }

  // 向量化 & 建索引
  console.log("\n⏳ 正在生成 embedding 并构建多模态向量索引...");
  index = await VectorStoreIndex.init({ nodes, storageContext });
  console.log(`✅ 多模态向量数据库构建完成`);
  console.log(`   📦 节点数: ${nodes.length}`);
  console.log(`   💾 持久化路径: ${STORAGE_MULTIMODAL_DIR}`);
}

// ═══════════════════════════════════════════════════════════════════════
//  Step 5: 查询 — 多模态 RAG
// ═══════════════════════════════════════════════════════════════════════

const queryEngine = index.asQueryEngine({ similarityTopK: 3 });

// ─── 演示查询 ────────────────────────────────────────────────────────

// console.log("\n" + "═".repeat(60));
// console.log("🖼️  Multimodal RAG 演示");
// console.log("═".repeat(60));

// // 查询1: 文本相关问题（与 Naive RAG 相同）
// const query1 = "什么是CRISPE框架";
// console.log(`\n🔍 查询1 (文本): "${query1}"`);
// console.log("⏳ 正在检索并生成回答...\n");

// const response1 = await queryEngine.query({ query: query1 });
// console.log("─── 回答 ───");
// console.log(response1.message.content);

// const sourceNodes1 = response1.sourceNodes ?? [];
// console.log(`\n📎 引用 ${sourceNodes1.length} 个相关 chunk:`);
// sourceNodes1.forEach((nodeWithScore, i) => {
//   const score = nodeWithScore.score ?? 0;
//   const node = nodeWithScore.node as TextNode;
//   const type = node.metadata?.type === "image_description" ? "🖼️ 图片" : "📄 文本";
//   const source = node.metadata?.source || "unknown";
//   console.log(`  [${i}] ${type} | 相似度: ${(score * 100).toFixed(1)}% | 来源: ${source}`);
//   console.log(`      ${node.text.slice(0, 80)}...`);
// });

// // 查询2: 图片相关问题（这是 Multimodal RAG 的核心优势）
// const query2 = "图片中展示了什么内容";
// console.log(`\n\n🔍 查询2 (图片): "${query2}"`);
// console.log("⏳ 正在检索并生成回答...\n");

// const response2 = await queryEngine.query({ query: query2 });
// console.log("─── 回答 ───");
// console.log(response2.message.content);

// const sourceNodes2 = response2.sourceNodes ?? [];
// console.log(`\n📎 引用 ${sourceNodes2.length} 个相关 chunk:`);
// sourceNodes2.forEach((nodeWithScore, i) => {
//   const score = nodeWithScore.score ?? 0;
//   const node = nodeWithScore.node as TextNode;
//   const type = node.metadata?.type === "image_description" ? "🖼️ 图片" : "📄 文本";
//   const source = node.metadata?.source || "unknown";
//   console.log(`  [${i}] ${type} | 相似度: ${(score * 100).toFixed(1)}% | 来源: ${source}`);
//   console.log(`      ${node.text.slice(0, 80)}...`);
// });

// ═══════════════════════════════════════════════════════════════════════
//  交互式 REPL
// ═══════════════════════════════════════════════════════════════════════
import * as readline from "readline";

console.log("\n\n🤖 Multimodal RAG 已就绪！输入问题开始对话，输入 exit 退出");
console.log("─".repeat(60));
console.log("💡 试试这些问题:");
console.log("   • 什么是CRISPE框架      (文本问题 → 检索文档)");
console.log("   • 图片中有什么内容       (图片问题 → 检索图片描述)");
console.log("   • 提示词工程有哪些框架   (综合问题 → 混合检索)");
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
      break;
    }

    console.log("⏳ 思考中...\n");
    try {
      const response = await queryEngine.query({ query });
      console.log(`\n🤖 回答: ${response.message.content}`);

      // 展示来源
      const sources = response.sourceNodes ?? [];
      if (sources.length > 0) {
        console.log("\n📎 来源:");
        sources.forEach((s, i) => {
          const type = s.node.metadata?.type === "image_description" ? "🖼️" : "📄";
          const source = s.node.metadata?.source || s.node.metadata?.file_name || "unknown";
          const score = ((s.score ?? 0) * 100).toFixed(1);
          console.log(`  [${i}] ${type} ${source} (${score}%)`);
        });
      }
      console.log("");
    } catch (err) {
      console.error("❌ 出错:", err);
    }
  }
}

chatLoop();
