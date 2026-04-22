import type { AgentState, AgentContext, Message, StreamEvent } from '../../types/index.js';

/**
 * Agent 状态管理
 */
export class AgentStateManager {
  private state: AgentState = 'IDLE';
  private context: AgentContext | null = null;

  getState(): AgentState {
    return this.state;
  }

  setState(newState: AgentState): StreamEvent | null {
    const oldState = this.state;
    this.state = newState;
    
    return {
      type: 'state_change',
      state: newState,
      content: `State changed from ${oldState} to ${newState}`,
    };
  }

  getContext(): AgentContext | null {
    return this.context;
  }

  setContext(context: AgentContext): void {
    this.context = context;
  }

  reset(): void {
    this.state = 'IDLE';
    this.context = null;
  }

  /**
   * 检查是否可以转换到目标状态
   */
  canTransitionTo(target: AgentState): boolean {
    const validTransitions: Record<AgentState, AgentState[]> = {
      'IDLE': ['ROUTING'],
      'ROUTING': ['PLANNING', 'EXECUTING'],
      'PLANNING': ['EXECUTING'],
      'EXECUTING': ['OBSERVING', 'WAITING_HUMAN', 'RESPONDING'],
      'OBSERVING': ['EXECUTING', 'RESPONDING'],
      'RESPONDING': ['IDLE'],
      'WAITING_HUMAN': ['EXECUTING', 'IDLE'],
    };

    return validTransitions[this.state]?.includes(target) ?? false;
  }

  /**
   * 安全转换状态
   */
  safeTransition(target: AgentState): StreamEvent | null {
    if (this.canTransitionTo(target)) {
      return this.setState(target);
    }
    console.warn(`[AgentState] Invalid transition from ${this.state} to ${target}`);
    return null;
  }
}

export type { AgentState, AgentContext, Message, StreamEvent };
