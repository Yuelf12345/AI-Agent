import Database from 'better-sqlite3';
import { config } from '../config/index.js';
import type { Note, Task, Conversation, Message } from '../types/index.js';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * SQLite 存储服务
 * 管理关系型数据的持久化
 */
export class StorageService {
  private db: Database.Database | null = null;
  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || config.storage.sqlite.path;
  }

  /**
   * 初始化数据库连接
   */
  async init(): Promise<void> {
    // 确保数据目录存在
    const dbDir = path.dirname(this.dbPath);
    await fs.mkdir(dbDir, { recursive: true });

    this.db = new Database(this.dbPath);
    this.createTables();
    console.log('[Storage] Database initialized:', this.dbPath);
  }

  /**
   * 创建数据表
   */
  private createTables(): void {
    if (!this.db) return;

    this.db.exec(`
      -- Notes 表
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT,
        tags TEXT, -- JSON array
        created_at TEXT,
        updated_at TEXT,
        embedding_id TEXT,
        file_path TEXT
      );

      -- Tasks 表
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        source TEXT,
        status TEXT,
        priority TEXT,
        due_date TEXT,
        extracted_by TEXT
      );

      -- Conversations 表
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT,
        created_at TEXT
      );

      -- Messages 表
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT,
        role TEXT,
        content TEXT,
        tool_calls TEXT, -- JSON
        tool_result TEXT, -- JSON
        timestamp TEXT,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id)
      );

      -- 索引
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_notes_tags ON notes(tags);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    `);
  }

  // ============ Note CRUD ============

  saveNote(note: Note): void {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO notes (id, title, content, tags, created_at, updated_at, embedding_id, file_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      note.id,
      note.title,
      note.content,
      JSON.stringify(note.tags),
      note.created_at.toISOString(),
      note.updated_at.toISOString(),
      note.embedding_id || null,
      note.file_path || null
    );
  }

  getNote(id: string): Note | undefined {
    if (!this.db) throw new Error('Database not initialized');

    const row = this.db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as any;
    if (!row) return undefined;

    return this.rowToNote(row);
  }

  getAllNotes(): Note[] {
    if (!this.db) throw new Error('Database not initialized');

    const rows = this.db.prepare('SELECT * FROM notes ORDER BY updated_at DESC').all() as any[];
    return rows.map(row => this.rowToNote(row));
  }

  deleteNote(id: string): boolean {
    if (!this.db) throw new Error('Database not initialized');
    
    const result = this.db.prepare('DELETE FROM notes WHERE id = ?').run(id);
    return result.changes > 0;
  }

  private rowToNote(row: any): Note {
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      tags: JSON.parse(row.tags || '[]'),
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
      embedding_id: row.embedding_id || undefined,
      file_path: row.file_path || undefined,
    };
  }

  // ============ Task CRUD ============

  saveTask(task: Task): void {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO tasks (id, content, source, status, priority, due_date, extracted_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      task.id,
      task.content,
      task.source,
      task.status,
      task.priority,
      task.due_date ? task.due_date.toISOString() : null,
      task.extracted_by
    );
  }

  getTasksByStatus(status: Task['status']): Task[] {
    if (!this.db) throw new Error('Database not initialized');

    const rows = this.db.prepare('SELECT * FROM tasks WHERE status = ?').all(status) as any[];
    return rows.map(row => ({
      id: row.id,
      content: row.content,
      source: row.source,
      status: row.status,
      priority: row.priority,
      due_date: row.due_date ? new Date(row.due_date) : null,
      extracted_by: row.extracted_by,
    }));
  }

  // ============ Conversation CRUD ============

  saveConversation(conversation: Conversation): void {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO conversations (id, title, created_at)
      VALUES (?, ?, ?)
    `);

    stmt.run(conversation.id, conversation.title, conversation.created_at.toISOString());
  }

  getConversation(id: string): Conversation | undefined {
    if (!this.db) throw new Error('Database not initialized');

    const row = this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as any;
    if (!row) return undefined;

    // 获取消息
    const messages = this.getMessages(id);

    return {
      id: row.id,
      title: row.title,
      messages,
      created_at: new Date(row.created_at),
    };
  }

  getAllConversations(): Array<{ id: string; title: string; created_at: Date }> {
    if (!this.db) throw new Error('Database not initialized');

    const rows = this.db.prepare('SELECT id, title, created_at FROM conversations ORDER BY created_at DESC').all() as any[];
    return rows.map(row => ({
      id: row.id,
      title: row.title,
      created_at: new Date(row.created_at),
    }));
  }

  // ============ Message CRUD ============

  saveMessage(conversationId: string, message: Message): void {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(`
      INSERT INTO messages (id, conversation_id, role, content, tool_calls, tool_result, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      message.id,
      conversationId,
      message.role,
      message.content,
      message.tool_calls ? JSON.stringify(message.tool_calls) : null,
      message.tool_result ? JSON.stringify(message.tool_result) : null,
      message.timestamp.toISOString()
    );
  }

  getMessages(conversationId: string): Message[] {
    if (!this.db) throw new Error('Database not initialized');

    const rows = this.db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp').all(conversationId) as any[];
    return rows.map(row => ({
      id: row.id,
      role: row.role,
      content: row.content,
      tool_calls: row.tool_calls ? JSON.parse(row.tool_calls) : undefined,
      tool_result: row.tool_result ? JSON.parse(row.tool_result) : undefined,
      timestamp: new Date(row.timestamp),
    }));
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

// 导出单例
export const storageService = new StorageService();

export default StorageService;
