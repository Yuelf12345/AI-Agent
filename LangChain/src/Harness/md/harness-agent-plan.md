# 生产级 Harness Agent 技术方案

## 1. 现状分析

### 1.1 已实现模块

| 模块 | 位置 | 完整度 | 核心问题 |
|------|------|--------|---------|
| **StateGraph 引擎** | `engine/stateGraph.ts` | ✅完整 | `interrupt()` 用 `throw InterruptSignal` 实现，`_resumeFromInterrupt` 不传递 resumeValue 给节点函数 |
| **Agent（Simple/ReAct/Main）** | `agents/*.ts` | ✅完整 | MainAgent `executeSubtasks` 是模拟执行，未接入真实 Worker；Router 有独立实现但 `routerNode` 未使用它 |
| **HITL 审批门控** | `hitl/approval.ts` | ✅完整 | `ApprovalGate` 与 `approvalNode` 是两套独立实现，未统一 |
| **Memory（三层）** | `services/memory/*.ts` | ✅完整 | 未接入任何 Agent/Node，独立存在 |
| **RAG Pipeline** | `services/rag/*.ts` | ✅完整 | 未接入图或 Agent，独立存在 |
| **Tool（基础+增强）** | `harness/tools/*.ts` | ✅完整 | `ToolRegistry` 和 `EnhancedToolRegistry` 两套并存，未统一 |
| **Output（Schema+Parser）** | `harness/output/*.ts` | ✅完整 | 正常工作 |
| **Observability** | `services/observability/*.ts` | ✅完整 | 未接入任何节点 |
| **Server** | `server.ts` | ⚠️简陋 | 仅 `/api/chat` 和 `/api/agent/simple`，未接入 HarnessGraph |
| **Skills** | `harness/skills/` | ❌空目录 | 无实现 |

### 1.2 核心断链问题

各模块独立可运行，但没有串联成一条完整链路：

```
用户输入 → 路由分类 → Agent执行 → Memory/RAG增强 → HITL审批 → 结构化输出
```

具体断链点：

1. **routerNode** 不使用已有的 `Router` 类，而是直接调用 `MainAgent.execute()`，且始终返回 `taskType: "simple"`
2. **approvalNode** 使用 `interrupt()` 等待审批，但恢复后 `resumeValue` 无法传递给节点
3. **Memory** 未接入任何节点，Agent 的 LLM 调用没有注入记忆上下文
4. **RAG** 未接入 Agent，检索能力未被利用
5. **EnhancedToolRegistry** 未在图中使用，`executeToolNode` 用的是旧版 `ToolRegistry`
6. **Observability** 的 `Tracer/Metrics/Logger` 未嵌入任何节点执行流程
7. **Server** 未接入 `createHarnessGraph`

---

## 2. 目标架构

### 2.1 完整链路流程图

```
START → router → [simple | complex]
                         ↓ simple
                    simpleAgent (+Memory+RAG)
                         ↓
                    needsApproval? → yes → approval(interrupt) → executeTool → output
                                     → no  → output
                         ↓ complex
                    planner → supervisor → reactAgent (+Memory+RAG)
                         ↓
                    needsApproval? → yes → approval(interrupt) → executeTool → reactAgent循环
                                     → no  → 循环判断
                                         ↓ completed → output
                                         ↓ error → error → END
    output → END
```

### 2.2 统一状态 Schema

重新设计 `HarnessState`，覆盖所有模块交互需求：

