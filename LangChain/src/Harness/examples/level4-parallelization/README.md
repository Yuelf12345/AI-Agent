# 层级4：Parallelization（并行化）

## 概念

同时执行多个独立任务，然后汇总结果。

```
      ┌→ Worker 1 ─┐
输入 →├→ Worker 2 ─┼→ 汇总结果
      └→ Worker 3 ─┘
```

## 两种模式

### 1. Sectioning（分区）

将任务拆分为独立部分并行执行。

```
输入："分析这三个文件的代码质量"
       ↓
    ┌→ 分析file1.ts ─┐
    ├→ 分析file2.ts ─┼→ 汇总报告
    └→ 分析file3.ts ─┘
```

### 2. Voting（投票）

多次执行同一任务，投票选择最佳结果。

```
输入："这段代码有安全漏洞吗？"
       ↓
    ┌→ 检查员1：无漏洞 ─┐
    ├→ 检查员2：有漏洞 ─┼→ 投票结果
    └→ 检查员3：无漏洞 ─┘
            ↓
         结果：无漏洞（2:1）
```

## 与层级3的区别

| 层级3 | 层级4 |
|-------|-------|
| 选择一个分支 | 同时执行多个分支 |
| 串行 | 并行 |

## 适用场景

- 任务可以拆分为独立部分
- 需要提高速度
- 需要多视角验证

### 典型例子

1. **代码审查（多视角）**
   ```typescript
   const results = await Promise.all([
     securityReviewer.check(code),
     styleReviewer.check(code),
     performanceReviewer.check(code)
   ]);
   ```

2. **内容审核（投票）**
   ```typescript
   const votes = await Promise.all([
     this.checkPerspective1(content),
     this.checkPerspective2(content),
     this.checkPerspective3(content)
   ]);
   const isSafe = this.majorityVote(votes);
   ```

## 代码示例（待实现）

```typescript
class ParallelAgent {
  async execute(input: string) {
    // 并行执行
    const results = await Promise.all([
      this.worker1.execute(input),
      this.worker2.execute(input),
      this.worker3.execute(input)
    ]);

    // 汇总结果
    return this.aggregate(results);
  }

  // 投票模式
  async vote(input: string) {
    const votes = await Promise.all([
      this.judge1(input),
      this.judge2(input),
      this.judge3(input)
    ]);

    // 多数决定
    return this.majorityVote(votes);
  }
}
```

## 关键设计

1. **任务拆分**
   ```typescript
   interface Task {
     id: string;
     worker: string;
     params: any;
   }

   const tasks = this.splitTask(input);
   ```

2. **并行执行**
   ```typescript
   // 使用Promise.all
   const results = await Promise.all(
     tasks.map(t => this.executeTask(t))
   );
   ```

3. **结果汇总**
   ```typescript
   // 方案1：简单拼接
   return results.join("\n");

   // 方案2：LLM汇总
   return await this.llm.invoke(
     `总结以下结果：${results.join("\n")}`
   );
   ```

## 学习要点

1. 子任务必须**真正独立**，否则会出问题
2. 使用 `Promise.all` 实现并行
3. 结果汇总是关键步骤

## 与层级5的区别

| 层级4 | 层级5 |
|------|------|
| 子任务预定义 | 子任务动态决定 |
| 固定数量的Worker | 根据输入决定Worker数量 |

## 下一步

当子任务数量和类型无法预先确定时，进入层级5：Orchestrator-Workers
