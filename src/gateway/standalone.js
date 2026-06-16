/**
 * SQL 网关 - 独立服务启动入口
 *
 * 用途：
 * - 演示项目：与主应用同进程（由 src/index.js 加载路由）
 * - 生产环境：可独立部署为独立服务（直接 node src/gateway/standalone.js）
 *
 * 启动方式：
 *   GATEWAY_PORT=4000 node src/gateway/standalone.js
 */

import express from 'express';
import { registerGatewayRoutes } from './routes.js';
import { initDB } from '../db/db.js';

const PORT = parseInt(process.env.GATEWAY_PORT || '3000', 10);
const DB_TYPE = process.env.DB_TYPE || 'json';

async function main() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  const db = await initDB();
  registerGatewayRoutes(app, db);

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'sql-gateway', port: PORT });
  });

  app.listen(PORT, () => {
    console.log(`[SQL Gateway] running on http://0.0.0.0:${PORT}`);
    console.log(`[SQL Gateway] database type: ${DB_TYPE}`);
  });
}

main().catch(err => {
  console.error('[SQL Gateway] failed to start:', err);
  process.exit(1);
});
