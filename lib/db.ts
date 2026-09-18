import { Pool, PoolClient } from 'pg';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set. Please configure your .env file.');
    }
    pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }
  return pool;
}

/** SQL 参数类型（数组用于 ILIKE ANY($n::text[]) 这类场景） */
export type QueryParam = string | number | boolean | null | string[];

export async function query<T extends Record<string, any>>(
  text: string,
  params?: QueryParam[]
): Promise<T[]> {
  const client = await getPool().connect();
  try {
    const result = await client.query<T>(text, params);
    return result.rows;
  } finally {
    client.release();
  }
}

/** 执行写操作，返回受影响行数（用于判断是否存在/是否生效） */
export async function execute(
  text: string,
  params?: QueryParam[]
): Promise<number> {
  const client = await getPool().connect();
  try {
    const result = await client.query(text, params);
    return result.rowCount ?? 0;
  } finally {
    client.release();
  }
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export interface DocumentRecord {
  id: string;
  title: string;
  source_type: string;
  content: string;
  chunk_count: number;
  created_at: string;
}

export interface ChunkRecord {
  id: string;
  document_id: string;
  content: string;
  chunk_index: number;
}

export interface ChatRecord {
  id: string;
  question: string;
  answer: string;
  sources: string[];
  created_at: string;
}
