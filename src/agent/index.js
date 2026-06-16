/**
 * Agent 模块入口
 *
 * 提供三种 Agent 实现，由 USE_SQL_AGENT / USE_MULTI_AGENT 环境变量切换：
 * - DataAgent  : 单 Agent + 工具调用（agent.js）
 * - MultiAgent : 三 Agent 协作 Planner/Executor/Reviewer（multi-agent.js）
 * - SqlAgent   : 单 Agent + 直生 SQL（sql-agent.js，走 SQL 网关）
 *
 * 与 SQL 网关的关系：
 * - 所有 Agent 涉及数据访问都通过 src/gateway/，不直接连 DB
 */

import { DataAgent } from './agent.js';
import { MultiAgent } from './multi-agent.js';
import { SqlAgent } from './sql-agent.js';

export { DataAgent, MultiAgent, SqlAgent };