```typescript
export function createProductionHarnessStateSchema(): StateSchema {
  return new StateSchema()
    // 对话
    .addField("messages", z.array(z.any()), "append")

    // 执行追踪
    .addField("currentStep", z.string())
    .addField("iteration", z.number())
    .addField("status", z.enum(["idle", "running", "paused", "completed", "failed"]))

    // 任务分类（来自 Router）
    .addField("taskType", z.enum(["simple", "complex"]).nullable())
    .addField("routingReasoning", z.string().nullable())
    .addField("routingConfidence", z.number().nullable())

    // 执行计划（来自 Planner）
    .addField("plan", z.any())
    .addField("subtasks", z.array(z.any()), "append")
    .addField("subtaskResults", z.array(z.any()), "append")

    // 工具执行
    .addField("toolCalls", z.array(z.any()), "append")
    .addField("toolResults", z.array(z.any()), "append")
    .addField("pendingAction", z.any())
    .addField("plannedTools", z.array(z.any()), "append")

    // 审批（来自 HITL）
    .addField("needsApproval", z.boolean().default(false))
    .addField("approvalStatus", z.enum(["pending", "approved", "rejected", "modified"]).nullable())
    .addField("approvalRequest", z.any().nullable())

    // Memory 上下文
    .addField("memoryContext", z.string().nullable())
    .addField("relevantKnowledge", z.array(z.any()), "append")

    // RAG 上下文
    .addField("ragContext", z.string().nullable())
    .addField("ragDocuments", z.array(z.any()), "append")

    // 结构化输出
    .addField("results", z.array(z.any()), "append")
    .addField("finalResponse", z.string().nullable())

    // 可观测性
    .addField("traceId", z.string().nullable())
    .addField("spanIds", z.array(z.string()), "append")

    // 错误处理
    .addField("error", z.string().nullable())

    // 配置
    .addField("maxIterations", z.number().default(5));
}
```

---

## 3. 实施步骤

### Step 1：修复 StateGraph 核心缺陷（interrupt resume 传值）

**问题**：当前 `_resumeFromInterrupt` 方法恢复执行时，重新调用节点函数但不传递 `resumeValue`。`interrupt()` 函数用 `throw InterruptSignal` 实现，恢复后代码无法获取到用户传入的审批值。

**方案**：在状态中增加 `__resumeValue__` 字段，恢复执行时将 `Command.resume` 的值注入状态，节点函数通过 `state.__resumeValue__` 获取。

**修改文件**：`engine/stateGraph.ts`、`engine/command.ts`、`engine/state.ts`

具体改动：
1. `CompiledGraph.invoke()` 处理 resume 时，将 `input.resume` 值存入 `state.__resumeValue__`
2. 节点函数中通过 `state.__resumeValue__` 获取恢复值，而非依赖 `interrupt()` 函数返回值
3. 节点函数中，如果检测到 `state.__resumeValue__` 存在，跳过 `interrupt()` 调用直接使用恢复值

```typescript
// harnessNodes.ts - approvalNode 改造示例
export async function approvalNode(state: any): Promise<Partial<any> | Command> {
  const pendingAction = state.pendingAction || state.toolCalls?.[state.toolCalls.length - 1];

  if (!pendingAction) return new Command({ goto: "executeTool" });

  const needsApproval = approvalGate.needsApproval(
    pendingAction?.tool, pendingAction?.params
  );

  if (!needsApproval) return new Command({ goto: "executeTool" });

  // 检查是否是恢复调用（有 resumeValue）
  if (state.__resumeValue__ !== undefined) {
    const approved = state.__resumeValue__;
    if (approved === true) {
      return { approvalStatus: "approved", needsApproval: false };
    }
    return {
      approvalStatus: "rejected",
      results: [{ type: "rejected", reason: "用户拒绝审批" }],
      currentStep: "approval",
    };
  }

  // 新调用 - 触发中断
  const approvalRequest = approvalGate.createRequest(
    pendingAction.tool, pendingAction.params
  );
  interrupt({
    type: "approval_request",
    request: approvalRequest,
    question: `是否执行 ${pendingAction.tool} 操作？`,
    details: pendingAction,
  });
  // 此行不会执行 - interrupt 抛出 InterruptSignal
}
```

### Step 2：统一 Tool Registry

**问题**：`ToolRegistry`（基础版）和 `EnhancedToolRegistry`（增强版）并存，`executeToolNode` 和 Agent 使用基础版。

**方案**：废弃基础版 `ToolRegistry`，将 `EnhancedToolRegistry` 作为唯一工具注册器。基础工具（FileReadTool 等）通过增强版注册，配置各自的 retry/timeout/cache。

**修改文件**：`tools/registry.ts`、`engine/harnessNodes.ts`

