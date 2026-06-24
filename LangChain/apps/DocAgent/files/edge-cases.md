# DocAgent 边界测试文档

## 1. 长段落 - 测试 chunk 边界割裂

这是一个超长段落，用于测试 SentenceSplitter 在长文本中的切片边界。技术创新正在以前所未有的速度重塑我们的世界。从人工智能到量子计算，从生物技术到太空探索，每一个领域都在经历着深刻的变革。这些技术不仅改变了我们的生活方式，也在重新定义着企业竞争格局和全球经济结构。

在人工智能领域，大语言模型的发展尤为引人注目。从最初的 GPT 系列到如今的 GPT-4，再到各类开源模型，模型能力在快速提升。这些模型不仅在自然语言理解方面表现出色，在代码生成、数学推理、多模态理解等领域也展现出了令人惊叹的能力。然而，随着模型规模的不断增大，训练和推理成本也在急剧上升，这促使研究人员探索更加高效的模型架构和训练方法。

深度学习技术的进步也推动了计算机视觉领域的革命。从图像分类到目标检测，从语义分割到图像生成，视觉模型的能力已经超越了人类在某些特定任务上的表现。自动驾驶、医学影像分析、工业质检等应用场景正在大规模落地。特别是 BEV（鸟瞰视角）感知技术和端到端自动驾驶方案的提出，为解决复杂驾驶场景提供了新的思路。

自然语言处理领域同样取得了突破性进展。机器翻译、文本摘要、情感分析、信息抽取等传统任务已经达到了很高的水平。更重要的是，以 ChatGPT 为代表的对话式 AI 正在改变人机交互的方式。从简单的问答系统到复杂的多轮对话，从单一的文本交互到多模态的融合交互，AI 系统正在变得越来越像人类助手。

## 2. 中英文混合段落 - 测试多语言切片

The rapid development of artificial intelligence has brought transformative changes to various industries. 特别是在医疗健康领域，AI 技术正在帮助医生更准确地诊断疾病。Machine learning algorithms can analyze medical images with accuracy comparable to or exceeding human experts. 同时，自然语言处理技术也在辅助医生阅读病历和医学文献方面发挥着重要作用。

One of the key challenges in AI research is the issue of model interpretability. 虽然深度学习模型在很多任务上表现出色，但它们的决策过程往往难以理解，这在医疗、金融等高风险领域尤其令人担忧。Researchers are developing various techniques, including attention visualization, feature attribution, and counterfactual explanations, to address this challenge.

## 3. 列表和结构化内容 - 测试结构保留

### 3.1 AI 技术栈层级

- **基础设施层**：GPU/TPU 集群、分布式训练框架、模型部署平台
- **模型层**：基础模型（GPT、Claude、LLaMA）、领域微调模型
- **应用层**：对话系统、代码助手、文档分析、客服自动化
- **工具层**：LangChain、LlamaIndex、向量数据库、Agent 框架

### 3.2 RAG 架构演进

1. **Naive RAG**: 向量检索 + 直接拼接，最基础的实现
2. **Advanced RAG**: 引入查询改写、重排序、HyDE 等技术
3. **Modular RAG**: 可插拔的组件化架构，灵活组合各模块
4. **Agentic RAG**: 引入 Agent 思维，动态决策检索策略

### 3.3 代码块测试

```typescript
// 这是一个代码块，用于测试切片器对代码的处理
async function rerankResults(
  results: RetrievedSource[],
  originalQuery: string
): Promise<RetrievedSource[]> {
  if (results.length <= 1 || results.length > RERANK_THRESHOLD) {
    return results;
  }

  const rerankPrompt = `你是一个文档相关性评估专家。
问题是：${originalQuery}

请评估以下每个片段与问题的相关性，按 0-100 评分。
以 JSON 数组格式返回，不要包含其他内容。`;

  const resp = await llm.chat({
    messages: [{ role: "user", content: rerankPrompt }],
  });
  // ...
}
```

## 4. 紧密关联句子 - 测试边界上下文丢失

### 4.1 事件因果链

2024 年初，某科技公司宣布推出新一代 AI 芯片。这款芯片的算力达到了上一代的 5 倍。由于算力的大幅提升，该公司能够训练出更大型的模型。更大型的模型在多项基准测试中取得了领先成绩。领先的成绩吸引了大量客户的关注。大量客户的需求导致芯片供不应求。供不应求的局面推高了芯片价格。芯片价格的大幅上涨直接提升了公司的营收和股价。

**目标**：搜索"芯片涨价的原因"时，检索结果是否能完整包含因果链。

### 4.2 代词链测试

张明是一名资深的 AI 工程师。他已经在行业内工作了十年。他最初在一家创业公司做后端开发。后来他接触到机器学习，开始转型。他的转型非常成功。现在他是公司的技术负责人。

**目标**：搜索"张明的工作经历"时，检索结果是否包含"他"指代的信息。

## 5. 跨文档关联

### doc-1.md：需求文档

产品需求：实现一个智能文档问答系统。系统需要支持多格式文档上传，包括 PDF、Word、Markdown。用户上传文档后，系统自动构建索引。用户可以通过自然语言进行提问。系统结合 RAG 技术返回准确答案。

### doc-2.md：技术方案

技术选型：使用 LlamaIndex 作为 RAG 框架。向量数据库选用 ChromaDB。LLM 选用通义千问。检索策略采用 SentenceSplitter（chunk_size=512, chunk_overlap=50） + query 扩展 + LLM 重排序。

**目标**：搜索"文档问答系统的技术方案"时，是否能正确关联两份文档。

## 6. 表格结构

| Chunk 策略 | 语义完整性 | 实现复杂度 | 运行成本 | 推荐场景 |
|:----------|:----------|:----------|:--------|:--------|
| 固定大小切 | ❌ 差 | ★☆☆ 极简 | 极低 | 原型验证 |
| 递归字符切 | ★★★ 中 | ★★☆ 简单 | 低 | 通用默认 |
| 句子级切 | ★★★★ 好 | ★★☆ 简单 | 低 | 文档问答 |
| 语义切 | ★★★★★ 优 | ★★★ 中等 | 中高 | 精准检索 |
| LLM 切 | ★★★★★ 优 | ★★★★★ 极高 | 极高 | 高价值文档 |

## 7. 超短文档（单句）

DocAgent 是一个基于 RAG 的智能文档问答系统。

## 8. 超长专有名词

超超超超超超超超超长ArtificialGeneralIntelligence超级智能ArtificialSuperIntelligence量子计算QuantumComputingTransformer架构AttentionIsAllYouNeed扩散模型DiffusionModel检索增强生成RetrievalAugmentedGeneration

---