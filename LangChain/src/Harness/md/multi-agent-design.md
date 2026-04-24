# 多Agent协作技术方案

## 1. Agent划分方案

采用**主Agent + 分层架构**：

```
┌─────────────────────────────────────────────────────────────┐
│                      BaseAgent (基类)                        │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  公共属性：id, name, state, tools, llm                  ││
│  │  公共方法：execute(), handleError(), setState()         ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────┬───────────────────────────────────────┘
                      │ extends
        ┌─────────────┴─────────────┐
        ▼                           ▼
┌───────────────────┐      ┌───────────────────┐
│    MainAgent      │      │   Worker Agents   │
│    (主控Agent)    │      │  (NoteAgent等)    │
└─────────┬─────────┘      └───────────────────┘
          │                         │
          │ 编排                     │ 执行
          ▼                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    Worker Layer (执行层)                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │NoteAgent │  │TaskAgent │  │SearchAgent│  │FileAgent │   │
│  │(笔记)    │  │(待办)    │  │(搜索)    │  │(文件)    │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐│
│  │              SimpleAgent (单工具快速响应)                ││
│  │   直接调用工具，无需规划（如：查询当前时间）             ││
│  └────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

### 1.1 Main Agent (主控Agent)

**核心职责**：作为系统唯一入口和主控中心，协调所有子Agent的执行。

Main Agent包含三个核心组件：

| 组件 | 职责 | 说明 |
|------|------|------|
| **Router** | 意图识别 | 分析用户输入，判断任务类型（Simple/Complex） |
| **Planner** | 任务规划 | 将复杂任务拆解为子任务序列，分配给Worker |
| **Supervisor** | 执行监控 | 监控Worker执行状态，处理错误，协调重试 |

**Main Agent工作流程**：
```
用户输入 → Router分析意图
              ├─ Simple任务 → 直接调用Simple Agent
              └─ Complex任务 → Planner生成计划 → Supervisor协调执行
                                                                ↓
                                                         结果汇总 → 返回用户
```

### 1.2 Worker层职责

| Agent | 关联Tools | Skills | 典型场景 |
|-------|-----------|--------|----------|
| **NoteAgent** | `note_search`, `note_create` | `note_management` | "帮我记一下会议内容" |
| **TaskAgent** | `todo_extract` | `task_extraction` | "从邮件提取待办" |
| **SearchAgent** | `note_search`, `web_search` | `knowledge_search` | "什么是RAG？" |
| **FileAgent** | `file_read`, `file_write` | `file_management` | "读取config.json" |

---

## 2. 状态机设计

状态机由 **Main Agent** 驱动：

```
┌───────────────────────────────────────────────────────────────┐
│                      Agent State Machine                       │
│                      (由 Main Agent 驱动)                       │
├───────────────────────────────────────────────────────────────┤
│                                                                │
│   ┌───────┐       ┌─────────┐       ┌──────────────┐          │
│   │ IDLE  │──────▶│ ROUTING │──────▶│ SIMPLE_AGENT │          │
│   └───────┘       └────┬────┘       └──────────────┘          │
│       ▲                │                      │                 │
│       │                │ (复杂任务)            │ (完成)          │
│       │                ▼                      ▼                 │
│       │          ┌─────────┐           ┌─────────────┐         │
│       │          │PLANNING │           │ RESPONDING  │         │
│       │          └────┬────┘           └─────────────┘         │
│       │               │                                         │
│       │               ▼                                         │
│       │          ┌─────────┐                                    │
│       │          │EXECUTING│◀─────────────┐                     │
│       │          └────┬────┘              │                     │
│       │               │                   │                     │
│       │               ▼                   │                     │
│       │          ┌─────────┐              │                     │
│       │          │OBSERVING│──────────────┘ (继续执行)          │
│       │          └────┬────┘                                    │
│       │               │ (执行完成)                               │
│       │               ▼                                         │
│       │          ┌────────────────┐                             │
│       └──────────│WAITING_APPROVAL │ (可选：人机确认)            │
│                  └────────────────┘                             │
│                                                                │
│   ┌───────────────┐                                             │
│   │ERROR_HANDLING │◀──── (异常)                                 │
│   └───────┬───────┘                                             │
│           │                                                     │
│           ▼ (重试/回滚)                                          │
│       [恢复到IDLE]                                              │
│                                                                │
└───────────────────────────────────────────────────────────────┘
```

### 2.1 状态说明

| 状态 | 触发条件 | 行为 |
|------|----------|------|
| **IDLE** | 初始/完成 | 等待用户输入 |
| **ROUTING** | 收到消息 | Main Agent的Router组件分析意图 |
| **SIMPLE_AGENT** | 单工具任务 | 直接调用Simple Agent执行 |
| **PLANNING** | 复杂任务 | Main Agent的Planner组件生成任务计划 |
| **EXECUTING** | 执行计划 | Supervisor协调Worker执行子任务 |
| **OBSERVING** | 工具执行后 | 观察结果，决定是否继续 |
| **WAITING_APPROVAL** | 危险操作 | 等待用户确认（如删除文件） |
| **RESPONDING** | 任务完成 | 生成最终回复 |
| **ERROR_HANDLING** | 异常 | 错误恢复/重试/回滚 |

---

## 3. BaseAgent 基类设计

所有Agent继承自 `BaseAgent` 基类，确保统一接口和扩展能力。

### 3.1 实际实现

```typescript
import { llmService } from "../../services/llm.ts";
import { ToolRegistry, toolRegistry } from "../tools/registry.ts";
import { AgentState, type AgentConfig} from "../../types/index.ts";
import { SystemMessage } from "@langchain/core/messages";

