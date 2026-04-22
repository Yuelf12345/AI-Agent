import type { AgentContext, Task, StreamEvent } from '../../types/index.js';

interface PlanStep {
  id: string;
  description: string;
  tool?: string;
  params?: Record<string, unknown>;
  status: 'pending' | 'running' | 'completed' | 'failed';
  dependencies: string[];
}

interface Plan {
  id: string;
  steps: PlanStep[];
  createdAt: Date;
}

/**
 * 任务规划器
 * 将复杂任务分解为子任务
 */
export class Planner {
  private currentPlan: Plan | null = null;

  /**
   * 创建执行计划
   */
  async createPlan(context: AgentContext): Promise<Plan> {
    // TODO: 调用 LLM 进行任务分解
    // 这里是占位实现
    
    const plan: Plan = {
      id: crypto.randomUUID(),
      steps: [
        {
          id: 'step-1',
          description: 'Analyze user request',
          status: 'pending',
          dependencies: [],
        },
        {
          id: 'step-2',
          description: 'Retrieve relevant information',
          tool: 'note_search',
          params: { query: '' },
          status: 'pending',
          dependencies: ['step-1'],
        },
        {
          id: 'step-3',
          description: 'Generate response',
          status: 'pending',
          dependencies: ['step-2'],
        },
      ],
      createdAt: new Date(),
    };

    this.currentPlan = plan;
    return plan;
  }

  /**
   * 执行计划
   */
  async *executePlan(plan: Plan, context: AgentContext): AsyncGenerator<StreamEvent> {
    const executionOrder = this.topologicalSort(plan.steps);

    for (const step of executionOrder) {
      // 检查依赖是否完成
      const depsCompleted = step.dependencies.every(depId => {
        const dep = plan.steps.find(s => s.id === depId);
        return dep?.status === 'completed';
      });

      if (!depsCompleted) {
        step.status = 'failed';
        yield {
          type: 'error',
          code: 'DEPENDENCY_FAILED',
          message: `Dependencies not met for step ${step.id}`,
        };
        continue;
      }

      // 执行步骤
      step.status = 'running';
      yield {
        type: 'thought',
        content: `Executing: ${step.description}`,
      };

      try {
        // TODO: 实际执行步骤
        await new Promise(resolve => setTimeout(resolve, 100)); // 占位
        step.status = 'completed';
      } catch (error) {
        step.status = 'failed';
        yield {
          type: 'error',
          code: 'STEP_FAILED',
          message: error instanceof Error ? error.message : 'Step execution failed',
        };
      }
    }
  }

  /**
   * 拓扑排序，确定执行顺序
   */
  private topologicalSort(steps: PlanStep[]): PlanStep[] {
    const sorted: PlanStep[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (step: PlanStep) => {
      if (visited.has(step.id)) return;
      if (visiting.has(step.id)) {
        throw new Error('Circular dependency detected in plan');
      }

      visiting.add(step.id);
      
      for (const depId of step.dependencies) {
        const dep = steps.find(s => s.id === depId);
        if (dep) visit(dep);
      }

      visiting.delete(step.id);
      visited.add(step.id);
      sorted.push(step);
    };

    for (const step of steps) {
      visit(step);
    }

    return sorted;
  }

  /**
   * 获取当前计划
   */
  getCurrentPlan(): Plan | null {
    return this.currentPlan;
  }

  /**
   * 清除当前计划
   */
  clearPlan(): void {
    this.currentPlan = null;
  }
}

export default Planner;