```typescript
// 新的 registry.ts
export class HarnessToolRegistry extends EnhancedToolRegistry {
  // 自动注册所有基础工具，附带增强配置
  constructor() {
    super();
    this.register(new FileReadTool(), {
      timeout: { timeoutMs: 10000 },
      enableCache: true,
      cache: { ttlMs: 30000 },
    });
    this.register(new FileWriteTool(), {
      timeout: { timeoutMs: 15000 },
      retry: { maxRetries: 2 },
    });
    this.register(new FileEditTool(), {
      timeout: { timeoutMs: 15000 },
      retry: { maxRetries: 2 },
    });
    this.register(new BashTool(), {
      timeout: { timeoutMs: 30000 },
    });
  }
}
export const harnessToolRegistry = new HarnessToolRegistry();
```

### Step 3：接入 Memory 到节点

**问题**：三层 Memory（CompositeMemory）未接入任何节点。

**方案**：在图执行层面注入 Memory。创建 `memoryNode` 和 `memoryInjectionMiddleware`：

1. **memoryNode**（新节点）：在 router 之后、Agent 之前执行，从 CompositeMemory 获取上下文
2. **记忆存储**：Agent 执行完毕后，将推理过程和结果存回 Memory

```typescript
// 新增 memoryNode
export async function memoryNode(state: any): Promise<Partial<any>> {
  // 从 CompositeMemory 获取上下文
  const memoryContext = await compositeMemory.getContext(state.messages?.[state.messages.length - 1]?.content);

  return {
    memoryContext: memoryContext.toPrompt(),
    relevantKnowledge: memoryContext.relevantKnowledge.map(r => ({
      content: r.message.content,
      source: r.source,
      score: r.score,
    })),
    currentStep: "memory",
  };
}

// 图中位置
// START → router → memory → [simple | complex]
```

### Step 4：接入 RAG 到节点

**问题**：RAG Pipeline 未接入 Agent。

**方案**：创建 `ragNode`，在 memory 之后、Agent 之前执行，为 Agent 注入检索到的文档上下文。

```typescript
export async function ragNode(state: any): Promise<Partial<any>> {
  const query = state.messages?.[state.messages.length - 1]?.content || "";

  if (!query) return { ragContext: null, currentStep: "rag" };

  // 使用 RAG Pipeline 检索
  const results = await ragPipeline.retrieve(query, "hybrid", 3);

  if (results.length === 0) return { ragContext: null, currentStep: "rag" };

  // 构造 RAG 上下文文本
  const ragContext = results
    .map((r, i) => `[文档${i + 1}] (来源: ${r.document.metadata?.source}, 相关度: ${r.finalScore.toFixed(3)})\n${r.document.pageContent.slice(0, 500)}`)
    .join("\n\n");

  return {
    ragContext,
    ragDocuments: results.map(r => ({
      content: r.document.pageContent.slice(0, 200),
      score: r.finalScore,
      source: r.document.metadata?.source,
    })),
    currentStep: "rag",
  };
}

// 图中位置
// START → router → memory → rag → [simple | complex]
```

### Step 5：改造 routerNode 使用真实 Router

**问题**：当前 `routerNode` 调用 `MainAgent.execute()`，且始终返回 `taskType: "simple"`。

**方案**：使用已有的 `Router` 类，真正做任务分类。

```typescript
export async function routerNode(state: any): Promise<Partial<any>> {
  const lastMessage = state.messages?.[state.messages.length - 1]?.content || "";

  if (!lastMessage) return { taskType: "simple", currentStep: "router" };

  const router = new Router();
  const result = await router.route(lastMessage);

  return {
    taskType: result.taskType === "complex" ? "complex" : "simple",
    routingReasoning: result.reasoning,
    routingConfidence: result.confidence,
    currentStep: "router",
  };
}
```

### Step 6：改造 Agent 节点注入 Memory+RAG 上下文

**问题**：SimpleAgent/ReActAgent 的 LLM 调用没有注入 Memory 和 RAG 上下文。

**方案**：在 Agent 的 system prompt 中注入来自状态的记忆和 RAG 上下文。

