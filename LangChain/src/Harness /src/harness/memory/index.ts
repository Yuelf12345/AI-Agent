export { WorkingMemoryManager } from './working.js';
export { LongTermMemoryManager } from './longterm.js';

import { WorkingMemoryManager } from './working.js';
import { LongTermMemoryManager } from './longterm.js';

// 导出单例
export const workingMemory = new WorkingMemoryManager();
export const longTermMemory = new LongTermMemoryManager();
