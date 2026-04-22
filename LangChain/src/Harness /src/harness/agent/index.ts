import { v4 as uuidv4 } from 'uuid';
import type { Message, AgentContext, StreamEvent, Conversation } from '../../types/index.js';
import { AgentStateManager } from './state.js';
import { ReActLoop } from './react.js';
import { Planner } from './planner.js';
import { IntentRouter } from './router.js';
import { skillRegistry } from '../skills/index.js';
import { toolRegistry } from '../tool/index.js';
import { builtinTools } from '../tool/builtin/index.js';

/**
 * Agent 主类
 * 协调各组件完成用户请求
 */
export class Agent {
  private stateManager: AgentStateManager;
  private reactLoop: ReActLoop;
  private planner: Planner;
  private router: IntentRouter;
  private initialized: boolean = false;

  constructor() {
    this.stateManager = new AgentStateManager();
    this.reactLoop = new ReActLoop();
    this.planner = new Planner();
    this.router = new IntentRouter();
  }

  /**
   * 初始化 Agent
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    // 注册内置 Tools
    toolRegistry.registerAll(builtinTools);

    // 加载内置 Skills
    const { skillLoader } = await import('../skills/loader.js');
    await skillLoader.loadBuiltin();

    this.initialized = true;
    console.log('[Agent] Initialized successfully');
  }

  /**
   * 处理用户消息
   */
  async *chat(
    message: string,
    conversationId?: string
  ): AsyncGenerator<StreamEvent> {
    // 确保初始化
    await this.init();

    // 创建上下文
    const context: AgentContext = {
      conversationId: conversationId || uuidv4(),
      messages: [
        {
          id: uuidv4(),
          role: 'user',
          content: message,
          timestamp: new Date(),
        },
      ],
      currentTask: null,
      toolResults: [],
      state: 'IDLE',
      activeSkills: [],
      metadata: {
        startTime: new Date(),
        turnCount: 1,
      },
    };

    this.stateManager.setContext(context);

    // 状态转换：IDLE -> ROUTING
    const routingEvent = this.stateManager.safeTransition('ROUTING');
    if (routingEvent) yield routingEvent;

    // 意图路由
    const userMessage = context.messages[0];
    yield* this.router.route(userMessage, context);

    // 根据路由结果执行
    const currentState = this.stateManager.getState();
    
    if (currentState === 'EXECUTING') {
      // 简单任务：直接执行 ReAct 循环
      yield* this.reactLoop.run(context);
    } else if (currentState === 'PLANNING') {
      // 复杂任务：先规划再执行
      const plan = await this.planner.createPlan(context);
      yield* this.planner.executePlan(plan, context);
    }

    // 生成最终响应
    const responseEvent = this.stateManager.safeTransition('RESPONDING');
    if (responseEvent) yield responseEvent;

    // TODO: 调用 LLM 生成最终响应
    yield {
      type: 'message',
      role: 'assistant',
      content: 'I have processed your request. (Response generation to be implemented with LLM)',
    };

    // 回到 IDLE 状态
    const idleEvent = this.stateManager.safeTransition('IDLE');
    if (idleEvent) yield idleEvent;
  }

  /**
   * 直接调用 Tool
   */
  async invokeTool(
    toolName: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    await this.init();
    return toolRegistry.execute(toolName, params);
  }

  /**
   * 获取可用的 Tools
   */
  getAvailableTools(): string[] {
    return toolRegistry.list();
  }

  /**
   * 获取激活的 Skills
   */
  getActiveSkills(): string[] {
    return skillRegistry.listActive();
  }

  /**
   * 获取当前状态
   */
  getState(): string {
    return this.stateManager.getState();
  }
}

// 导出单例
export const agent = new Agent();

export default Agent;
