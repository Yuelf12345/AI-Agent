# GPT Researcher 多 Agent 系统代码阅读笔记

> 学习方式：三关通关制 — 先读代码，再用问答验证理解
> 项目地址：https://github.com/assafelovic/gpt-researcher

---

## 一、整体架构概览

GPT Researcher 的多 Agent 系统基于 **LangGraph StateGraph** 构建，采用**三层嵌套**的设计：

```
外层 Orchestrator 图
    browser → planner → human → researcher → writer → fact_checker → visualizer → publisher
                                        │
内层子图（每节并行 × N 个 section）  ────┘
    researcher → reviewer → reviser（Review-Revise 循环直到通过）
```

核心思路：一个 Orchestrator（总指挥）站在流程外面调度，不当事图里的节点。8 个 Agent 各司其职，通过共享状态传递数据。

---

## 二、第一关：Orchestrator — 总指挥如何编排团队

**文件**：`multi_agents/agents/orchestrator.py`（146 行）

### ChiefEditorAgent 的角色

它不在 StateGraph 里当节点，而是站在外面做三件事：

```python
class ChiefEditorAgent:
    def init_research_team(self):    # 1. 初始化 Agent + 创建 Workflow
    def _create_workflow(self, agents):  # 2. 添加节点和边
    async def run_research_task(self):   # 3. 编译 + 执行
```

### 图的结构

```python
workflow = StateGraph(ResearchState)  # 用 ResearchState 作为共享状态

# 注册节点
workflow.add_node("browser", research_agent.run_initial_research)
workflow.add_node("planner", editor_agent.plan_research)
workflow.add_node("researcher", editor_agent.run_parallel_research)  # 🔥 这里是子图入口
workflow.add_node("writer", writer_agent.run)
workflow.add_node("fact_checker", fact_checker_agent.run)
workflow.add_node("visualizer", visualizer_agent.run)
workflow.add_node("publisher", publisher_agent.run)
workflow.add_node("human", human_agent.review_plan)

# 添加有向边
workflow.add_edge('browser', 'planner')
workflow.add_edge('planner', 'human')
workflow.add_edge('researcher', 'writer')
workflow.add_edge('writer', 'fact_checker')
workflow.add_edge('visualizer', 'publisher')
workflow.set_entry_point("browser")
workflow.add_edge('publisher', END)
```

### 关键设计：三层条件边

#### 1️⃣ Human-in-the-Loop

```python
workflow.add_conditional_edges(
    'human',
    lambda state: ("accept" if state['human_feedback'] is None
                   else "force_accept" if state.get('revisions_count', 0) >= MAX_REVISIONS
                   else "revise"),
    {"accept": "researcher", "force_accept": "researcher", "revise": "planner"}
)
```

三种结果，两种走向：
- **accept**（用户没意见）→ 直接去 `researcher` 深度研究
- **force_accept**（改太多回了，MAX_REVISIONS=5 → 强制通过）→ 也是 `researcher`
- **revise**（用户有意见）→ 回 `planner` 重新规划大纲

`force_accept` 是一个**防死循环的逃生舱**。

#### 2️⃣ Fact Checker 循环

```python
workflow.add_conditional_edges(
    'fact_checker',
    lambda draft: "accept" if draft.get("fact_check_notes") is None else "revise",
    {"accept": "visualizer", "revise": "writer"}
)
```

事实核查通过 → 图表生成，不通过 → 回 writer 重写。

### 共享状态持久化

```python
config = {"configurable": {
    "thread_id": task_id,          # 会话 ID
    "thread_ts": datetime.utcnow() # 时间戳
}}
result = await chain.ainvoke({"task": self.task}, config=config)
```

LangGraph 自动根据 `thread_id` 保存 checkpoint，支持流程中断恢复和状态回放。对比手写的 `ChatMemory[]` 数组，这是框架级的自动持久化。

### 🙋 提问

1. 这个系统用的是 LangGraph 的什么图模型？它用什么数据结构作为共享状态？
2. `human` 节点后面连接的是什么类型的边？有几个条件分支，分别走向哪里？
3. `fact_checker` 节点后面的条件边根据什么判断是 `accept` 还是 `revise`？
4. `_initialize_agents()` 注册了几个 Agent 节点？和 README 说的 8 个 Agent 有什么关系？
5. `chain.ainvoke` 传的 `config` 参数（`thread_id` 等）是做什么用的？

---

## 三、第二关：Subgraph — 每节的深度研究循环

**文件**：`multi_agents/agents/editor.py`（168 行）

### Editor 的两个职责

`EditorAgent` 既是图里的一个节点，又内部嵌了一个子图。

#### 职责 1：plan_research — 规划大纲

```python
async def plan_research(self, research_state):
    # 基于初始调研结果 + 人工反馈，生成大纲
    prompt = self._create_planning_prompt(
        initial_research, include_human_feedback,
        human_feedback, max_sections)
    plan = await call_model(prompt=prompt, response_format="json")
    return {"title": plan.title, "sections": plan.sections}
```

输出示例：
```json
{
  "title": "AI Agent 市场分析报告",
  "date": "30/06/2026",
  "sections": ["市场规模", "技术趋势", "竞争格局", "投资机会"]
}
```

#### 职责 2：run_parallel_research — 并行深度研究

