import { z } from 'zod';

// ============ Note Types ============
export interface Note {
  id: string;
  title: string;
  content: string;
  tags: string[];
  created_at: Date;
  updated_at: Date;
  embedding_id?: string;
  file_path?: string;
}

// ============ Task Types ============
export type TaskStatus = 'todo' | 'doing' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high';

export interface Task {
  id: string;
  content: string;
  source: string;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: Date | null;
  extracted_by: string;
}

// ============ Conversation Types ============
export type MessageRole = 'user' | 'assistant' | 'tool';

export interface ToolCall {
  tool: string;
  parameters: Record<string, unknown>;
}

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  tool_calls?: ToolCall[];
  tool_result?: unknown;
  timestamp: Date;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  created_at: Date;
}

// ============ Tool Types ============
export interface ToolParameter {
  type: string;
  description?: string;
  enum?: string[];
}

export interface ToolSchema {
  type: 'object';
  properties: Record<string, ToolParameter>;
  required?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolSchema;
  handler: string;
  permissions?: string[];
  local_only?: boolean;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export type ToolExecutor = (params: Record<string, unknown>) => Promise<ToolResult>;

// ============ Skill Types ============
export type SkillState = 'REGISTERED' | 'ACTIVE' | 'SUSPENDED' | 'DEPRECATED';

export interface SkillTrigger {
  intent?: string[];
  keywords?: string[];
}

export interface SkillRule {
  name: string;
  condition: string | RegExp | ((context: SkillContext) => boolean);
  action: string | ((context: SkillContext) => Promise<void>);
  priority?: number;
}

export interface SkillContext {
  note?: Note;
  task?: Task;
  message?: Message;
  conversation?: Conversation;
  [key: string]: unknown;
}

export interface SkillDefinition {
  name: string;
  description: string;
  domain: string;
  triggers: SkillTrigger[];
  rules: SkillRule[];
  tools: string[];
  priority: number;
  state?: SkillState;
}

// ============ Agent Types ============
export type AgentState = 
  | 'IDLE'
  | 'ROUTING'
  | 'PLANNING'
  | 'EXECUTING'
  | 'OBSERVING'
  | 'RESPONDING'
  | 'WAITING_HUMAN';

export interface AgentContext {
  conversationId: string;
  userId?: string;
  messages: Message[];
  currentTask: Task | null;
  toolResults: ToolResult[];
  state: AgentState;
  activeSkills: SkillDefinition[];
  metadata: {
    startTime: Date;
    turnCount: number;
  };
}

// ============ Memory Types ============
export interface WorkingMemory {
  conversationId: string;
  messages: Message[];
  currentTask: Task | null;
  toolResults: ToolResult[];
  metadata: {
    startTime: Date;
    turnCount: number;
  };
}

export interface LongTermMemoryEntry {
  id: string;
  content: string;
  embedding?: number[];
  metadata: {
    type: 'note' | 'conversation' | 'preference';
    source_id: string;
    created_at: Date;
    tags?: string[];
    [key: string]: unknown;
  };
}

// ============ Event Types ============
export type EventType = 
  | 'thought'
  | 'tool_call'
  | 'tool_result'
  | 'message'
  | 'error'
  | 'state_change'
  | 'skill_activated';

export interface StreamEvent {
  type: EventType;
  content?: string;
  tool?: string;
  parameters?: Record<string, unknown>;
  result?: unknown;
  code?: string;
  message?: string;
  state?: AgentState;
  skill?: string;
}

// ============ API Types ============
export const ChatRequestSchema = z.object({
  message: z.string(),
  conversation_id: z.string().optional(),
});

export const ToolInvokeRequestSchema = z.object({
  tool_name: z.string(),
  parameters: z.record(),
});

export const NoteSearchRequestSchema = z.object({
  q: z.string(),
  tags: z.array(z.string()).optional(),
});

export type ChatRequest = z.infer<typeof ChatRequestSchema>;
export type ToolInvokeRequest = z.infer<typeof ToolInvokeRequestSchema>;
export type NoteSearchRequest = z.infer<typeof NoteSearchRequestSchema>;
