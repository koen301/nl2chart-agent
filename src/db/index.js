/**
 * DB 模块入口
 *
 * 对外只暴露 initDB()，不要直接 import './db.js'
 *
 * 使用：
 *   import { initDB } from './db/index.js';
 *   const db = await initDB();
 *   // db.type === 'json' | 'mysql'
 *   // db.pool: MySQL 连接池（仅 mysql 模式）
 *   // db.query / db.getAll / db.getCount / db.close
 */

import { initDB } from './db.js';

export { initDB };
