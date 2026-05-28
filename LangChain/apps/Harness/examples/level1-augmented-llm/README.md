# 层级1：Augmented LLM（增强的LLM）

## 概念

最基础的Agent构建块：LLM + 工具 + 记忆

```
┌─────────────┐
│     LLM     │
│  ┌───────┐  │
│  │ Tools │  │
│  └───────┘  │
│  ┌───────┐  │
│  │Memory │  │
│  └───────┘  │
└─────────────┘
```

## 适用场景

- 80%的问题都能用这个解决
- 单次工具调用
- 简单问答

## 本项目实现

参见：`src/harness/agents/simpleAgent.ts`

## 使用示例

```typescript
import { SimpleAgent } from "../agents/simpleAgent.ts";

const agent = new SimpleAgent();

// 简单问答
const result1 = await agent.execute("你好");

// 调用工具
const result2 = await agent.execute("读取package.json文件");
```

## 关键代码

```typescript
class SimpleAgent extends BaseAgent {
  async execute(input: string) {
    const messages = [
      new SystemMessage(this.systemPrompt),
      new HumanMessage(input)
    ];

    const response = await this.llm.invoke(messages);

    // 解析是否需要工具
    if (response.needTool) {
      return await this.callTool(response.toolName, response.toolParams);
    }

    return response.content;
  }
}
```

## 学习要点

1. 单次LLM调用
2. 让LLM自己决定是否需要工具
3. 无需复杂的任务规划

## 下一步

当任务需要多个固定步骤时，进入层级2：Prompt Chaining
