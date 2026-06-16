/**
 * SQL 查询网关
 *
 * 职责：
 * 1. 接收 SQL 查询请求
 * 2. 严格安全校验（白名单 + 黑名单）— 网关唯一安全边界
 * 3. 委托合适引擎执行（MySQL → 直连 DB；JSON → sql-parser 模拟）
 * 4. 自动追加 LIMIT 限制返回行数（防止大量数据拖垮 LLM）
 * 5. 返回结构化结果
 *
 * 设计原则：
 * - 同进程内嵌（演示项目），但接口契约按"独立服务"设计
 * - 未来可平滑拆分为独立进程/容器，路由层只换 baseURL
 * - 安全过滤是网关唯一职责，Agent/前端不重复实现
 *
 * 关于 SQL 解析器：
 * - 有 MySQL 时：网关不解析 SQL，校验后直接交给 DB 执行
 * - 无 MySQL（演示）：通过 JSON 引擎内的 sql-parser 模拟执行
 */

import { createEngine } from '../engines/index.js';
import { getSchema, getSchemaSync } from '../engines/json-engine.js';
import { SqlSafetyFilter } from './safety-filter.js';

class SqlGateway {
  constructor(db, options = {}) {
    this.db = db;
    this.engine = createEngine(db);
    this.maxRows = options.maxRows || 1000;
    this.timeoutMs = options.timeoutMs || 10000;
  }

  /**
   * 网关唯一入口：先校验再执行
   */
  async query({ sql, params = [], maxRows = null }) {
    const startTime = Date.now();
    const limit = maxRows || this.maxRows;

    // 1. 网关层做严格安全校验
    const validation = SqlSafetyFilter.validate(sql);
    if (!validation.valid) {
      return {
        success: false,
        error: 'SQL 安全校验失败',
        reason: validation.error,
        code: 'SQL_UNSAFE'
      };
    }

    // 2. 自动追加 LIMIT，防止返回过多数据
    let executionSql = sql;
    if (!/\bLIMIT\s+\d+/i.test(executionSql)) {
      executionSql = executionSql.trim().replace(/;?\s*$/, '') + ` LIMIT ${limit}`;
    }

    // 3. 执行（带超时）
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('查询超时')), this.timeoutMs);
    });

    try {
      const result = await Promise.race([
        this.engine.execute(executionSql, params),
        timeoutPromise
      ]);

      const duration = Date.now() - startTime;

      if (!result.success) {
        return {
          success: false,
          error: 'SQL 执行失败',
          reason: result.error,
          code: 'SQL_EXEC_ERROR',
          duration
        };
      }

      const data = result.data || [];
      const truncated = data.length >= limit;

      return {
        success: true,
        data,
        count: data.length,
        truncated,
        limit,
        duration,
        engine: this.db.type || 'json'
      };
    } catch (error) {
      return {
        success: false,
        error: 'SQL 执行失败',
        reason: error.message,
        code: error.message === '查询超时' ? 'SQL_TIMEOUT' : 'SQL_EXEC_ERROR',
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * 获取数据库 schema
   */
  async getSchema() {
    const pool = this.db.pool || null;
    const datasets = (global.uploadedDatasets && Object.keys(global.uploadedDatasets).length > 0)
      ? Object.values(global.uploadedDatasets)
      : [];
    return await getSchema({ pool, datasets, preferDynamic: true });
  }
}

let _gatewayInstance = null;

export function getSqlGateway(db) {
  if (!_gatewayInstance) {
    _gatewayInstance = new SqlGateway(db);
  }
  return _gatewayInstance;
}

export function resetSqlGateway() {
  _gatewayInstance = null;
}

export default SqlGateway;
