# AI 系统学习计划

> 预计周期：3-4 个月

---

## 阶段一：AI 基础（2-4周）

### Transformer 与 LLM 原理
- [ ] 阅读论文《Attention is All You Need》（理解核心思想即可）
- [ ] 理解 Tokenization：BPE、WordPiece 分词原理
- [ ] 理解 Embedding：文本如何变成向量
- [ ] 理解上下文窗口和位置编码
- [ ] 区分 Base 模型 vs Instruct 模型 vs Chat 模型

### API 上手实践
- [ ] 注册 OpenAI API，完成首次调用
- [ ] 注册 Claude API，对比两者响应差异
- [ ] 用 Node.js/TS 封装一个简单的 LLM 客户端
- [ ] 实现流式响应（SSE）处理
- [ ] 了解 API 计费方式和 Token 计算

### 模型认知
- [ ] 了解 GPT-4/GPT-4o 的特点和适用场景
- [ ] 了解 Claude 3.5 Sonnet 的优势
- [ ] 了解主流开源模型：Llama、Qwen、DeepSeek
- [ ] 体验国产大模型：通义千问、文心一言、Kimi

---

## 阶段二：提示词工程（2-3周）

### 基础技巧
- [ ] 掌握 Zero-shot 和 Few-shot Prompting
- [ ] 实践 Chain-of-Thought（思维链）提示
- [ ] 学习 System Prompt 的设计原则
- [ ] 掌握角色扮演（Role Prompting）

### 进阶技巧
- [ ] 结构化输出：强制 JSON/XML 格式
- [ ] 上下文学习（In-context Learning）优化
- [ ] 少样本示例的选取策略
- [ ] Prompt 的迭代调试方法

### 实践项目
- [ ] 设计一个代码审查 Prompt
- [ ] 设计一个需求分析 Prompt
- [ ] 用 Prompt 实现一个简单的分类器
- [ ] 分析 Cursor/Copilot 的 Prompt 设计思路

### 工具使用
- [ ] 使用 Claude Artifacts 快速验证 Prompt
- [ ] 使用 PromptPerfect 优化提示词
- [ ] 建立个人 Prompt 模板库

---

## 阶段三：RAG 系统（3-4周）

### 理论基础
- [ ] 理解 RAG 的完整架构：检索 + 生成
- [ ] 了解 Embedding 模型的选择（OpenAI、本地模型）
- [ ] 理解向量相似度计算：余弦相似度、点积

### 向量数据库
- [ ] 本地部署 Chroma（最简单上手）
- [ ] 了解 Pinecone 云服务
- [ ] 了解 Milvus（适合大规模）
- [ ] 实践：存储和检索文档向量

### 检索策略
- [ ] 实现基础语义搜索
- [ ] 实现关键词 + 向量混合检索
- [ ] 了解重排序（Reranking）技术
- [ ] 学习分块（Chunking）策略

### 实践项目
- [ ] 构建个人知识库问答系统
- [ ] 实现代码库智能检索
- [ ] 做一个文档总结助手
- [ ] 使用 LangChain.js 或 LlamaIndex.TS 实现完整 RAG

---

## 阶段四：Agent 系统（4-6周）

### Agent 架构
- [ ] 理解 ReAct 模式（推理-行动循环）
- [ ] 理解 Plan-and-Execute 模式
- [ ] 了解 Multi-Agent 架构
- [ ] 学习 Agent 的记忆系统设计

### 工具调用（Function Calling）
- [ ] 掌握 Function Calling 的 JSON Schema 定义
- [ ] 实现 3-5 个自定义工具
- [ ] 处理工具调用失败和重试
- [ ] 工具结果的反馈循环

### 主流框架
- [ ] 学习 LangChain/LangChain.js 核心概念
- [ ] 学习 LlamaIndex 的索引和查询
- [ ] 了解 Vercel AI SDK 的流式处理
- [ ] 了解 AutoGen/CrewAI 的多 Agent 协作

### 实践项目
- [ ] 开发一个能查天气、发邮件的助手
- [ ] 开发 GitHub PR Review Agent
- [ ] 开发会议纪要和待办提取 Agent
- [ ] 尝试 Multi-Agent 协作完成复杂任务

---

## 阶段五：生产化与 Harness（持续）

### 工程化能力
- [ ] 对话状态管理和持久化
- [ ] 长对话的上下文压缩策略
- [ ] Token 成本监控和优化
- [ ] 错误处理、降级和熔断

### Harness 框架
- [ ] 了解 OpenClaw 架构（你现在就在用）
- [ ] 学习 Skill/Tool 的设计模式
- [ ] 了解 Vercel AI SDK 的 Streaming
- [ ] 学习 LangServe 部署

### 性能优化
- [ ] Prompt 缓存策略
- [ ] 批量调用优化
- [ ] 模型路由（小模型+大模型协作）
- [ ] 延迟优化技巧

### 完整项目
- [ ] 开发一个可部署的 AI 产品
- [ ] 实现用户认证和权限管理
- [ ] 添加使用分析和监控系统
- [ ] 开源或内部分享你的项目

---

## 推荐资源清单

### 课程
- [ ] DeepLearning.AI: ChatGPT Prompt Engineering for Developers
- [ ] DeepLearning.AI: LangChain for LLM Application Development
- [ ] DeepLearning.AI: Functions, Tools and Agents with LangChain

### 书籍
- [ ] 《Building LLM Apps》
- [ ] 《Designing Machine Learning Systems》（可选）

### 实践平台
- [ ] Claude Console (claude.ai)
- [ ] OpenAI Playground
- [ ] LangChain Documentation
- [ ] Vercel AI SDK Examples

### 社区与资讯
- [ ] 关注 LangChain/AutoGen GitHub
- [ ] 订阅 TLDR AI Newsletter
- [ ] 关注 @jxzhangai、@karpathy 等推特

---

## 学习建议

1. **每周至少动手写一个 Demo**，理论不如实践
2. **从解决自己的实际问题出发**，而非为了学而学
3. **记录学习笔记**，Prompt 模板、踩坑记录都很宝贵
4. **参与社区**，GitHub Issues、Discord 是解决问题的好地方
5. **保持前端优势**，把 AI 能力封装成好用的产品

---

*Created: 2025-04-10*
*Next Review: 每周日检查进度*
