---
name: prompt-patterns
description: This skill should be used when the user asks about "prompt patterns", "prompt engineering", "how to write prompts", or discusses prompt design techniques. Provides common prompt patterns and best practices.
version: 1.0.0
---

# Prompt Patterns

提示工程常用模式与实践指南。

## 基础模式

### 1. 角色设定模式

给 AI 分配特定角色以获得更专业的回答。

**模板**：
```
你是一个{角色}，具有{专业技能}。
请帮我{任务描述}。
```

**示例**：
```
你是一个资深前端工程师，精通 React 和 TypeScript。
请帮我审查这段代码，关注性能和可维护性。
```

### 2. Few-shot 模式

通过示例教 AI 如何完成任务。

**模板**：
```
任务：{任务描述}

示例：
输入：{示例输入1}
输出：{示例输出1}

输入：{示例输入2}
输出：{示例输出2}

现在处理：
输入：{实际输入}
输出：
```

**示例**：
```
任务：将中文翻译成英文

示例：
输入：你好
输出：Hello

输入：谢谢
输出：Thank you

现在处理：
输入：再见
输出：
```

### 3. 思维链模式

引导 AI 逐步推理复杂问题。

**模板**：
```
请一步步思考以下问题：
{问题}

思考步骤：
1. 首先，分析问题...
2. 然后，考虑...
3. 最后，得出结论...
```

## 高级模式

### 4. 结构化输出模式

要求 AI 按特定格式输出。

**模板**：
```
请按以下 JSON 格式输出：
{
  "field1": "描述",
  "field2": "描述"
}
```

### 5. 自我反思模式

让 AI 检查和改进自己的回答。

**模板**：
```
请回答：{问题}

回答后，请检查：
1. 回答是否完整？
2. 是否有逻辑错误？
3. 是否可以改进？

如有问题，请重新回答。
```

## 最佳实践

- **清晰具体**：避免模糊的指令
- **提供上下文**：给足够的背景信息
- **设置约束**：明确输出格式和长度限制
- **迭代优化**：根据结果调整提示词

## 注意事项

- 不同模型对提示词的敏感度不同
- 复杂任务优先使用思维链
- 敏感信息不要放入提示词

## 相关资源

- [OpenAI Prompt Engineering Guide](https://platform.openai.com/docs/guides/prompt-engineering)
- [Learn Prompting](https://learnprompting.org/)
