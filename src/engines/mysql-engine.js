/**
 * MySQL 引擎（生产环境）
 *
 * 职责：
 * - 网关校验通过后，把 SQL 直接交给真实 MySQL 执行
 * - 不做 SQL 解析/改写，由 DB 自己处理
 * - 仅做结果标准化（统一返回格式）
 *
 * 适用场景：
 * - 配置了 MYSQL_HOST 环境变量
 * - 走真实数据库
 */

export class MySqlEngine {
  constructor(pool) {
    this.pool = pool;
    this.type = 'mysql';
  }

  async execute(sql, params = []) {
    if (!this.pool) {
      return { success: false, error: 'MySQL 连接池未初始化' };
    }
    try {
      const [rows] = await this.pool.query(sql, params);
      return { success: true, data: rows, count: rows.length, sql };
    } catch (error) {
      return { success: false, error: `SQL 执行失败: ${error.message}` };
    }
  }
}
