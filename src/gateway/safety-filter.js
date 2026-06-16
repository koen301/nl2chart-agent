/**
 * SQL 网关 - 安全过滤器
 *
 * 职责：
 * - 黑名单关键字拦截（DROP/DELETE/UPDATE/INSERT 等）
 * - 仅允许 SELECT/WITH 语句
 * - 限制 SQL 长度
 * - 禁止访问系统表
 *
 * 设计原则：
 * - 这是网关唯一的安全边界
 * - Agent / 前端层不应该重复实现
 * - 未来独立部署为独立服务时，此模块作为网关核心
 */

const FORBIDDEN_KEYWORDS = [
  'DROP', 'DELETE', 'TRUNCATE', 'UPDATE', 'INSERT',
  'ALTER', 'CREATE', 'REPLACE', 'RENAME', 'GRANT',
  'REVOKE', 'EXEC', 'EXECUTE', 'CALL', 'LOAD',
  'OUTFILE', 'DUMPFILE', 'INTO OUTFILE'
];

const FORBIDDEN_TABLE_PREFIXES = [
  'mysql.', 'information_schema.', 'performance_schema.', 'sys.'
];

const MAX_SQL_LENGTH = 2000;

export class SqlSafetyFilter {
  static validate(sql) {
    if (!sql || typeof sql !== 'string') {
      return { valid: false, error: 'SQL 为空或不是字符串' };
    }

    const trimmed = sql.trim();
    if (!trimmed) {
      return { valid: false, error: 'SQL 为空' };
    }

    if (trimmed.length > MAX_SQL_LENGTH) {
      return { valid: false, error: `SQL 长度超过限制 (${MAX_SQL_LENGTH})` };
    }

    const upperSql = trimmed.toUpperCase();

    if (!upperSql.startsWith('SELECT') && !upperSql.startsWith('WITH')) {
      return { valid: false, error: '只允许 SELECT 查询语句' };
    }

    for (const keyword of FORBIDDEN_KEYWORDS) {
      const regex = new RegExp(`\\b${keyword}\\b`, 'i');
      if (regex.test(upperSql)) {
        return { valid: false, error: `禁止使用危险关键字: ${keyword}` };
      }
    }

    for (const prefix of FORBIDDEN_TABLE_PREFIXES) {
      if (upperSql.includes(prefix.toUpperCase())) {
        return { valid: false, error: `禁止访问系统表: ${prefix}` };
      }
    }

    return { valid: true };
  }
}