abstract class BaseAgent {
  protected id: string;
  protected name: string;
  protected state: AgentState;
  protected registry: ToolRegistry;
  protected llm: any;
  protected logger: Console;
  protected systemPrompt: string;

  constructor(config: AgentConfig) {
    this.id = config.id;
    this.name = config.name;
    this.state = AgentState.IDLE;
    this.registry = new ToolRegistry();
    this.logger = console;
    this.llm = config.llm || llmService.getModel();
    this.systemPrompt = config.systemPrompt || '';

    // 从全局registry复制指定工具
    config.toolNames?.forEach((name: string) => {
      const tool = toolRegistry.get(name);
      if (tool) {
        this.registry.register(tool);
      }
    });
  }

  // 执行入口（子类必须实现）
  abstract execute(input: any): Promise<any>;

  // 状态管理
  setState(state: AgentState): void { ... }
  getState(): AgentState { ... }

  // 错误处理
  async handleError(error: Error): Promise<void> { ... }

  // 工具调用
  protected async callTool(toolName: string, params: any): Promise<string> {
    return await this.registry.invoke({ name: toolName, args: params });
  }

  // 工具描述
  getAvailableTools(): string[] { return this.registry.list(); }
  getToolDescriptions(): string { return this.registry.getDescriptions(); }

  // LLM调用
  protected async callLLM(prompt: string): Promise<string> { ... }

  // 系统消息
  getSystemMessage(): SystemMessage { return new SystemMessage(this.systemPrompt); }
  setSystemPrompt(prompt: string): void { this.systemPrompt = prompt; }

  // Agent信息
  getInfo(): { id: string; name: string; state: AgentState; tools: string[] } { ... }
}
```

### 3.2 关键设计

| 组件 | 说明 |
|------|------|
| **ToolRegistry** | 每个Agent有独立的registry，从全局toolRegistry复制工具 |
| **toolNames** | 配置中使用工具名字符串数组，而非工具实例 |
| **systemPrompt** | 可选的系统提示，用于构建SystemMessage |
| **getSystemMessage()** | 返回LangChain的SystemMessage对象 |

---

## 4. Main Agent 实现

Main Agent整合三个核心组件（Router、Planner、Supervisor），作为系统唯一入口。

### 4.1 实际实现

```typescript
import { BaseAgent } from "./baseAgent.ts";
import { AgentState, RouterResult, PlannerResult, TaskResult } from "../../types/index.ts";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { Router } from "./router.ts";
import { Planner } from "./planner.ts";
import { Supervisor } from "./supervisor.ts";

