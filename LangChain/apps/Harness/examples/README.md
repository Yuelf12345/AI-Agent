# 层级7：Autonomous Agent（自主Agent）

## 概念

Agent完全自主地规划、执行、检查、调整，直到完成任务。

```
用户目标 → Agent自主规划 → 执行 → 观察 → 调整 → 执行 → ... → 完成
```

## 与层级6的区别

| 层级6 | 层级7 |
|-------|-------|
| 有明确的任务 | 只有最终目标 |
| 固定流程 | 自主决定流程 |
| 预设迭代次数 | 自己决定何时停止 |

## 最大特点

**自主性**

```
层级1-6：你告诉Agent做什么

层级7：你告诉Agent目标，它自己决定怎么做
```

## 适用场景

- 目标明确，但路径不明确
- 需要多步骤决策
- 需要根据执行结果动态调整

### 典型例子

1. **SWE-bench任务**
   ```
   输入："修复这个GitHub Issue"
   Agent：
   1. 阅读Issue
   2. 分析代码
   3. 定位问题
   4. 编写修复
   5. 运行测试
   6. 如果失败，重新分析
   7. 提交PR
   ```

2. **Computer Use**
   ```
   输入："帮我在网上订一张去北京的火车票"
   Agent：
   1. 打开浏览器
   2. 搜索12306
   3. 登录账号
   4. 查询车次
   5. 选择座位
   6. 完成支付
   ```

## 核心循环

```typescript
while (!taskComplete && iterations < MAX_ITERATIONS) {
  // 1. 思考：当前状态，下一步做什么
  const thought = await this.think(currentState);

  // 2. 行动：执行动作
  const action = await this.act(thought.action);

  // 3. 观察：查看结果
  const observation = await this.observe(action);

  // 4. 更新状态
  currentState = this.updateState(observation);

  // 5. 判断是否完成
  taskComplete = this.checkCompletion(currentState);
}
```

## 代码框架（待实现）

```typescript
class AutonomousAgent {
  async execute(goal: string) {
    let state = { goal, steps: [], results: [] };
    let iterations = 0;

    while (!this.isComplete(state) && iterations < this.maxIterations) {
      // 思考
      const thought = await this.think(state);

      // 行动
      const result = await this.act(thought.action);

      // 观察
      state = this.update(state, thought, result);

      iterations++;
    }

    return this.summarize(state);
  }

  async think(state: State): Promise<Thought> {
    return await this.llm.invoke(`
      当前目标：${state.goal}
      已完成步骤：${state.steps.join("\n")}

      分析当前状态，决定下一步：
      1. 还需要做什么？
      2. 需要使用什么工具？
      3. 参数是什么？
    `);
  }

  async act(action: Action): Promise<Result> {
    if (action.type === "tool") {
      return await this.callTool(action.tool, action.params);
    } else if (action.type === "message") {
      return await this.sendMessage(action.message);
    }
  }
}
```

## 设计要点

### 1. 循环控制
```typescript
// 防止无限循环
const MAX_ITERATIONS = 20;

// 或者让LLM判断
const shouldContinue = await this.llm.invoke(
  "任务完成了吗？输出 yes/no"
);
```

### 2. 状态管理
```typescript
interface AgentState {
  goal: string;           // 原始目标
  steps: Step[];          // 已执行步骤
  currentTask: string;    // 当前任务
  results: Result[];      // 执行结果
  memories: Memory[];     // 记忆
}
```

### 3. 错误恢复
```typescript
try {
  const result = await this.act(action);
} catch (error) {
  // 记录错误
  state.errors.push(error);

  // 调整策略
  const newThought = await this.thinkOnError(state, error);
}
```

## 风险与控制

### 风险
1. **高成本**：可能执行很多次LLM调用
2. **累积错误**：一步错，步步错
3. **不可预测**：不知道Agent会做什么

### 控制
```typescript
// 1. 沙盒环境
const sandbox = new Sandbox();
await sandbox.execute(agent);

// 2. 权限控制
agent.setAllowedTools(["read_file", "write_file"]);
agent.setForbiddenTools(["bash", "delete"]);

// 3. 人工确认
if (action.dangerous) {
  const confirmed = await this.askHuman(action);
  if (!confirmed) {
    return this.think(state); // 重新思考
  }
}
```

## 本项目现状

暂未实现层级7，原因：
- 需要完善的沙盒环境
- 需要详细的风险控制
- 成本较高，不适合学习初期

## 学习建议

1. 先掌握层级1-5
2. 理解各层级的适用场景
3. 按需实现复杂度

## 总结：Claude的7个层级

| 层级 | 名称 | LLM调用 | 适用场景 |
|------|------|---------|----------|
| 1 | Augmented LLM | 1次 | 80%的问题 |
| 2 | Prompt Chaining | 多次（顺序） | 固定步骤任务 |
| 3 | Routing | 1次（分类）+ 1次 | 多种类型任务 |
| 4 | Parallelization | 1次（并行） | 独立子任务 |
| 5 | Orchestrator-Workers | 1次（动态） | 不可预测任务 |
| 6 | Evaluator-Optimizer | 多次（循环） | 高质量要求 |
| 7 | Autonomous Agent | 很多次 | 完全自主 |

## 记住Claude的话

> "Start with the simplest solution possible, and only increase complexity when needed."
