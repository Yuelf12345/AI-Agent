import path from "path";
import fs from "fs";
import { SentenceWindowNodeParser, SentenceSplitter } from "@llamaindex/core/node-parser";
import { Document, TextNode } from "@llamaindex/core/schema";
import { FILE_DIR, STORAGE_AGENTIC_DIR, CACHE_AGENTIC, CACHE_EXISTING_INDEX } from "./constants.ts";

const cacheFn = (nodes: TextNode[]): void => {
    const cacheDir = path.dirname(CACHE_AGENTIC);
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(
        CACHE_AGENTIC,
        JSON.stringify(nodes.map((n) => ({ text: n.text, id_: n.id_, metadata: n.metadata })).sort()),
        "utf-8",
    );
    console.log(`💾 切分结果已缓存到 ${CACHE_AGENTIC}`);
}

/**
 * 按标题拆成独立段落，配上祖先路径，再用 SentenceSplitter 切分。
 * 
 * 处理流程：
 *   原始文本 → 按标题拆成多个"段" → 每段独立切分 → 每段只加一次标签
 *   ───────    ───────────────    ────────────   ─────────────────
 *   全文       [{path, content}]   [[chunk],...]  【path】chunk
 */
export const sentenceChunk = async (documents: Document[]) => {
    const parser = new SentenceSplitter({
        chunkSize: 512,
        chunkOverlap: 50,
        separator: " ",
        paragraphSeparator: "\n\n",
        secondaryChunkingRegex: "[^,.;。？！]+[,.;。？！]?",
        extraAbbreviations: [],
    });
    const allNodes: TextNode[] = [];

    for (const doc of documents) {
        // Step 1: 按标题拆成独立段落
        const sections = splitByHeadings(doc.text);

        // Step 2: 每段独立切分，每段只加一次标签
        for (const { path, content } of sections) {
            if (!content.trim()) continue;
            const sectionDoc = new Document({ text: content });
            const nodes = await parser.getNodesFromDocuments([sectionDoc]);
            for (const node of nodes) {
                node.text = `【${path}】\n${node.text}`;
                allNodes.push(node);
            }
        }
    }

    console.log(`📊 句子级切分: ${allNodes.length} 个 chunk`);
    cacheFn(allNodes);
    return allNodes;
};

/** 按标题拆成独立段落 */
function splitByHeadings(text: string): { path: string; content: string }[] {
    const lines = text.split("\n");
    const sections: { path: string; content: string }[] = [];
    const headingStack: { level: number; title: string }[] = [];
    let currentLines: string[] = [];

    // 文档开头的无标题段
    let hasHeading = false;

    for (const line of lines) {
        const m = line.match(/^(#{1,6})\s+(.*)/);
        if (m) {
            hasHeading = true;
            // 保存上一段
            if (headingStack.length > 0) {
                const path = headingStack.map(h => h.title).join(" > ");
                sections.push({ path, content: currentLines.join("\n") });
            }
            currentLines = [];

            // 更新标题栈
            const level = m[1]!.length;
            const title = m[2]!.trim();
            headingStack[level - 1] = { level, title };
            headingStack.length = level;
        } else {
            currentLines.push(line);
        }
    }

    // 最后一段
    if (hasHeading && headingStack.length > 0) {
        const path = headingStack.map(h => h.title).join(" > ");
        sections.push({ path, content: currentLines.join("\n") });
    } else if (!hasHeading) {
        // 全文无标题 → 整文档作为一个段
        sections.push({ path: "", content: currentLines.join("\n") });
    }

    // 过滤空段，过滤标题行
    return sections
        .map(s => ({
            path: s.path,
            content: s.content
                .split("\n")
                .filter(l => l.trim() && !l.match(/^(#{1,6})\s+(.*)/))
                .join("\n")
                .trim(),
        }))
        .filter(s => s.content.length > 0);
}

// 以下函数保留供其他模块调用

/** SentenceWindow 切分（带上下文窗口） */
export const windowChunk = async (documents: Document[]) => {
    const parser = new SentenceWindowNodeParser({ windowSize: 3 });
    const nodes = parser.buildWindowNodesFromDocuments(documents);
    console.log(`📊 切分出 ${nodes.length} 个 chunk`);
    cacheFn(nodes)
    return nodes;
}

/** 递归字符级切分 */
export const recursiveChunk = async (documents: Document[], chunkSize = 512, overlap = 50) => {
    const separators = ["\n\n", "\n", "。", ".", " ", ""];
    const nodes: TextNode[] = [];

    function split(text: string, sepIdx: number): string[] {
        if (text.length <= chunkSize || sepIdx >= separators.length) return [text];
        const sep = separators[sepIdx]!;
        const parts = text.split(sep);
        if (parts.length === 1) return split(text, sepIdx + 1);
        const subParts = parts.flatMap(p => split(p, sepIdx + 1));
        const chunks: string[] = [];
        let current = "";
        for (const part of subParts) {
            if (current.length + part.length + sep.length > chunkSize && current) {
                chunks.push(current.trim());
                const overlapText = overlap > 0 && current.length > overlap
                    ? current.slice(-overlap) + sep
                    : "";
                current = overlapText + part;
            } else {
                current += (current ? sep : "") + part;
            }
        }
        if (current.trim()) chunks.push(current.trim());
        return chunks;
    }

    for (const doc of documents) {
        for (const text of split(doc.text, 0)) {
            nodes.push(new TextNode({ text }));
        }
    }
    console.log(`📊 递归字符切分: ${nodes.length} 个 chunk`);
    return nodes;
};