export class MainAgent extends BaseAgent {
  private router: Router;
  private planner: Planner;
  private supervisor: Supervisor;

  constructor() {
    super({
      id: "main-agent",
      name: "MainAgent",
      systemPrompt: `你是知识管理系统的主控Agent。
你的职责是：
1. 分析用户意图，判断任务类型
2. 协调各个Worker Agent执行任务
3. 监控执行过程，处理异常
4. 汇总结果返回给用户`
    });
    
    // 初始化三个组件
    this.router = new Router();
    this.planner = new Planner();
    this.supervisor = new Supervisor();
  }

  async execute(input: string): Promise<any> {
    this.setState(AgentState.RUNNING);

    try {
      // Step 1: Router - 分析意图，判断任务类型
      console.log("[MainAgent] 开始路由分析...");
      const routerResult: RouterResult = await this.router.route(input);
      console.log(`[MainAgent] 路由结果: ${routerResult.taskType}, 置信度: ${routerResult.confidence}`);

      if (routerResult.taskType === 'simple') {
        // Simple任务：直接执行
        return await this.handleSimpleTask(input, routerResult);
      } else {
        // Complex任务：规划 + 执行
        return await this.handleComplexTask(input);
      }
    } catch (error) {
      await this.handleError(error as Error);
      throw error;
    } finally {
      this.setState(AgentState.COMPLETED);
    }
  }

  /**
   * 处理简单任务
   */
  private async handleSimpleTask(input: string, routerResult: RouterResult): Promise<any> {
    console.log(`[MainAgent] 处理简单任务，目标Agent: ${routerResult.targetAgent}`);
    
    // TODO: 后续接入SimpleAgent
    // 目前暂时用LLM直接响应
    const messages = [
      new SystemMessage(this.systemPrompt),
      new HumanMessage(input)
    ];
    const response = await this.llm.invoke(messages);
    return {
      type: 'simple',
      result: response.content
    };
  }

  /**
   * 处理复杂任务
   */
  private async handleComplexTask(input: string): Promise<any> {
    // Step 2: Planner - 任务规划
    console.log("[MainAgent] 开始任务规划...");
    const plannerResult: PlannerResult = await this.planner.plan(input);
    console.log(`[MainAgent] 规划完成，共${plannerResult.subtasks.length}个子任务`);
    
    // Step 3: Supervisor - 执行监控
    console.log("[MainAgent] 开始执行监控...");
    const results: TaskResult[] = await this.supervisor.execute(plannerResult.subtasks);
    
    // 汇总结果
    return {
      type: 'complex',
      reasoning: plannerResult.reasoning,
      subtasks: plannerResult.subtasks,
      results: results
    };
  }
}
```

---

## 5. Router 组件实现

**职责**：分析用户输入，判断任务类型（simple/complex）

### 5.1 类型定义

```typescript
// 任务类型
export type TaskType = 'simple' | 'complex';

// Router路由结果
export interface RouterResult {
  taskType: TaskType;
  reasoning: string;      // 为什么这样判断
  targetAgent?: string;   // simple任务时，指定要调用的Agent
  confidence: number;     // 判断置信度 0-1
}
```

### 5.2 核心实现

```typescript
import { llmService } from "../../services/llm.ts";
import { RouterResult } from "../../types/index.ts";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

export class Router {
  private llm: any;
  
  private systemPrompt = `你是一个任务分类器。分析用户输入，判断任务类型。

判断标准：
- SIMPLE：单步操作，可直接调用一个工具完成（如：查询时间、读取文件）
- COMPLEX：需要多个步骤，涉及多个工具或Agent协作（如：整理笔记并提取待办）

请严格按照以下JSON格式返回，不要包含其他内容：
{
  "taskType": "simple" 或 "complex",
  "reasoning": "判断理由",
  "targetAgent": "目标Agent名称（仅simple时需要）",
  "confidence": 0到1之间的数字
}`;

  constructor() {
    this.llm = llmService.getModel();
  }

  async route(input: string): Promise<RouterResult> {
    const messages = [
      new SystemMessage(this.systemPrompt),
      new HumanMessage(`用户输入：${input}`)
    ];

    const response = await this.llm.invoke(messages);
    const content = typeof response.content === 'string' 
      ? response.content 
      : JSON.stringify(response.content);

    return this.parseResult(content);
  }

