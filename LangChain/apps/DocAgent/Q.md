# 问题记录📝

## Q1: 使用Window去切分后node包含前3、后3信息, LLM 的上下文里可能有 60% 是重复文本
>: 检索时去重——如果多个命中节点来自同一个窗口，只传一个。


## Q2:🔍 检索召回盲区 (Retrieval Blind Spot)
1. Query Underspecification（查询欠指定）用户问题太宽泛，检索器不知道该找什么
2. Search Surface Area Problem（搜索表面积问题）单 query 只探索了 Embedding 空间的一个小区域
3. Breadth-First Failure（广度优先失败） "列举所有 X"类型的问题在单 Agent 系统中尤其困难

### 为什么 Multi-Query 能解决 Q2 的三个盲区

| 盲区 | 原理 | 效果 |
|------|------|------|
| **查询欠指定** | 3-5 个不同角度的 query 覆盖用户没说出来的侧面 | "提示词框架" + "prompt engineering" + "设计模式" 三个角度 |
| **搜索表面积** | 每个 query 探索 Embedding 空间的不同区域 | 3-5 个点→覆盖面积 3-5 倍于单 query |
| **广度优先失败** | 不同角度的 query 命中不同 chunk | 不再只命中 CRISPE 那一块 |

还保留了你已有的**并行检索 + 去重 + 重排序**链路，没有新增代码也没有删功能。跑一下试试效果？

**问题**：用户问"prompt 常用框架有哪些"，Agent 只返回了 CRISPE 框架。

**根因**：
```
用户："prompt常用框架有哪些"
  ↓
Agent 发送 retrieve["提示词框架"]（单 query）
  ↓
向量搜索 → topK=5 → chunk 0 排第一（包含总述 + CRISPE详解）
  ↓
Agent 换关键词 → 依然是模糊 query → 还是 chunk 0
  ↓
5 轮用完 → "目前信息主要集中在CRISPE框架上"
```

**深层因素**：

| 因素 | 说明 | 解决方案 |
|------|------|---------|
| **Chunk 分布不均衡** | 8 个框架分散在 5 个 chunk，CRISPE 在 chunk 0 独占详解 + 总述 | 调整 chunk 策略或使用 query 扩展 |
| **单 query 召回盲区** | 一个泛查询无法覆盖所有框架的 embedding 空间 | 多 query 并行检索 |
| **Agent 不换关键词** | 5 轮都用相似的关键词，反复命中同一个 chunk | Poka-Yoke 工具设计 |

**解决方案演进**：

| 版本 | 方案 | 效果 |
|------|------|------|
| v1 | Prompt 引导多关键词 | ❌ LLM 记不住用逗号分隔 |
| v2 | 工具内部自动 query expansion | ✅ |
| v3 | Poka-Yoke 工具设计（Anthropic 推荐） | ✅ 智能封装在工具内部，不让 LLM 自己做决策 |


## Q3: ReAct 重复检索死循环 — 5 轮全浪费
| 框架	| 反循环策略	| 核心依赖
|------|------|------|
| Claude Code	| 1. 模型不输出 tool_use → 自然停止<br>2. maxTurns 硬限制<br>3. Hook 拦截（PostToolUse）<br>4. 上下文溢出 → 强制结束	| 模型本身（Claude 训练时就对齐了"什么时候该停"）
| OpenAI Agents SDK	| 1. max_turns 参数<br>2. Guardrails（pre/post 钩子）<br>3. 模型不调用工具 → 自然停止	| 同样是模型本身
| LangGraph	| 1. 状态图显式定义边（有限状态机）<br>2. 没有"循环"这个边就不会死循环<br>3. 节点执行次数| 硬限制	| 架构决定（图不是循环就永远不会循环）
| 你的做法	| 1. MAX_ITERATIONS 硬限制<br>2. 连续相同工具检测 ✅	| 代码层拦截

## Q4: Hallucination — 回答包含知识库里没有的内容
>: 优化prompt, 严格要求基于知识库内容回答, 在找不到情况下回答"我不知道"


## Q5: SentenceWindowNodeParser 的设计哲学就是：检索用 text（精确匹配），展示用 window（完整上下文）。我们只用了 text，相当于只拿了一半的功能。

## Q6: LlamaIndex SentenceSplitter 已知局限——它对 \d+.\d 这种数字带小数点的模式处理得不好，会误判为列表项编号。

## Q7: 召回率太差


## Qn: 你在写一个 Agent，主循环大概是「调 LLM → 拿到 tool_call → 执行工具 → 把结果塞回上下文 → 再调 LLM」。某次调用因为上游 5xx 失败了，自然想加重试——这是后端工程师的肌肉记忆，@retry(max_attempts=3) 一贴就完事。但 LLM 调用和普通 HTTP 请求有几个根本差异，让这套肌肉记忆经常翻车：
1. 每次调用都按 token 计费，失败重试不是免费的——尤其是上下文已经几万 token 的时候
2. 工具调用可能已经产生了副作用——如果是流式响应中断在工具调用之后,重试一次相当于副作用执行两次
3. 流式响应可能已经吐出了一半,从哪里续接、是否要丢弃,直接影响用户感知