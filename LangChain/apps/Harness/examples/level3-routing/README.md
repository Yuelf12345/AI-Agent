# 层级3：Routing（路由）

## 概念

根据输入类型分类，路由到不同的处理流程。

```
        ┌→ 处理流程A（Prompt A + Tools A）
输入 → 分类
        └→ 处理流程B（Prompt B + Tools B）
```

## 与层级2的区别

| 层级2 | 层级3 |
|-------|-------|
| 所有输入走同一流程 | 不同输入走不同流程 |
| 固定步骤 | 分类后有分支 |

## 适用场景

- 任务有明显分类
- 不同类别需要不同的Prompt和工具

### 典型例子

**客服系统**
```
用户消息 → 分类
              ├→ 退款请求 → 退款处理流程
              ├→ 技术支持 → 技术支持Prompt
              └→ 一般咨询 → 问答Prompt
```

**模型路由（成本优化）**
```
问题 → 分类
         ├→ 简单问题 → 小模型（Claude Haiku）
         └→ 复杂问题 → 大模型（Claude Sonnet）
```

## 代码示例（待实现）

```typescript
class RoutingAgent {
  async execute(input: string) {
    // 步骤1：分类
    const category = await this.classify(input);

    // 步骤2：路由到不同处理流程
    switch (category) {
      case "refund":
        return await this.handleRefund(input);
      case "technical":
        return await this.handleTechnical(input);
      case "general":
        return await this.handleGeneral(input);
    }
  }

  private async classify(input: string): Promise<string> {
    // 可以用LLM分类
    // 也可以用传统分类器
    const response = await this.llm.invoke(
      `分类以下问题的类型（refund/technical/general）：${input}`
    );
    return response.category;
  }
}
```

## 关键设计

1. **分类器**
   ```typescript
   // 方案1：LLM分类
   const category = await llm.classify(input);

   // 方案2：规则分类
   if (input.includes("退款")) return "refund";

   // 方案3：传统ML模型
   const category = classifier.predict(input);
   ```

2. **分支处理**
   ```typescript
   interface Route {
     category: string;
     prompt: string;
     tools: Tool[];
   }
   ```

## 本项目旧架构对比

旧架构的 `Router` 组件就是层级3的实现：
- `src/harness/agents/router.ts`

但它只区分了 simple/complex，过于简单。

## 学习要点

1. 分类可以是LLM或传统方法
2. 每个分支可以有独立的Prompt和工具集
3. 分类错误会导致后续处理失败

## 下一步

当任务需要并行执行多个子任务时，进入层级4：Parallelization
