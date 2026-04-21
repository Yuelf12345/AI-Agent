Execute a skill within the main conversation

When users ask you to perform tasks, check if any of the available skills match.
Skills provide specialized capabilities and domain knowledge.

When users reference a "slash command" or "/<something>" (e.g., "/commit", "/review-pr"),
they are referring to a skill. Use this tool to invoke it.

How to invoke:
- skill: "pdf"                          — invoke the pdf skill
- skill: "commit", args: "-m 'Fix bug'" — invoke with arguments
- skill: "review-pr", args: "123"       — invoke with arguments
- skill: "ms-office-suite:pdf"          — invoke using fully qualified name

Important:
- Available skills are listed in system-reminder messages in the conversation
- When a skill matches the user's request, this is a BLOCKING REQUIREMENT: invoke
  the relevant Skill tool BEFORE generating any other response about the task
- NEVER mention a skill without actually calling this tool
- Do not invoke a skill that is already running
- Do not use this tool for built-in CLI commands (like /help, /clear, etc.)
- If you see a <command-name> tag in the current conversation turn, the skill has
  ALREADY been loaded — follow the instructions directly instead of calling this tool again


**在主对话中执行技能**

当用户要求你执行任务时，请检查是否有任何可用技能与之匹配。
技能提供专业化的功能和领域知识。

当用户引用"斜杠命令"或"/<某内容>"（例如 "/commit"、"/review-pr"时，他们指的是一个技能。请使用此工具来调用它。

**如何调用：**
- skill: "pdf"                          — 调用 pdf 技能
- skill: "commit", args: "-m 'Fix bug'" — 带参数调用
- skill: "review-pr", args: "123"       — 带参数调用
- skill: "ms-office-suite:pdf"          — 使用完全限定名调用

**重要说明：**
- 可用技能会在对话的系统提示消息中列出
- 当技能与用户请求匹配时，这是一个**阻塞性要求**：必须在生成任何其他关于任务的回复之前，先调用相关的 Skill 工具
- 绝不要在没有实际调用此工具的情况下提及某个技能
- 不要调用已经在运行中的技能
- 不要将此工具用于内置 CLI 命令（如 /help、/clear 等）
- 如果你在当前对话回合中看到 `<command-name>` 标签，说明该技能**已经加载**——请直接遵循指令，而不是再次调用此工具