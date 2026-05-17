# 层级6：Evaluator-Optimizer（评估器-优化器）

## 概念

生成器产生输出，评估器检查质量，如果不满意则循环改进。

```
生成器 → 评估器 → 不满意 → 反馈 → 生成器
           ↓
         满意 → 输出
```

## 类比人类写作过程

```
草稿 → 自我审阅 → 修改 → 再审阅 → 再修改 → 最终版本
```

## 与层级5的区别

| 层级5 | 层级6 |
|-------|-------|
| 执行一次 | 可能执行多次 |
| 无质量检查 | 有质量评估 |
| 无反馈循环 | 有改进循环 |

## 适用场景

- 对输出质量要求高
- 有明确的评估标准
- 迭代改进有明显效果

### 典型例子

1. **文学翻译**
   ```
   翻译草稿 → 检查准确性 → 检查流畅度 → 修改 → 再检查 → ...
   ```

2. **复杂搜索**
   ```
   搜索结果 → 评估是否完整 → 不完整则继续搜索 → 汇总 → ...
   ```

3. **代码生成**
   ```
   生成代码 → 运行测试 → 测试失败 → 修改代码 → 再测试 → ...
   ```

## 代码示例（待实现）

```typescript
class EvaluatorOptimizerAgent {
  async execute(input: string) {
    let currentResult = "";
    let iterations = 0;
    const maxIterations = 3;

    // 初始生成
    currentResult = await this.generator(input);

    while (iterations < maxIterations) {
      // 评估
      const evaluation = await this.evaluator(currentResult, input);

      if (evaluation.passed) {
        // 评估通过
        return currentResult;
      }

      // 未通过，获取反馈
      const feedback = evaluation.feedback;

      // 根据反馈改进
      currentResult = await this.optimizer(
        currentResult,
        feedback,
        input
      );

      iterations++;
    }

    return currentResult;
  }
}
```

## 关键组件

### 1. Generator（生成器）
```typescript
async generate(input: string): Promise<string> {
  return await this.llm.invoke(`
    根据以下要求生成内容：
    ${input}

    直接输出结果。
  `);
}
```

### 2. Evaluator（评估器）
```typescript
async evaluate(result: string, criteria: string): Promise<Evaluation> {
  return await this.llm.invoke(`
    评估以下内容：

    内容：${result}
    标准：${criteria}

    输出JSON：
    {
      "passed": true/false,
      "score": 0-10,
      "feedback": "具体问题..."
    }
  `);
}
```

### 3. Optimizer（优化器）
```typescript
async optimize(result: string, feedback: string): Promise<string> {
  return await this.llm.invoke(`
    改进以下内容：

    原内容：${result}
    问题：${feedback}

    输出改进后的内容。
  `);
}
```

## 设计要点

### 1. 明确的评估标准
```typescript
interface EvaluationCriteria {
  accuracy: boolean;    // 准确性
  completeness: boolean; // 完整性
  fluency: boolean;     // 流畅性
  style: boolean;       // 风格
}
```

### 2. 防止无限循环
```typescript
// 必须设置最大迭代次数
const MAX_ITERATIONS = 3;

// 或者设置质量阈值
if (evaluation.score > 8) {
  return result; // 满意就停止
}
```

### 3. 反馈要具体
```typescript
// 好的反馈
"第二段缺少具体例子，建议添加一个案例说明"

// 坏的反馈
"内容不够好，请改进"
```

## 与单元测试的类比

```
Evaluator-Optimizer 就像 TDD（测试驱动开发）：

1. 写测试（定义评估标准）
2. 写代码（生成器生成）
3. 运行测试（评估器检查）
4. 修复失败（优化器改进）
5. 重复直到通过
```

## 学习要点

1. 需要明确的评估标准（否则无法判断好坏）
2. 反馈质量决定改进效果
3. 成本较高（可能多次LLM调用）
4. 适合对质量要求高的场景

## 成本权衡

```
单次生成：1次LLM调用

Evaluator-Optimizer：
- 生成：1次
- 评估：至少1次
- 优化：可能多次

总成本：可能是单次生成的3-5倍
```

## 下一步

当Agent需要完全自主决策时，进入层级7：Autonomous Agent
