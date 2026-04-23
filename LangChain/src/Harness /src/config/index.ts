import dotenv from 'dotenv';

dotenv.config();

export interface Config {
  server: {
    port: number;
    host: string;
  };
  llm: {
    provider: 'ollama' | 'openai';
    ollama: {
      baseUrl: string;
      model: string;
      embeddingModel: string;
    };
    openai: {
      apiKey: string;
      model: string;
      embeddingModel: string;
    };
  };
  storage: {
    sqlite: {
      path: string;
    };
    chroma: {
      host: string;
      port: number;
    };
  };
  memory: {
    workingMemory: {
      maxTurns: number;
    };
    longTermMemory: {
      topK: number;
      threshold: number;
      decayFactor: number;
    };
  };
  notes: {
    basePath: string;
    autoIndex: boolean;
  };
}

export const config: Config = {
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    host: process.env.HOST || 'localhost',
  },
  llm: {
    provider: (process.env.LLM_PROVIDER as 'ollama' | 'openai') || 'ollama',
    ollama: {
      baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
      model: process.env.OLLAMA_MODEL || 'llama3.2',
      embeddingModel: process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text',
    },
    openai: {
      apiKey: process.env.OPENAI_API_KEY || '',
      model: process.env.OPENAI_MODEL || 'qwen-plus',
      embeddingModel: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
    },
  },
  storage: {
    sqlite: {
      path: process.env.SQLITE_PATH || './data/knowledge.db',
    },
    chroma: {
      host: process.env.CHROMA_HOST || 'localhost',
      port: parseInt(process.env.CHROMA_PORT || '8000', 10),
    },
  },
  memory: {
    workingMemory: {
      maxTurns: parseInt(process.env.MAX_MEMORY_TURNS || '10', 10),
    },
    longTermMemory: {
      topK: parseInt(process.env.RETRIEVAL_TOP_K || '5', 10),
      threshold: parseFloat(process.env.RETRIEVAL_THRESHOLD || '0.7'),
      decayFactor: parseFloat(process.env.DECAY_FACTOR || '0.95'),
    },
  },
  notes: {
    basePath: process.env.NOTES_BASE_PATH || './data/notes',
    autoIndex: process.env.AUTO_INDEX !== 'false',
  },
};

export default config;
