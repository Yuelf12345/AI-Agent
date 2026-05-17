# 层级2：Prompt Chaining（提示链）

## 概念

将任务分解为固定的顺序步骤，每个步骤的输出作为下一个步骤的输入。

```
用户输入 → 步骤1 → gate → 步骤2 → gate → 步骤3 → 输出
```

## 与层级1的区别

| 层级1 | 层级2 |
|-------|-------|
| 单次LLM调用 | 多次LLM调用 |
| 无步骤概念 | 固定顺序步骤 |
| 无中间检查 | 步骤间有检查点 |

## 适用场景

- 任务可以明确分解为固定步骤
- 每个步骤依赖前一步骤的输出
- 需要在中间步骤进行验证

### 典型例子

1. **写文档**
   - 步骤1：生成大纲
   - gate：检查大纲是否符合要求
   - 步骤2：根据大纲写正文

2. **营销文案**
   - 步骤1：生成草稿
   - 步骤2：翻译成目标语言

## 代码示例（待实现）

```typescript
class PromptChainingAgent {
  async execute(input: string) {
    // 步骤1：生成大纲
    const outline = await this.step1_generateOutline(input);

    // 检查点：验证大纲
    if (!this.validateOutline(outline)) {
      throw new Error("大纲不符合要求");
    }

    // 步骤2：根据大纲写正文
    const content = await this.step2_writeContent(outline);

    return content;
  }
}
```

## 关键设计

1. **Gate（检查点）**
   ```typescript
   // 每个步骤后检查
   if (!this.validate(result)) {
     // 处理失败情况
     return this.retry();
   }
   ```

2. **步骤定义**
   ```typescript
   interface Step {
     name: string;
     prompt: string;
     validate?: (output: string) => boolean;
   }
   ```

## 学习要点

1. 步骤是**预定义的**，不是动态生成的
2. 每个步骤可以有自己的Prompt
3. 步骤间的检查点很重要

## 下一步

当任务有多种类型，需要选择不同处理路径时，进入层级3：Routing
