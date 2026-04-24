import { BaseAgent } from "./baseAgent.ts";
import {
  AgentState,
  type RouterResult,
  type PlannerResult,
  type TaskResult,
} from "../../types/index.ts";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { Router } from "./router.ts";
import { Planner } from "./planner.ts";
import { Supervisor } from "./supervisor.ts";
export class MainAgent extends BaseAgent {
  private router: Router;
  private planner: Planner;
  private supervisor: Supervisor;
  constructor() {
    super({
      id: "main-agent",
      name: "MainAgent",
      systemPrompt: `你是知识管理系统的主控Agent。
你的职责是：
1. 分析用户意图，判断任务类型
2. 协调各个Worker Agent执行任务
3. 监控执行过程，处理异常
4. 汇总结果返回给用户`,
    });

    // 初始化三个组件
    this.router = new Router();
    this.planner = new Planner();
    this.supervisor = new Supervisor();
  }

  async execute(input: string): Promise<any> {
    this.setState(AgentState.RUNNING);

    try {
      // Step 1: Router - 分析意图，判断任务类型
      console.log("[MainAgent] 开始路由分析...");
      const routerResult: RouterResult = await this.router.route(input);
      console.log(
        `[MainAgent] 路由结果: ${routerResult.taskType}, 置信度: ${routerResult.confidence}`,
      );

      if (routerResult.taskType === "simple") {
        // Simple任务：直接执行（后续接入SimpleAgent）
        return await this.handleSimpleTask(input, routerResult);
      } else {
        // Complex任务：规划 + 执行
        return await this.handleComplexTask(input);
      }
    } catch (error) {
      await this.handleError(error as Error);
      throw error;
    } finally {
      this.setState(AgentState.COMPLETED);
    }
  }

  /**
   * 处理简单任务
   */
  private async handleSimpleTask(
    input: string,
    routerResult: RouterResult,
  ): Promise<any> {
    console.log(
      `[MainAgent] 处理简单任务，目标Agent: ${routerResult.targetAgent}`,
    );

    // 目前暂时用LLM直接响应
    const messages = [
      new SystemMessage(this.systemPrompt),
      new HumanMessage(input),
    ];
    const response = await this.llm.invoke(messages);
    return {
      type: "simple",
      result: response.content,
    };
  }

  /**
   * 处理复杂任务
   */
  private async handleComplexTask(input: string): Promise<any> {
    // Step 2: Planner - 任务规划
    console.log("[MainAgent] 开始任务规划...");
    const plannerResult: PlannerResult = await this.planner.plan(input);
    console.log(
      `[MainAgent] 规划完成，共${plannerResult.subtasks.length}个子任务`,
    );

    // Step 3: Supervisor - 执行监控
    console.log("[MainAgent] 开始执行监控...");
    const results: TaskResult[] = await this.supervisor.execute(
      plannerResult.subtasks,
    );

    // 汇总结果
    return {
      type: "complex",
      reasoning: plannerResult.reasoning,
      subtasks: plannerResult.subtasks,
      results: results,
    };
  }
}
