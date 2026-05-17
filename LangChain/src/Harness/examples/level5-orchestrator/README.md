# 层级5：Orchestrator-Workers（编排器-工作者）

## 概念

中央Orchestrator动态分解任务，分配给Workers执行，汇总结果。

```
输入 → Orchestrator → 分析并拆解
         ↓
    ┌→ Worker 1（处理文件A）
    ├→ Worker 2（处理文件B）
    └→ Worker 3（处理文件C）
         ↓
    汇总结果
```

## 与层级4的关键区别

| 层级4 | 层级5 |
|-------|-------|
| 子任务预先定义 | 子任务动态决定 |
| 固定Worker数量 | Worker数量根据输入变化 |
| 静态 | 动态 |

**这是最重要的区别！**

### 例子对比

**层级4（并行）：**
```
用户："分析这三个文件的代码质量"
系统：预先知道要分析3个文件
     → 启动3个Worker
```

**层级5（编排）：**
```
用户："修复这个Bug"
系统：不知道需要改几个文件
     → Orchestrator分析代码
     → 决定要改哪些文件（可能是1个，也可能是5个）
     → 动态分配Worker
```

## 适用场景

- 任务复杂度不可预测
- 需要改动的文件数量不确定
- 需要动态调整执行策略

### 典型例子

1. **编程任务**
   - 输入："修复这个Bug"
   - Orchestrator分析：需要改3个文件
   - 分配3个Worker执行

2. **搜索任务**
   - 输入："研究这个主题"
   - Orchestrator决定：需要查5个来源
   - 分配5个Worker搜索

## 本项目实现

参见：`src/harness/agents/mainAgent.ts`

```typescript
class MainAgent extends BaseAgent {
  async execute(input: string) {
    // 步骤1：Orchestrator分析
    const plan = await this.analyzeTask(input);

    // 步骤2：如果需要拆解
    if (plan.needSplit) {
      const results = await this.executeSubtasks(plan.subtasks);
      return this.synthesize(results);
    }

    // 步骤3：否则直接回复
    return plan.directResponse;
  }
}
```

## 架构设计

### Orchestrator职责
```typescript
interface Orchestrator {
  // 分析任务
  analyze(input: string): ExecutionPlan;

  // 决定是否拆解
  shouldSplit(input: string): boolean;

  // 汇总结果
  synthesize(results: Result[]): string;
}
```

### Worker职责
```typescript
interface Worker {
  name: string;
  capability: string[];

  // 执行具体任务
  execute(task: SubTask): Result;
}
```

## 与旧架构对比

| 旧架构（Router→Planner→Supervisor） | 新架构（MainAgent） |
|-------------------------------------|-------------------|
| 3个组件，3次LLM调用 | 1个组件，1次LLM调用 |
| 静态规划 | 动态调整 |
| 复杂状态管理 | 简单状态 |

## 关键设计要点

1. **动态任务分解**
   ```typescript
   // Orchestrator的Prompt
   systemPrompt: `
     分析用户任务：
     1. 需要几个步骤？
     2. 每个步骤做什么？
     3. 哪个Worker适合？

     输出JSON格式的执行计划。
   `
   ```

2. **灵活的Worker分配**
   ```typescript
   // 根据任务类型选择Worker
   const worker = this.selectWorker(task.assignedTo);
   ```

3. **结果汇总**
   ```typescript
   // LLM汇总多个Worker的结果
   const summary = await this.llm.invoke(
     `总结以下结果：${results.join("\n")}`
   );
   ```

## 学习要点

1. 这是真正"智能"的层级
2. Orchestrator是核心，需要精心设计Prompt
3. Worker可以复用层级1的SimpleAgent

## 下一步

当需要保证输出质量时，进入层级6：Evaluator-Optimizer
