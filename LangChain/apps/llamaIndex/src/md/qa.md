📥 9.1 数据加载相关问题
Q: 如何处理大文件或大量文件？
A: 有几种策略：

使用recursive=True递归读取子目录
分批加载文件，避免一次性加载所有文件到内存
使用流式处理（Streaming），边读边处理
对于超大文件，考虑先预处理，提取关键部分

python 体验AI代码助手 代码解读复制代码# 示例：分批加载
files = ["file1.pdf", "file2.pdf", "file3.pdf"]
for file in files:
documents = SimpleDirectoryReader(input_files=[file]).load_data() # 处理 documents

Q: PDF 文件解析效果不好怎么办？
A: 可以尝试以下方法：

使用LlamaParse替代默认的 PDFReader（效果更好但需要 API key）
对于扫描版 PDF，先使用 OCR 工具提取文字
检查 PDF 是否包含可提取的文本层（非纯图片）

Q: 如何处理图像、视频、音频文件中的文字？
A: 需要使用专门的 Data Connectors：

图像 OCR：使用ImageReader或集成 OCR 服务
视频字幕：提取视频中的字幕文件
音频转文字：使用语音识别服务（如 Whisper）

✂️ 9.2 文本切分相关问题
Q: Chunk size 应该设置多大？
A: 需要根据以下因素综合考虑：

LLM 上下文窗口：确保 chunk + 查询 + 回答不超过模型限制
文档类型：代码文档建议 512-1024，自然语言建议 256-512
检索精度：chunk 太小可能丢失上下文，太大可能包含无关信息
经验值：大多数场景下，512-1024 tokens 是比较好的选择

Q: Chunk overlap 设置多少合适？
A: 一般建议：

设置为 chunk_size 的 10-20%（如 chunk_size=512，overlap=50-100）
对于长文档或需要保持上下文连续性的场景，可以适当增大
注意：overlap 过大会增加存储和计算成本

Q: 为什么切分后的结果不理想？
A: 可能的原因和解决方案：

问题：在句子中间切断 →解决：使用SentenceSplitter而非TokenTextSplitter
问题：代码块被破坏 →解决：使用CodeSplitter
问题：语义不完整 →解决：使用SemanticSplitterNodeParser
问题：结构化文档解析错误 →解决：使用对应的NodeParser（如HTMLNodeParser、MarkdownNodeParser）

🔍 9.3 检索相关问题
Q: 检索效果不好，返回的结果不相关怎么办？
A: 可以尝试以下优化方法：

调整 chunk size：太大或太小都可能影响效果
尝试不同的 TextSplitter：SentenceSplitter通常比TokenTextSplitter效果更好
使用 Rerank：使用LLMRerank对检索结果重新排序
检查 Embedding 模型：确保使用的模型适合你的数据（如中文数据使用中文模型）
使用混合检索：结合向量检索和关键字检索（如 RAG-Fusion）
调整 similarity_top_k：适当增大返回结果数量，然后通过 Rerank 筛选

Q: 检索速度太慢怎么办？
A: 优化建议：

使用持久化向量数据库（如 Qdrant）而非内存存储
减少similarity_top_k的值
使用异步检索（use_async=True）
考虑使用更快的 Embedding 模型（如本地部署的轻量模型）
对于大规模数据，考虑使用专业的向量数据库服务（如 Pinecone）

Q: 向量检索和关键字检索应该选哪个？
A: 选择建议：

向量检索：适合语义搜索、理解同义词、多语言场景
关键字检索（BM25）：适合精确匹配、术语查询、代码搜索
混合检索：结合两者优势，通常效果最好（推荐）

🇨🇳 9.4 中文文档处理问题
Q: 如何处理中文文档？
A: 关键点：

使用支持中文的 Embedding 模型：
使用适合中文的 TextSplitter：
确保 LLM 支持中文：

python 体验AI代码助手 代码解读复制代码# 中文场景推荐配置
from llama_index.embeddings.dashscope import DashScopeEmbedding
from llama_index.core.node_parser import SentenceSplitter

Settings.embed_model = DashScopeEmbedding(
model_name=DashScopeTextEmbeddingModels.TEXT_EMBEDDING_V3
)
Settings.transformations = [SentenceSplitter(chunk_size=512, chunk_overlap=100)]

⚡ 9.5 性能和成本问题
Q: 如何降低 API 调用成本？
A: 优化策略：

使用开源模型：本地部署开源 LLM 和 Embedding 模型（如 Llama、Qwen、BGE）
缓存机制：对相同查询结果进行缓存
减少 Rerank 调用：只在必要时使用 LLMRerank（会增加成本）
优化 chunk 数量：减少不必要的 chunk，降低 Embedding 调用次数
选择合适的模型：简单任务使用轻量模型，复杂任务再用强模型

Q: 内存占用太大怎么办？
A: 解决方案：

使用持久化存储（Qdrant、Chroma 等）而非内存存储
分批处理文档，不要一次性加载所有数据
使用流式处理，边处理边释放内存
考虑使用更轻量的 Embedding 模型

Q: 索引构建速度慢怎么办？
A: 优化方法：

使用异步处理（use_async=True）
批量处理文档而非逐个处理
使用更快的 Embedding 模型
对于大规模数据，考虑分布式处理

🏭 9.6 部署和生产环境问题
Q: 如何持久化索引以便后续复用？
A: 两种方式：

使用向量数据库（推荐）：

python 体验AI代码助手 代码解读复制代码# 使用 Qdrant 等向量数据库，数据自动持久化
client = QdrantClient(path="./qdrant_db")

使用本地文件存储：

python 体验AI代码助手 代码解读复制代码# 保存索引到本地
index.storage_context.persist(persist_dir="./doc_emb")

# 后续加载

from llama_index.core import load_index_from_storage
storage_context = StorageContext.from_defaults(persist_dir="./doc_emb")
index = load_index_from_storage(storage_context)

Q: 如何更新已构建的索引？
A: 更新策略：

增量更新：使用index.insert()添加新文档
全量重建：删除旧索引，重新构建（适合文档经常变化的情况）
版本管理：为不同版本的索引创建不同的 collection

Q: 生产环境应该注意什么？
A: 关键点：

使用持久化存储：避免数据丢失
错误处理：添加异常捕获和重试机制
监控和日志：记录 API 调用、检索性能等
限流和缓存：避免 API 调用过频
安全性：保护 API key，避免敏感数据泄露
性能优化：使用异步、批量处理等技术

作者：星浩AI
链接：https://juejin.cn/post/7594383365417664558
来源：稀土掘金
著作权归作者所有。商业转载请联系作者获得授权，非商业转载请注明出处。
