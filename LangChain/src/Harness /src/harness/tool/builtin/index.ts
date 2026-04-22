export { fileTools, FileReadTool, FileWriteTool, FileListTool } from './file.js';
export { noteTools, NoteSearchTool, NoteCreateTool, NoteGetTool } from './note.js';
export { searchTools, WebSearchTool, TodoExtractTool, CalendarQueryTool } from './search.js';

import { fileTools } from './file.js';
import { noteTools } from './note.js';
import { searchTools } from './search.js';
import type { BaseTool } from '../base.js';

/**
 * 所有内置 Tools
 */
export const builtinTools: BaseTool[] = [
  ...fileTools,
  ...noteTools,
  ...searchTools,
];