```typescript
// simpleAgentNode 改造
export async function simpleAgentNode(state: any): Promise<Partial<any>> {
  const lastMessage = state.messages?.[state.messages.length - 1]?.content || "";

  // 构造增强 prompt：注入 Memory + RAG 上下文
  let enhancedInput = lastMessage;

  if (state.memoryContext) {
    enhancedInput += `\n\n【记忆上下文】\n${state.memoryContext}`;
  }
  if (state.ragContext) {
    enhancedInput += `\n\n【相关知识】\n${state.ragContext}`;
  }

  const agent = new SimpleAgent();
  const result = await agent.execute(enhancedInput);

  // 执行完毕后存入 Memory
  await compositeMemory.add({
    role: "assistant",
    content: result.response || result.toolResult || "",
    importance: 0.5,
  });

  return {
    results: [result],
    currentStep: "simpleAgent",
    finalResponse: result.response || result.toolResult,
  };
}
```

### Step 7：接入 Observability

**问题**：Tracer/Metrics/Logger 未嵌入任何节点。

**方案**：创建 `traceableNode` 包装器，自动为每个节点添加 Span。

```typescript
export function traceableNode(name: string, fn: GraphNode<any>): GraphNode<any> {
  return async (state: any) => {
    const span = globalTracer.startSpan(name);
    span.setTag("input.length", JSON.stringify(state).length);
    span.setTag("taskType", state.taskType);

    try {
      const result = await fn(state);

      globalMetrics.recordLLMCall(name, 0, 0); // 实际耗时在 result 中计算
      span.end();

      return {
        ...result,
        spanIds: [span.context.spanId],  // 记录 span ID
      };
    } catch (error: any) {
      span.setTag("error", error.message);
      span.end();
      throw error;
    }
  };
}

// 使用方式
graph.addNode("router", traceableNode("router", routerNode))
```

### Step 8：重构 createHarnessGraph 完整链路

将所有改造后的节点组装成完整的生产级图：

```typescript
export function createProductionHarnessGraph(options?: {
  checkpointer?: Checkpointer;
  maxIterations?: number;
}): CompiledGraph {
  const HarnessState = createProductionHarnessStateSchema();

  const graph = new StateGraph(HarnessState)
    // 路由
    .addNode("router", traceableNode("router", routerNode))

    // 记忆注入
    .addNode("memory", traceableNode("memory", memoryNode))

    // RAG 注入
    .addNode("rag", traceableNode("rag", ragNode))

    // Agent
    .addNode("simpleAgent", traceableNode("simpleAgent", simpleAgentNode))
    .addNode("planner", traceableNode("planner", plannerNode))
    .addNode("supervisor", traceableNode("supervisor", supervisorNode))
    .addNode("reactAgent", traceableNode("reactAgent", reactAgentNode))

    // 审批（interruptAfter）
    .addNode("approval", traceableNode("approval", approvalNode), { interruptAfter: true })

    // 工具执行
    .addNode("executeTool", traceableNode("executeTool", executeToolNode))

    // 输出
    .addNode("output", traceableNode("output", outputNode))

    // 错误
    .addNode("error", traceableNode("error", errorNode))

    // === 边 ===
    .addEdge(START, "router")
    .addEdge("router", "memory")
    .addEdge("memory", "rag")
    .addConditionalEdges("rag", routeByTaskType)

    // simple 路径
    .addConditionalEdges("simpleAgent", simpleAgentRouter)
    .addEdge("approval", "executeTool")
    .addEdge("executeTool", "output")

    // complex 路径
    .addEdge("rag", "planner")  // complex 时
    .addEdge("planner", "supervisor")
    .addConditionalEdges("supervisor", supervisorRouter)
    .addConditionalEdges("reactAgent", reactLoopRouter)

    .addEdge("output", END)
    .addEdge("error", END);

  return graph.compile({
    checkpointer: options?.checkpointer ?? new MemoryCheckpointer(),
  });
}
```

### Step 9：改造 Server 接入完整图

**问题**：Server 仅暴露简单 API，未接入 HarnessGraph。

**方案**：改造 `server.ts` 使用 `createProductionHarnessGraph`：

