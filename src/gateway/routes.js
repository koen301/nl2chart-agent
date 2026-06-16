/**
 * SQL 网关 HTTP 路由
 *
 * 提供对外 RESTful 接口：
 * - POST /api/sql/query : 执行 SQL 查询
 * - GET  /api/sql/schema: 获取数据库 schema
 *
 * 设计原则：
 * - 路由层不直接做 SQL 校验和执行，全部委托给 sql-gateway
 * - 未来拆分为独立服务时，把此文件挂到独立 Express 实例即可
 */

import { getSqlGateway } from './sql-gateway.js';
import { schemaToText } from '../engines/json-engine.js';

export function registerGatewayRoutes(app, db) {
  /**
   * POST /api/sql/query
   * Body: { sql: string, params?: any[], maxRows?: number }
   */
  app.post('/api/sql/query', async (req, res) => {
    try {
      const { sql, params = [], maxRows } = req.body || {};

      if (!sql || typeof sql !== 'string') {
        return res.status(400).json({
          success: false,
          error: '缺少 sql 参数',
          code: 'MISSING_SQL'
        });
      }

      const gateway = getSqlGateway(db);
      const result = await gateway.query({ sql, params, maxRows });
      res.status(result.success ? 200 : 400).json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: '网关内部错误',
        reason: error.message
      });
    }
  });

  /**
   * GET /api/sql/schema
   * 可选查询参数 format=text 返回 schema 文本描述
   */
  app.get('/api/sql/schema', async (req, res) => {
    try {
      const gateway = getSqlGateway(db);
      const schema = await gateway.getSchema();
      if ((req.query.format || '').toString() === 'text') {
        return res.json({ success: true, text: schemaToText(schema) });
      }
      res.json({ success: true, schema });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });
}

export default registerGatewayRoutes;
