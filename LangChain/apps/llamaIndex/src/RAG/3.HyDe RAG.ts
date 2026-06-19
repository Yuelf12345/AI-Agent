import path from "path";
import fs from "fs";
import * as readline from "readline";

// ─── LlamaIndex 核心模块 ────────────────────────────────────────────
import { SimpleDirectoryReader } from "@llamaindex/readers/directory";
import { VectorStoreIndex, storageContextFromDefaults, } from "llamaindex";
import { Document, TextNode } from "@llamaindex/core/schema";
import { OpenAIEmbedding } from '@llamaindex/openai'

// ─── 本地模块 ────────────────────────────────────────────────────────
import { initGlobalSettings } from "../config.ts";
import llm, { tokenTracker } from '../llm.ts'
import { FixedSizeChunk, SemanticChunk, RecursiveChunk, LLMChunk, SentenceSplitter, TokenTextSplitter, SentenceWindowNodeParser } from "../check/index.ts";
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

//  Step 4: 构建 Retriever — 只检索、不生成（HyDE 需要手动控制检索与生成）

console.log("\n\n🤖 HyDe RAG 已就绪！输入问题开始对话，输入 exit 退出");
console.log("─".repeat(60));
console.log("💡 试试这些问题:");
console.log("   • 什么是CRISPE框架");
console.log("   • Prompt Engineering 有哪些框架");
console.log("─".repeat(60));

const retriever = index.asRetriever({ similarityTopK: 5 });

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
            // ─── Phase 1: LLM 生成假设性回答 ─────────────────────────
            console.log("📝 正在生成假设性回答...");
            const hydePrompt = `请针对以下问题，生成一段详细的假设性回答。注意：你不需要保证事实完全准确，只需写出一个结构完整、信息密集、像知识库文档一样的回答。
        问题: ${query}
假设性回答: `;
            const hydeResp = await llm.chat({
                messages: [{ role: "user", content: hydePrompt }],
            });
            const hydeAnswer = hydeResp.message.content as string;
            console.log(`   ✅ 假设性回答生成完成 (${hydeAnswer.length} 字)`);
            console.log(`🤔 假设性回答: ${hydeAnswer}`);

            // ─── Phase 2: 用假设性查询进行检索 ─────────────────────────
            console.log("🔍 正在用假设性回答检索知识库...");
            const retrievedNodes = await retriever.retrieve(hydeAnswer);
            console.log(`📎 找到 ${retrievedNodes.length} 个相关 chunk`);

            // ─── Phase 3: 构造最终问题并调用 LLM ──────────────────────
            console.log("🧠 正在构造最终回答...");
            // ─── Phase 3: 构建完整 prompt ─────────────────────────────
            const context = retrievedNodes
                .map((n, i) => `[文档片段 ${i + 1}]\n${n.node.text}`)
                .join("\n\n");

            const finalPrompt = `请基于以下参考资料，准确、简洁地回答用户问题。
【参考资料】
${context}
【用户问题】
${query}
注意：请基于参考资料回答。如果资料中无相关信息，请明确说明"未找到相关内容"。`;
            // ─── Phase 4: LLM 生成最终回答 ───────────────────────────
            const finalResp = await llm.chat({
                messages: [{ role: "user", content: finalPrompt }],
            });
            console.log(`\n🤖 Agent: ${finalResp.message.content}`);
            console.log("");
        } catch (err) {
            console.error("❌ 出错:", err);
        }
    }
}

chatLoop();