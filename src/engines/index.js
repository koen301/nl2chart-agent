/**
 * 引擎工厂
 *
 * 根据 db.type 自动选择合适的执行引擎：
 * - 'mysql' → MySqlEngine（直接交给 DB 执行，无 SQL 解析）
 * - 'json'  → JsonEngine（演示用，内存模拟执行）
 *
 * db 是 src/db/index.js 的 initDB() 返回值，接口契约：
 *   { type, pool, query, getAll, getCount, close }
 *
 * 未来增加其他数据源（如 PG、ClickHouse）只需：
 * 1. 在 src/engines/ 下新建 xxx-engine.js
 * 2. 在 src/db/db.js 增加 type
 * 3. 在本文件加一个分支
 */

import { MySqlEngine } from './mysql-engine.js';
import { JsonEngine } from './json-engine.js';

export { MySqlEngine, JsonEngine };

export function createEngine(db) {
  if (db && db.type === 'mysql' && db.pool) {
    return new MySqlEngine(db.pool);
  }
  return new JsonEngine(db);
}
