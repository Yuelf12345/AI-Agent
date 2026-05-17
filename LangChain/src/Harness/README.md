# Harness 多Agent架构学习项目

## 项目定位

这是一个**学习导向**的AI Agent项目，目标是理解和实践Claude推荐的7个Agent架构层级。

---

## Claude的7层架构模型

根据Anthropic官方文章《Building Effective AI Agents》，Agent系统分为7个层级：

```
层级1: Augmented LLM（增强的LLM）        ← 最简单，适合80%场景
层级2: Prompt Chaining（提示链）
层级3: Routing（路由）
层级4: Parallelization（并行化）
层级5: Orchestrator-Workers（编排器）
层级6: Evaluator-Optimizer（评估优化）
层级7: Autonomous Agent（完全自主）      ← 最复杂，成本最高
```

### 选择决策树

```
问题来了
  ↓
能单次LLM解决？ → 是 → 用层级1
  ↓否
任务有固定步骤？ → 是 → 用层级2
  ↓否
任务有多种类型？ → 是 → 用层级3
  ↓否
需要并行执行？ → 是 → 用层级4
  ↓否
子任务不确定？ → 是 → 用层级5
  ↓否
需要质量保证？ → 是 → 用层级6
  ↓否
需要完全自主？ → 是 → 用层级7
```

---

## 本项目实现状态

| 层级 | 名称 | 实现状态 | 代码位置 |
|------|------|---------|----------|
| 1 | Augmented LLM | ✅ 已实现 | `agents/simpleAgent.ts` |
| 2 | Prompt Chaining | ⏳ 待实现 | `examples/level2-prompt-chaining/` |
| 3 | Routing | ⏳ 待实现 | `examples/level3-routing/` |
| 4 | Parallelization | ⏳ 待实现 | `examples/level4-parallelization/` |
| 5 | Orchestrator-Workers | ✅ 已实现 | `agents/mainAgent.ts` |
| 6 | Evaluator-Optimizer | ⏳ 待实现 | `examples/level6-evaluator/` |
| 7 | Autonomous Agent | ⏸ 暂不实现 | 成本高，需沙盒环境 |

---

## 目录结构

```
LangChain/src/Harness/
├── src/harness/
│   ├── agents/
│   │   ├── baseAgent.ts         # Agent基类
│   │   ├── mainAgent.ts         # 层级5：Orchestrator
│   │   ├── simpleAgent.ts       # 层级1：Augmented LLM
│   │   ├── router.ts            # 旧架构（保留对比）
│   │   ├── planner.ts           # 旧架构（保留对比）
│   │   └── supervisor.ts        # 旧架构（保留对比）
│   └── tools/
│       ├── baseTool.ts
│       ├── fileTool.ts
│       └── registry.ts
├── examples/                     # 学习示例
│   ├── README.md                 # 7层架构总览
│   ├── level1-augmented-llm/
│   ├── level2-prompt-chaining/
│   ├── level3-routing/
│   ├── level4-parallelization/
│   ├── level5-orchestrator/
│   └── level6-evaluator/
└── md/
    └── multi-agent-design.md     # 详细设计文档
```

---

## 学习路径建议

### 阶段1：理解基础（层级1）
1. 阅读 `examples/level1-augmented-llm/README.md`
2. 运行 `test-simple-agent.ts`
3. 理解：单次LLM调用 + 工具

### 阶段2：学习拆解（层级2-3）
1. 实现层级2：固定步骤任务
2. 实现层级3：分类路由
3. 对比：旧架构的Router组件

### 阶段3：并行与编排（层级4-5）
1. 实现层级4：并行执行
2. 研读层级5：Orchestrator实现
3. 对比：旧架构的Planner+Supervisor

### 阶段4：质量与自主（层级6-7）
1. 实现层级6：评估优化循环
2. 了解层级7：完全自主的风险

---

## 旧架构 vs 新架构对比

### 旧架构（Router→Planner→Supervisor）

```
用户输入 → Router（意图识别）
            ↓
         Planner（任务规划）
            ↓
      Supervisor（执行监控）
            ↓
         Workers（具体执行）
```

**问题：**
- 过度设计（一开始就设计复杂架构）
- 3次LLM调用（高成本）
- 9个状态（维护困难）

### 新架构（MainAgent编排）

```
用户输入 → MainAgent（一次完成分析和规划）
            ↓
         Workers（按需执行）
            ↓
         汇总结果
```

**优点：**
- 1次LLM调用（低成本）
- 4个核心状态（简单清晰）
- 符合Claude推荐

---

## 核心学习点

### 1. 为什么旧架构过度设计？

参见：`examples/level5-orchestrator/README.md`

关键理解：
- Router+Planner+Supervisor三层分离是**静态规划**思维
- Orchestrator一次LLM调用就能完成所有判断

### 2. 为什么保持简单？

Claude的建议：
> "Success in the LLM space isn't about building the most sophisticated system. It's about building the **right system** for your needs."

翻译：
> 成功不是构建最复杂的系统，而是构建**合适的系统**。

### 3. 渐进式增加复杂度

正确的做法：
```
第1周：用层级1解决80%问题
第2周：遇到困难，实现层级2
第3周：需要分类，实现层级3
...
```

错误的做法：
```
第1天：设计Router+Planner+Supervisor架构
（过度设计）
```

---

## 测试运行

### 测试层级1（SimpleAgent）
```bash
cd LangChain/src/Harness
npx tsx test-simple-agent.ts
```

### 测试层级5（MainAgent）
```bash
npx tsx test-main-agent.ts
```

---

## 参考资料

1. **Anthropic官方文章**：[Building Effective AI Agents](https://www.anthropic.com/research/building-effective-agents)
2. **LangChain文档**：[Agent概念](https://js.langchain.com/docs/concepts/agents)
3. **本项目详细设计**：`md/multi-agent-design.md`

---

## 总结

这个项目的价值：
- ✅ 理解Claude推荐的7层架构
- ✅ 对比旧架构的过度设计
- ✅ 学习渐进式开发方法
- ✅ 掌握各层级适用场景

**记住：Start simple, add complexity only when needed!**