  private parseResult(content: string): RouterResult {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("无法解析LLM返回结果");
      }
      
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        taskType: parsed.taskType,
        reasoning: parsed.reasoning || '',
        targetAgent: parsed.targetAgent,
        confidence: parsed.confidence || 0.5
      };
    } catch (error) {
      // 解析失败，默认返回complex
      return {
        taskType: 'complex',
        reasoning: '无法解析任务类型，默认按复杂任务处理',
        confidence: 0.5
      };
    }
  }
}
```

### 5.3 判断标准

| 任务类型 | 特征 | 示例 |
|---------|------|------|
| **Simple** | 单步操作、直接调用工具 | "现在几点？"、"查询天气"、"读取文件" |
| **Complex** | 多步骤、需要协调多个工具/Agent | "整理会议笔记并提取待办"、"搜索相关资料并写总结" |

---

## 6. Planner 组件实现

**职责**：将复杂任务拆解为子任务序列

### 6.1 类型定义

```typescript
// 子任务定义
export interface SubTask {
  id: string;
  description: string;      // 任务描述
  assignedAgent: string;    // 负责的Worker Agent
  dependencies: string[];   // 依赖的子任务ID
  params?: Record<string, unknown>;  // 任务参数
  status: 'pending' | 'running' | 'completed' | 'failed';
}

// 任务执行结果
export interface TaskResult {
  taskId: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

// Planner规划结果
export interface PlannerResult {
  subtasks: SubTask[];
  reasoning: string;
}
```

### 6.2 核心实现

```typescript
import { llmService } from "../../services/llm.ts";
import { PlannerResult, SubTask } from "../../types/index.ts";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

// 可用的Worker Agent列表
const AVAILABLE_AGENTS = [
  { name: 'NoteAgent', capability: '笔记管理：创建、搜索、编辑笔记' },
  { name: 'TaskAgent', capability: '待办管理：提取、创建、管理待办事项' },
  { name: 'SearchAgent', capability: '知识搜索：搜索笔记和本地知识库' },
  { name: 'FileAgent', capability: '文件管理：读取、编辑文件' },
];

export class Planner {
  private llm: any;

  private systemPrompt = `你是一个任务规划专家。将用户的复杂任务拆解为子任务序列。

可用的Worker Agent：
${AVAILABLE_AGENTS.map(a => `- ${a.name}: ${a.capability}`).join('\n')}

拆解原则：
1. 每个子任务应该是一个原子操作
2. 标明子任务之间的依赖关系
3. 为每个子任务分配合适的Agent
4. 按执行顺序排列子任务

请严格按照以下JSON格式返回：
{
  "subtasks": [
    {
      "id": "task-1",
      "description": "任务描述",
      "assignedAgent": "Agent名称",
      "dependencies": [],
      "status": "pending"
    }
  ],
  "reasoning": "规划理由"
}`;

  constructor() {
    this.llm = llmService.getModel();
  }

  async plan(input: string): Promise<PlannerResult> {
    const messages = [
      new SystemMessage(this.systemPrompt),
      new HumanMessage(`用户任务：${input}`)
    ];

    const response = await this.llm.invoke(messages);
    const content = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

    return this.parseResult(content);
  }

  private parseResult(content: string): PlannerResult {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("无法解析规划结果");
      }

      const parsed = JSON.parse(jsonMatch[0]);
      
      const subtasks: SubTask[] = (parsed.subtasks || []).map((task, index) => ({
        id: task.id || `task-${index + 1}`,
        description: task.description || '',
        assignedAgent: task.assignedAgent || 'UnknownAgent',
        dependencies: task.dependencies || [],
        params: task.params,
        status: 'pending' as const
      }));