```typescript
// server.ts 改造核心
const harnessGraph = createProductionHarnessGraph();

// POST /api/chat - 使用完整 Harness Agent
if (url === "/api/chat" && method === "POST") {
  const body = await parseBody(req);
  const { message, thread_id } = body;

  const result = await harnessGraph.invoke(
    {
      messages: [{ role: "user", content: message }],
      taskType: null, plan: null, /* ... 所有初始值 */
    },
    { configurable: { thread_id: thread_id || `thread-${Date.now()}` } }
  );

  if (result.__interrupt__) {
    return jsonResponse(res, {
      status: "paused",
      interrupt: result.__interrupt__,
      thread_id: thread_id,
    });
  }

  return jsonResponse(res, {
    response: result.finalResponse,
    taskType: result.taskType,
    status: result.status,
  });
}

// POST /api/approve - 审批恢复
if (url === "/api/approve" && method === "POST") {
  const body = await parseBody(req);
  const { thread_id, approved } = body;

  const result = await harnessGraph.invoke(
    Command.resume(approved),
    { configurable: { thread_id } }
  );

  return jsonResponse(res, { response: result.finalResponse, status: result.status });
}
```

### Step 10：Worker Agent 实现与 Supervisor 集成

**问题**：MainAgent `executeSubtasks` 和 Supervisor `executeTask` 都是模拟执行。

**方案**：实现 4 个 Worker Agent，接入 Supervisor：

```typescript
// Worker Agent 映射
const WORKER_AGENTS: Record<string, BaseAgent> = {
  NoteWorker: new SimpleAgent({ id: "note-worker", systemPrompt: NOTE_WORKER_PROMPT }),
  TaskWorker: new SimpleAgent({ id: "task-worker", systemPrompt: TASK_WORKER_PROMPT }),
  SearchWorker: new SimpleAgent({ id: "search-worker", toolNames: ["search"], systemPrompt: SEARCH_WORKER_PROMPT }),
  FileWorker: new SimpleAgent({ id: "file-worker", toolNames: ["read_file", "write_file", "file_edit"], systemPrompt: FILE_WORKER_PROMPT }),
};

// Supervisor.executeTask 改造
private async executeTask(task: SubTask, ctx: ExecutionContext): Promise<TaskResult> {
  const worker = WORKER_AGENTS[task.assignedAgent];
  if (!worker) {
    return { taskId: task.id, success: false, error: `Worker ${task.assignedAgent} not found` };
  }

  try {
    const result = await worker.execute(task.description);
    return { taskId: task.id, success: true, data: result };
  } catch (error) {
    return { taskId: task.id, success: false, error: (error as Error).message };
  }
}
```

---

## 4. 条件路由函数

需要补充的路由函数：

```typescript
// rag 之后路由到 simple 或 complex
export function routeByTaskType(state: any): string {
  if (state.taskType === "simple") return "simpleAgent";
  if (state.taskType === "complex") return "planner";
  return "simpleAgent"; // 默认
}

// simpleAgent 执行后路由
export function simpleAgentRouter(state: any): string {
  if (state.error) return "error";
  if (state.needsApproval) return "approval";
  return "output";
}

// supervisor 路由到 reactAgent 或直接 output
export function supervisorRouter(state: any): string {
  if (state.error) return "error";
  if (state.subtaskResults?.length === state.subtasks?.length) return "output";
  return "reactAgent";
}

// reactAgent 循环路由
export function reactLoopRouter(state: any): string {
  if (state.error) return "error";
  if (state.needsApproval) return "approval";
  if (state.results?.[0]?.type === "react_completed") return "output";
  if ((state.iteration || 0) >= (state.maxIterations || 5)) return "output";
  return "reactAgent";
}
```

---

## 5. 新增 outputNode

当前缺少统一的输出节点，Agent 结果直接写入 `results`/`finalResponse`。新增 `outputNode` 负责：

1. 从 `results` 中提取最终响应
2. 将响应存入 Memory（长期记忆）
3. 记录 Observability 指标
4. 生成结构化输出

```typescript
export async function outputNode(state: any): Promise<Partial<any>> {
  let response = "";

  if (state.finalResponse) response = state.finalResponse;
  else if (state.results?.[0]?.response) response = state.results[0].response;
  else if (state.results?.[0]?.finalResponse) response = state.results[0].finalResponse;
  else if (state.results?.[0]?.toolResult) response = state.results[0].toolResult;

  // 存入长期记忆
  if (response && response.length > 50) {
    await compositeMemory.add({
      role: "assistant",
      content: response,
      importance: 0.7,
    });
  }

  return {
    finalResponse: response,
    status: "completed",
    currentStep: "output",
  };
}
```

---

## 6. 文件改动清单