```python
async def run_parallel_research(self, research_state):
    agents = self._initialize_agents()
    workflow = self._create_workflow()
    chain = workflow.compile()

    queries = research_state.get("sections")
    # 每个 section 启动一个独立子图，并行执行
    final_drafts = [chain.ainvoke(...) for query in queries]  # 创建协程
    research_results = [result["draft"] for result in await asyncio.gather(*final_drafts)]  # 真正并行

    return {"research_data": research_results}
```

### 子图的 Review-Revise 三角循环

```python
workflow = StateGraph(DraftState)
workflow.add_node("researcher", research_agent.run_depth_research)
workflow.add_node("reviewer", reviewer_agent.run)
work.add_node("reviser", reviser_agent.run)

workflow.set_entry_point("researcher")
workflow.add_edge("researcher", "reviewer")
workflow.add_edge("reviser", "reviewer")
workflow.add_conditional_edges(
    "reviewer",
    lambda draft: "accept" if draft["review"] is None else "revise",
    {"accept": END, "revise": "reviser"},
)
```

流程：
```
researcher（深度研究）
    ↓
reviewer（审核 → review=None 则通过，否则返回修改意见）
    ↓              ↙
reviser（根据意见修改 → 回到 reviewer）
```

这个模式称为 **Agentic Review-Revise Loop**，是当前最主流的 AI 生成质量保障方法。

### 关键设计点

1. **外层图套内层子图** — 每个 section 独立走 Review-Revise 循环，互不干扰
2. **并行执行** — `asyncio.gather` 让 N 个 section 同时研究，而非串行
3. **状态隔离** — 子图用 DraftState，外层用 ResearchState，数据解耦

### 🙋 提问

1. `EditorAgent` 的两个方法 `plan_research` 和 `run_parallel_research` 分别做什么？执行顺序是怎样的？
2. 子图包含哪几个节点？执行流程是怎样的？循环如何终止？
3. 多个 section 的研究任务是串行还是并行执行的？用到了哪个 Python 关键字？
4. Orchestrator 的 `_initialize_agents` 注册了 7 个 Agent，`EditorAgent` 的 `_initialize_agents` 又注册了哪几个？它们之间是什么包含关系？

---

## 四、第三关：Individual Agents — 个体 Agent 的实现

### Reviewer — 质量把关者

**文件**：`multi_agents/agents/reviewer.py`（79 行）

```python
class ReviewerAgent:
    async def review_draft(self, draft_state):
        # 基于 guidelines 审核稿子
        # 如果通过了 → 返回 None
        # 如果没通过 → 返回修改意见
        if "None" in response:
            return None
        return response

    async def run(self, draft_state):
        if not task.get("follow_guidelines"):
            return {"review": None}  # 跳过审核
        review = await self.review_draft(draft_state)
        return {"review": review}
```

**防死循环设计**：如果 `revision_notes` 不为空（已经改过一轮了），prompt 会要求 Reviewer "除非是致命问题，否则直接返回 None"：

```python
revise_prompt = """...Please provide additional feedback ONLY if critical 
since the reviser has already made changes based on your previous feedback.
If you think the article is sufficient or that non critical revisions are 
required, please aim to return None."""
```

### Researcher — 研究执行者

**文件**：`multi_agents/agents/researcher.py`（58 行）

两个方法，对应不同阶段：

```python
class ResearchAgent:
    # 1. 初始调研（外层图 browser 节点）
    async def run_initial_research(self, research_state):
        topic = task.get("query")
        return {"initial_research": await self.research(query=topic)}

    # 2. 深度调研（子图 researcher 节点）
    async def run_depth_research(self, draft_state):
        topic = draft_state.get("topic")
        parent_query = task.get("query")
        research_draft = await self.run_subtopic_research(
            parent_query=parent_query, subtopic=topic)
        return {"draft": research_draft}
```

底层调用的是 `GPTResearcher` 单 Agent 类：
- `conduct_research()` — 搜索 + 爬取
- `write_report()` — LLM 生成报告

### 🙋 提问

1. Reviewer 在什么条件下返回 `None`（通过）？什么条件下返回具体修改意见（返修）？
2. Reviewer 的 `run` 方法中什么情况下会跳过审核直接返回 `{"review": None}`？
3. `run_initial_research` 和 `run_depth_research` 分别在哪个节点被调用？有什么区别？
4. Reviewer 的 `review_draft` 方法中，如果 `revision_notes` 不为空，prompt 多塞了一段什么内容？目的是什么？
5. ResearcherAgent 底层调用了 `GPTResearcher` 类。这个类提供哪两个核心方法？

---

## 五、收获的关键模式

### 1. StateGraph 嵌套

外层 Orchestrator 图管理流程，内层子图处理每个 section 的详细研究。图结构比手写循环更清晰，因为"下一个节点是什么"是声明式的（图结构）而非命令式的（if-else）。

### 2. Review-Revise 质量环

两个专用 Agent 分别负责挑错和改错，比让同一个 LLM 既做生成又做自我检查更可靠。这是目前最主流的 AI 生成质量保障方法。

### 3. HITL 的三分支

不是简单的"中断 vs 继续"，而是 `accept / force_accept / revise` 三个分支，包含逃生舱机制。

### 4. 并行子任务

`asyncio.gather` + LangGraph 子图 = 多个独立任务同时执行，互不干扰。适用于"多 section 独立研究"、"多个文档同时处理"等场景。

### 5. Orchestrator 模式

总指挥站在流程外调度，不进图当节点。对比让一个"超级 Agent"自己做所有决策，Orchestrator 模式让流程更透明、每个步骤可审计。