      return { subtasks, reasoning: parsed.reasoning || '' };
    } catch (error) {
      return {
        subtasks: [],
        reasoning: '规划解析失败，请重试'
      };
    }
  }
}
```

---

## 7. Supervisor 组件实现

**职责**：监控子任务执行，处理依赖关系，汇总结果

### 7.1 类型定义

```typescript
// 执行上下文
export interface ExecutionContext {
  taskId: string;
  subtasks: SubTask[];
  results: TaskResult[];
  currentTaskIndex: number;
  maxRetries: number;
}
```

### 7.2 核心实现

```typescript
import { SubTask, TaskResult, ExecutionContext } from "../../types/index.ts";

export class Supervisor {
  private maxRetries: number;

  constructor(config?: { maxRetries?: number }) {
    this.maxRetries = config?.maxRetries || 3;
  }

  async execute(subtasks: SubTask[]): Promise<TaskResult[]> {
    const ctx: ExecutionContext = {
      taskId: this.generateTaskId(),
      subtasks: [...subtasks],
      results: [],
      currentTaskIndex: 0,
      maxRetries: this.maxRetries
    };

    // 按依赖顺序执行
    while (this.hasPendingTasks(ctx)) {
      const task = this.getNextRunnableTask(ctx);
      
      if (!task) {
        // 没有可执行的任务（可能依赖未满足）
        break;
      }

      const result = await this.executeTask(task, ctx);
      ctx.results.push(result);

      // 更新任务状态
      task.status = result.success ? 'completed' : 'failed';
    }

    return ctx.results;
  }