### 需修改的文件

| 文件 | 改动内容 |
|------|---------|
| `engine/stateGraph.ts` | 修复 `_resumeFromInterrupt` 传递 resumeValue 到状态 |
| `engine/harnessNodes.ts` | 改造所有节点函数：注入 Memory/RAG/Observability |
| `engine/harnessGraph.ts` | 重构 `createHarnessGraph` 为完整生产级图 |
| `engine/state.ts` | 新增生产级状态 Schema |
| `tools/registry.ts` | 改为基于 `EnhancedToolRegistry` 的统一注册器 |
| `agents/mainAgent.ts` | 接入真实 Worker 执行 |
| `agents/supervisor.ts` | 接入 Worker Agent 映射 |
| `server.ts` | 接入 `createProductionHarnessGraph`，增加审批恢复 API |

### 需新增的文件

| 文件 | 内容 |
|------|------|
| `harness/nodes/memoryNode.ts` | Memory 注入节点 |
| `harness/nodes/ragNode.ts` | RAG 注入节点 |
| `harness/nodes/outputNode.ts` | 统一输出节点 |
| `harness/nodes/routerNodes.ts` | 条件路由函数集合 |
| `harness/workers/*.ts` | 4 个 Worker Agent（Note/Task/Search/File） |
| `test/11.test-production-harness.ts` | 完整链路集成测试 |

### 可删除的文件

| 文件 | 原因 |
|------|------|
| `agents/mainAgent copy.ts` | 备份文件 |
| `agents/mainAgent.old.ts` | 旧版本 |

---

## 7. 依赖注入方案

当前各模块通过全局单例（`llmService`、`toolRegistry`、`approvalGate`）耦合。生产级改造应改为依赖注入：

```typescript
export interface HarnessDependencies {
  llm: LLMService;
  tools: HarnessToolRegistry;
  memory: CompositeMemory;
  rag: RAGPipeline;
  observability: { tracer: Tracer; metrics: Metrics; logger: Logger };
  hitl: ApprovalGate;
  workers: Record<string, BaseAgent>;
}

// createProductionHarnessGraph 接收依赖
export function createProductionHarnessGraph(deps: HarnessDependencies): CompiledGraph {
  // 所有节点函数通过 deps 访问服务
}
```

---

## 8. 实施优先级

| 优先级 | 步骤 | 原因 |
|--------|------|------|
| P0 | Step 1: 修复 interrupt resume | 这是 HITL 的核心功能，当前无法正常工作 |
| P0 | Step 5: 改造 routerNode | 路由是整条链路的入口，当前无效 |
| P1 | Step 2: 统一 Tool Registry | 工具执行是 Agent 的核心能力 |
| P1 | Step 8: 重构 HarnessGraph | 串联所有节点 |
| P1 | Step 9: 改造 Server | 让外部可调用完整链路 |
| P2 | Step 3: 接入 Memory | 增强对话能力 |
| P2 | Step 4: 接入 RAG | 增强知识检索 |
| P2 | Step 7: 接入 Observability | 生产级可观测 |
| P3 | Step 6: Agent 注入上下文 | 需要 Step 3/4 完成 |
| P3 | Step 10: Worker Agent | 复杂任务的编排能力 |

---

## 9. 测试策略

### 集成测试用例

1. **简单问答**：`"你好"` → router(simple) → simpleAgent → output → END
2. **简单工具调用**：`"读取文件 test.txt"` → router(simple) → simpleAgent(tool_call) → output → END
3. **复杂任务**：`"整理笔记并提取待办"` → router(complex) → planner → supervisor → reactAgent → output → END
4. **审批流程**：`"删除 important.txt"` → router(simple) → simpleAgent → approval(interrupt) → 用户批准 → executeTool → output → END
5. **审批拒绝**：`"执行 rm -rf"` → router(simple) → simpleAgent → approval(interrupt) → 用户拒绝 → output(rejected) → END
6. **Memory 增强对话**：连续两条消息，第二条应包含第一条的记忆上下文
7. **RAG 增强回答**：先索引文档，再提问，Agent 应引用 RAG 检索结果
8. **错误处理**：工具调用失败 → errorNode → END
9. **递归限制**：超过 maxIterations → output(finalResponse) → END