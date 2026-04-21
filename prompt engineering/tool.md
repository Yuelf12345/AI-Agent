Fetches full schema definitions for deferred tools so they can be called.

Deferred tools appear by name in <available-deferred-tools> messages.

Until fetched, only the name is known — there is no parameter schema, so the
tool cannot be invoked. This tool takes a query, matches it against the deferred
tool list, and returns the matched tools' complete JSONSchema definitions inside
a <functions> block. Once a tool's schema appears in that result, it is callable
exactly like any tool defined at the top of the prompt.

Result format: each matched tool appears as one
<function>{"description": "...", "name": "...", "parameters": {...}}</function>
line inside the <functions> block — the same encoding as the tool list at the
top of this prompt.

Query forms:
- "select:Read,Edit,Grep"  — fetch these exact tools by name
- "notebook jupyter"        — keyword search, up to max_results best matches
- "+slack send"             — require "slack" in the name, rank by remaining terms

**获取延迟工具的完整模式定义，以便调用它们。**

延迟工具会以名称形式出现在 `<available-deferred-tools>` 消息中。

在获取之前，只知道名称——没有参数模式，因此无法调用该工具。此工具接受一个查询，将其与延迟工具列表进行匹配，并返回匹配工具的完整 JSONSchema 定义，放在 `<functions>` 区块中。一旦某个工具的模式出现在结果中，它就可以像提示顶部的任何工具一样被调用。

**结果格式：** 每个匹配的工具在 `<functions>` 区块中以一行
`<function>{"description": "...", "name": "...", "parameters": {...}}</function>`
的形式出现——与本提示顶部的工具列表编码方式相同。

**查询形式：**
- "select:Read,Edit,Grep"  — 按名称精确获取这些工具
- "notebook jupyter"        — 关键词搜索，返回最多 max_results 个最佳匹配
- "+slack send"             — 要求名称中包含 "slack"，按剩余关键词排序

AskUserQuestion 工具
**在执行过程中需要向用户提问时使用此工具。它允许你：**

1. 收集用户偏好或需求
2. 澄清模糊的指令
3. 在工作过程中获取关于实现选择的决策
4. 向用户提供方向选择

**使用说明：**
- 用户始终可以选择"其他"来提供自定义文本输入
- 使用 multiSelect: true 允许对一个问题选择多个答案
- 如果你推荐某个特定选项，请将其放在列表首位，并在标签末尾添加"（推荐）"

**计划模式说明：** 在计划模式下，请在最终确定计划**之前**使用此工具来澄清需求或在方法之间做出选择。**不要**使用此工具询问"我的计划准备好了吗？"或"我应该继续吗？"——请使用 ExitPlanMode 来处理这些问题。