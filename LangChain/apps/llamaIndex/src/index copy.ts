import path from "path";
import { fileURLToPath } from "url";
import { SimpleDirectoryReader } from "@llamaindex/readers/directory";
import { Document } from "@llamaindex/core/schema";
import { VectorStoreIndex } from "llamaindex";
import { OpenAIEmbedding } from "@llamaindex/openai";
import { Settings } from "@llamaindex/core/global";
import llm from "./llm.ts";
import SemanticSplitter from "./utils/SemanticSplitter.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FILE_DIR = path.resolve(__dirname, "../files");

const reader = new SimpleDirectoryReader();
// 使用 SimpleDirectoryReader 加载目录下的所有文档（含 PDF）
const documents = await reader.loadData({
  directoryPath: FILE_DIR,
});
console.log(`✅ 共加载 ${documents.length} 个文档`);

// 1. 将所有页合并为一个完整的 Document
const fullText = documents.map((d: Document) => d.text).join("\n\n");
const mergedDoc = new Document({ text: fullText, id_: "merged-pdf" });
console.log(`📊 合并后总字符数: ${fullText.length}}`);

// 2. 语义切分
const semanticSplitter = new SemanticSplitter();
const nodes = await semanticSplitter.splitDocuments([mergedDoc]);
console.log(`\n✅ 切分为 ${nodes.length} 个 chunk`);


// 3. 构建索引
Settings.embedModel = new OpenAIEmbedding({
  model: "text-embedding-v3", // 阿里云通义千问 embedding 模型
});
Settings.llm = llm;

const index = await VectorStoreIndex.init({ nodes });
console.log(`\n✅ 构建向量 ${index} `);

// 4.创建查询引擎
const queryEngine = index.asQueryEngine({
  similarityTopK: 3, // 检索最相似的 3 个 chunk
});

// 5.提问
const response = await queryEngine.query({
  query: "CoT是什么",
});
console.log("🤖 回答:", response.toString());

// 查看检索到了哪些 chunk
console.log("\n📎 参考来源:");
response.sourceNodes?.forEach((node, i) => {
  console.log(`  [${i + 1}] ${node.node.text.slice(0, 80)}...`);
});