  private async executeTask(task: SubTask, ctx: ExecutionContext): Promise<TaskResult> {
    task.status = 'running';
    
    let lastError: string | undefined;
    
    for (let attempt = 1; attempt <= ctx.maxRetries; attempt++) {
      try {
        console.log(`[Supervisor] 执行任务: ${task.description} (尝试 ${attempt}/${ctx.maxRetries})`);
        
        // TODO: 这里暂时模拟执行，后续注入真正的Worker Agent
        await this.simulateExecution(task);

        return {
          taskId: task.id,
          success: true,
          data: { result: `任务完成: ${task.description}` }
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        console.error(`[Supervisor] 任务失败: ${task.id}, 尝试 ${attempt}/${ctx.maxRetries}`);
      }
    }

    return {
      taskId: task.id,
      success: false,
      error: lastError || '未知错误'
    };
  }

  private hasPendingTasks(ctx: ExecutionContext): boolean {
    return ctx.subtasks.some(t => t.status === 'pending');
  }

  private getNextRunnableTask(ctx: ExecutionContext): SubTask | undefined {
    return ctx.subtasks.find(task => {
      if (task.status !== 'pending') return false;
      
      // 检查依赖是否全部完成
      return task.dependencies.every(depId => {
        const depTask = ctx.subtasks.find(t => t.id === depId);
        return depTask?.status === 'completed';
      });
    });
  }

  private async simulateExecution(task: SubTask): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 100));
    console.log(`[Supervisor] ${task.assignedAgent} 完成任务: ${task.description}`);
  }

  private generateTaskId(): string {
    return `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
```

---

## 8. Worker Agent 实现

Worker Agent同样继承自BaseAgent，专注于具体任务执行。

### 8.1 Worker基类

```typescript
class WorkerAgent extends BaseAgent {
  private skill: string;
  
  constructor(config: AgentConfig & { skill: string }) {
    super(config);
    this.skill = config.skill;
  }
  
  async execute(task: SubTask): Promise<TaskResult> {
    this.setState(AgentState.RUNNING);
    
    try {
      const tool = this.selectTool(task);
      const result = await this.callTool(tool.name, task.params);
      
      this.setState(AgentState.COMPLETED);
      return { taskId: task.id, success: true, data: result };
    } catch (error) {
      await this.handleError(error);
      return { taskId: task.id, success: false, error: error.message };
    }
  }
  
  private selectTool(task: SubTask): BaseTool {
    // 工具选择逻辑
    return this.tools.get(task.toolName)!;
  }
}
```

### 8.2 具体Worker实现示例

```typescript
class NoteAgent extends WorkerAgent {
  constructor() {
    super({
      id: 'note-agent',
      name: 'NoteAgent',
      skill: 'note_management',
      toolNames: ['note_search', 'note_create']
    });
  }
}
```

---

## 9. 使用示例

### 9.1 基本使用

```typescript
import { MainAgent } from "./harness/agents/index.ts";

const agent = new MainAgent();

// 简单任务示例
const result1 = await agent.execute("现在几点了？");

// 复杂任务示例
const result2 = await agent.execute("帮我整理上周的会议笔记，并提取待办事项");
```

### 9.2 预期输出

**简单任务输出**:
```json
{
  "type": "simple",
  "result": "现在是2024年4月24日 下午5:30"
}
```

**复杂任务输出**:
```json
{
  "type": "complex",
  "reasoning": "任务需要两个步骤：先整理笔记，再提取待办",
  "subtasks": [
    {
      "id": "task-1",
      "description": "整理上周的会议笔记",
      "assignedAgent": "NoteAgent",
      "dependencies": [],
      "status": "completed"
    },
    {
      "id": "task-2",
      "description": "从笔记中提取待办事项",
      "assignedAgent": "TaskAgent",
      "dependencies": ["task-1"],
      "status": "completed"
    }
  ],
  "results": [
    { "taskId": "task-1", "success": true, "data": {...} },
    { "taskId": "task-2", "success": true, "data": {...} }
  ]
}
```

---

## 10. 文件结构

```
src/harness/
├── agents/
│   ├── baseAgent.ts      # Agent基类
│   ├── mainAgent.ts      # 主控Agent
│   ├── router.ts         # Router组件
│   ├── planner.ts        # Planner组件
│   ├── supervisor.ts     # Supervisor组件
│   ├── index.ts          # 导出文件
│   └── workers/          # Worker Agents (待实现)
│       ├── workerAgent.ts
│       ├── noteAgent.ts
│       ├── taskAgent.ts
│       ├── searchAgent.ts
│       └── fileAgent.ts
└── types/
    └── index.ts          # 类型定义
```

---

## 11. 渐进式Demo实现路径

```
Demo 1: BaseAgent + Main Agent框架 ✅ 已完成
├── BaseAgent基类实现 ✅
├── MainAgent继承BaseAgent ✅
├── AgentState枚举 ✅
├── AgentConfig接口 ✅
├── SystemMessage集成 ✅
└── 状态：IDLE → RUNNING → COMPLETED ✅

Demo 2: 增加Router组件 ✅ 已完成
├── 意图识别（规则+LLM）✅
├── 简单任务路由 ✅
└── 复杂任务路由 ✅

Demo 3: 增加Planner + Supervisor ✅ 已完成
├── LLM任务拆解 ✅
├── 生成子任务列表 ✅
├── Supervisor调度执行 ✅
└── 结果汇总 ✅

Demo 4: 增加Worker + 工具调用 ⏳ 待实现
├── WorkerAgent基类
├── NoteAgent/FileAgent实现
├── 工具动态绑定
└── 状态：增加WAITING、ERROR

Demo 5: Supervisor真实执行 ⏳ 待实现
├── 注入Worker实例
├── 错误恢复和重试
├── 人机确认机制
└── 长期记忆集成
```

---

## 12. 后续工作

### 12.1 待实现组件

1. **SimpleAgent** - 处理单工具简单任务
2. **Worker Agents**:
   - NoteAgent - 笔记管理
   - TaskAgent - 待办管理
   - SearchAgent - 知识搜索
   - FileAgent - 文件管理

### 12.2 待完善功能

1. **Supervisor真实执行** - 目前是模拟执行，需注入真实Worker实例
2. **状态持久化** - 任务执行状态的持久化存储
3. **错误恢复机制** - 更完善的错误处理和回滚策略
4. **并行执行** - 支持无依赖子任务的并行执行
5. **进度反馈** - 向用户实时反馈任务执行进度

### 12.3 测试用例

建议编写以下测试：
- Router分类准确性测试
- Planner任务拆解合理性测试
- Supervisor依赖调度测试
- 错误重试机制测试

---

## 13. 参考资料

- [LangGraph 文档](https://langchain-ai.github.io/langgraphjs/)
- [LangChain.js Agent 概念](https://js.langchain.com/docs/concepts/agents)
- [Multi-Agent Patterns](https://blog.langchain.dev/manifesto/)
