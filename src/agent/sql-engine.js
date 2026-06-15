import pkg from 'node-sql-parser';
const { Parser } = pkg;

const FORBIDDEN_KEYWORDS = [
  'DROP', 'DELETE', 'TRUNCATE', 'UPDATE', 'INSERT',
  'ALTER', 'CREATE', 'REPLACE', 'RENAME', 'GRANT',
  'REVOKE', 'EXEC', 'EXECUTE', 'CALL', 'LOAD',
  'OUTFILE', 'DUMPFILE', 'INTO OUTFILE'
];

const FORBIDDEN_TABLE_PREFIXES = [
  'mysql.', 'information_schema.', 'performance_schema.', 'sys.'
];

class SqlSafetyFilter {
  static validate(sql) {
    if (!sql || typeof sql !== 'string') {
      return { valid: false, error: 'SQL 为空或不是字符串' };
    }

    const trimmed = sql.trim();
    if (!trimmed) {
      return { valid: false, error: 'SQL 为空' };
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

    if (trimmed.length > 2000) {
      return { valid: false, error: 'SQL 长度超过限制' };
    }

    return { valid: true };
  }
}

class JsonSqlEngine {
  constructor(db) {
    this.db = db;
    this.parser = new Parser();
  }

  getAllData() {
    if (typeof this.db.getAll === 'function') {
      return this.db.getAll();
    }
    return [];
  }

  async execute(sql) {
    const validation = SqlSafetyFilter.validate(sql);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    try {
      const ast = this.parser.astify(sql, { database: 'mysql' });
      const astArray = Array.isArray(ast) ? ast : [ast];

      let allData = this.getAllData();
      let result = allData;

      for (const node of astArray) {
        result = this.executeAst(node, result);
      }

      return { success: true, data: result, count: result.length, sql };
    } catch (error) {
      return { success: false, error: `SQL 解析失败: ${error.message}` };
    }
  }

  executeAst(node, data) {
    if (node.type === 'select') {
      let result = data;

      if (node.where) {
        result = this.applyWhere(result, node.where);
      }

      if (node.groupby) {
        const groupCols = this.extractGroupColumns(node.groupby);
        const aggregations = this.extractAggregations(node.columns);

        if (aggregations.length > 0 || groupCols.length > 0) {
          result = this.applyGroupBy(result, groupCols, aggregations);
        }
      }

      if (node.having) {
        result = this.applyHaving(result, node.having);
      }

      if (node.orderby) {
        result = this.applyOrderBy(result, node.orderby);
      }

      if (node.limit) {
        result = this.applyLimit(result, node.limit);
      }

      if (node.columns && node.columns !== '*') {
        result = this.applyColumns(result, node.columns);
      }

      return result;
    }
    return data;
  }

  applyWhere(data, where) {
    return data.filter(row => this.evalExpression(row, where));
  }

  evalExpression(row, expr) {
    if (!expr) return true;

    if (expr.type === 'binary_expr') {
      const left = this.evalExpression(row, expr.left);
      const right = this.evalExpression(row, expr.right);
      const op = expr.operator.toUpperCase();

      switch (op) {
        case '=': return left === right;
        case '!=': case '<>': return left !== right;
        case '>': return left > right;
        case '>=': return left >= right;
        case '<': return left < right;
        case '<=': return left <= right;
        case 'AND': return left && right;
        case 'OR': return left || right;
        case 'LIKE': return this.evalLike(left, right);
        case 'IN': return this.evalIn(row, expr);
        case 'BETWEEN': return this.evalBetween(row, expr);
        default: return false;
      }
    }

    if (expr.type === 'column_ref') {
      return row[expr.column.toLowerCase()] ?? row[expr.column];
    }

    if (expr.type === 'string' || expr.type === 'single_quote_string') {
      return expr.value;
    }

    if (expr.type === 'number') {
      return parseFloat(expr.value);
    }

    if (expr.type === 'null') {
      return null;
    }

    if (expr.type === 'function') {
      return this.evalFunction(row, expr);
    }

    return true;
  }

  evalLike(value, pattern) {
    if (value == null) return false;
    const regex = new RegExp('^' + pattern.replace(/%/g, '.*').replace(/_/g, '.') + '$', 'i');
    return regex.test(String(value));
  }

  evalIn(row, expr) {
    const leftValue = this.evalExpression(row, expr.left);
    const rightValues = (expr.right.value || []).map(v => this.evalExpression(row, v));
    return rightValues.includes(leftValue);
  }

  evalBetween(row, expr) {
    const value = this.evalExpression(row, expr.expr);
    const min = this.evalExpression(row, expr.right.left);
    const max = this.evalExpression(row, expr.right.right);
    return value >= min && value <= max;
  }

  evalFunction(row, expr) {
    const fnName = expr.name.name.toUpperCase();
    const arg = expr.args ? this.evalExpression(row, expr.args.expr) : null;

    if (fnName === 'YEAR' && arg) {
      return new Date(arg).getFullYear();
    }
    if (fnName === 'MONTH' && arg) {
      return new Date(arg).getMonth() + 1;
    }
    if (fnName === 'DATE' && arg) {
      return new Date(arg).toISOString().split('T')[0];
    }
    return null;
  }

  extractGroupColumns(groupby) {
    const groups = Array.isArray(groupby) ? groupby : [groupby];
    return groups
      .filter(g => g.type === 'column_ref')
      .map(g => g.column.toLowerCase());
  }

  extractAggregations(columns) {
    if (columns === '*' || !Array.isArray(columns)) return [];
    return columns.filter(c => c.type === 'function' || (c.expr && c.expr.type === 'function'));
  }

  applyGroupBy(data, groupCols, aggregations) {
    const groups = {};

    data.forEach(row => {
      const key = groupCols.map(col => row[col]).join('|');
      if (!groups[key]) {
        groups[key] = { _rows: [] };
        groupCols.forEach(col => {
          groups[key][col] = row[col];
        });
        aggregations.forEach(agg => {
          groups[key][this.getAggAlias(agg)] = this.initAggValue(agg);
        });
      }
      groups[key]._rows.push(row);

      aggregations.forEach(agg => {
        const alias = this.getAggAlias(agg);
        const value = this.evalAggregation(agg, row);
        this.updateAggValue(groups[key][alias], value, agg);
      });
    });

    return Object.values(groups).map(g => {
      delete g._rows;
      aggregations.forEach(agg => {
        const alias = this.getAggAlias(agg);
        g[alias] = this.finalizeAggValue(g[alias], agg);
      });
      return g;
    });
  }

  getAggAlias(agg) {
    if (agg.as) return agg.as;
    const fnName = agg.name ? agg.name.name : (agg.expr.name.name);
    const argName = this.getAggArgName(agg);
    return argName ? `${fnName.toLowerCase()}_${argName}` : fnName.toLowerCase();
  }

  getAggArgName(agg) {
    const target = agg.args ? agg.args : (agg.expr ? agg.expr.args : null);
    if (!target || !target.expr) return null;
    if (target.expr.type === 'column_ref') {
      return target.expr.column.toLowerCase();
    }
    return null;
  }

  initAggValue(agg) {
    const fnName = this.getAggFnName(agg);
    if (fnName === 'COUNT') return 0;
    if (fnName === 'SUM' || fnName === 'AVG') return { sum: 0, count: 0 };
    if (fnName === 'MAX') return -Infinity;
    if (fnName === 'MIN') return Infinity;
    return null;
  }

  getAggFnName(agg) {
    return (agg.name ? agg.name.name : agg.expr.name.name).toUpperCase();
  }

  updateAggValue(current, value, agg) {
    const fnName = this.getAggFnName(agg);
    if (fnName === 'COUNT') {
      if (value !== null) current.count++;
    } else if (fnName === 'SUM' || fnName === 'AVG') {
      if (value !== null) {
        current.sum += parseFloat(value);
        current.count++;
      }
    } else if (fnName === 'MAX') {
      if (value > current) current.max = value;
    } else if (fnName === 'MIN') {
      if (value < current) current.min = value;
    }
  }

  finalizeAggValue(current, agg) {
    const fnName = this.getAggFnName(agg);
    if (fnName === 'SUM') return current.sum;
    if (fnName === 'AVG') return current.count > 0 ? current.sum / current.count : 0;
    if (fnName === 'COUNT') return current.count;
    if (fnName === 'MAX') return current.max === -Infinity ? null : current.max;
    if (fnName === 'MIN') return current.min === Infinity ? null : current.min;
    return current;
  }

  evalAggregation(agg, row) {
    const target = agg.args ? agg.args : (agg.expr ? agg.expr.args : null);
    if (!target) return null;

    if (target.expr && target.expr.type === 'star') {
      return 1;
    }

    const value = this.evalExpression(row, target);
    return value;
  }

  applyHaving(data, having) {
    return data.filter(row => this.evalExpression(row, having));
  }

  applyOrderBy(data, orderby) {
    const orders = Array.isArray(orderby) ? orderby : [orderby];
    return [...data].sort((a, b) => {
      for (const order of orders) {
        const col = order.expr.column.toLowerCase();
        const av = a[col];
        const bv = b[col];
        const dir = order.type === 'DESC' ? -1 : 1;
        if (av < bv) return -1 * dir;
        if (av > bv) return 1 * dir;
      }
      return 0;
    });
  }

  applyLimit(data, limit) {
    const lim = Array.isArray(limit) ? limit[0] : limit;
    const offset = lim.offset ? parseInt(lim.offset.value) : 0;
    const rowcount = parseInt(lim.rowcount.value);
    return data.slice(offset, offset + rowcount);
  }

  applyColumns(data, columns) {
    return data.map(row => {
      const newRow = {};
      columns.forEach(col => {
        if (col.type === 'column_ref') {
          const name = col.column.toLowerCase();
          newRow[name] = row[name];
        } else if (col.type === 'function' || (col.expr && col.expr.type === 'function')) {
          const alias = this.getAggAlias(col);
          newRow[alias] = this.evalAggregation(col, row);
        } else if (col.expr && col.expr.type === 'column_ref') {
          const name = col.expr.column.toLowerCase();
          newRow[name] = row[name];
        }
      });
      return newRow;
    });
  }
}

class MySqlEngine {
  constructor(pool) {
    this.pool = pool;
  }

  async execute(sql) {
    const validation = SqlSafetyFilter.validate(sql);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    try {
      const [rows] = await this.pool.query(sql);
      return { success: true, data: rows, count: rows.length, sql };
    } catch (error) {
      return { success: false, error: `SQL 执行失败: ${error.message}` };
    }
  }
}

function createSqlEngine(db) {
  if (db && db.query && typeof db.query === 'function' && !db.getAll) {
    return new MySqlEngine(db);
  }
  return new JsonSqlEngine(db);
}

async function getMySQLSchema(pool) {
  if (!pool) return null;
  try {
    const [tables] = await pool.query(`
      SELECT TABLE_NAME, TABLE_COMMENT
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_TYPE = 'BASE TABLE'
        AND TABLE_NAME NOT LIKE 'innodb%'
    `);

    if (tables.length === 0) return null;

    const result = { database: pool.config ? pool.config.database : 'database', tables: [] };

    for (const t of tables) {
      const [columns] = await pool.query(`
        SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_COMMENT, COLUMN_DEFAULT
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION
      `, [t.TABLE_NAME]);

      const [distinctValues] = await pool.query(`
        SELECT COLUMN_NAME
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
          AND (DATA_TYPE = 'varchar' OR DATA_TYPE = 'enum')
          AND CHARACTER_MAXIMUM_LENGTH <= 50
      `, [t.TABLE_NAME]);

      const enumCandidates = new Set(distinctValues.map(r => r.COLUMN_NAME.toLowerCase()));
      const tableCols = [];

      for (const col of columns) {
        const colInfo = {
          name: col.COLUMN_NAME,
          type: col.COLUMN_TYPE.toUpperCase(),
          nullable: col.IS_NULLABLE === 'YES',
          description: col.COLUMN_COMMENT || ''
        };
        if (col.COLUMN_KEY === 'PRI') colInfo.primary = true;
        if (col.COLUMN_DEFAULT !== null) colInfo.default = col.COLUMN_DEFAULT;

        if (enumCandidates.has(col.COLUMN_NAME.toLowerCase()) && t.TABLE_COMMENT) {
          try {
            const [vals] = await pool.query(
              `SELECT DISTINCT ?? FROM ?? LIMIT 20`,
              [col.COLUMN_NAME, t.TABLE_NAME]
            );
            if (vals.length > 0 && vals.length <= 20) {
              colInfo.enum = vals.map(v => Object.values(v)[0]).filter(v => v != null);
            }
          } catch (e) {
            // ignore enum sampling errors
          }
        }

        tableCols.push(colInfo);
      }

      result.tables.push({
        name: t.TABLE_NAME,
        description: t.TABLE_COMMENT || t.TABLE_NAME,
        columns: tableCols
      });
    }

    return result;
  } catch (error) {
    console.error('MySQL schema 获取失败:', error.message);
    return null;
  }
}

function getUploadedSchema(datasets = []) {
  if (!datasets || datasets.length === 0) return null;

  return {
    database: 'uploaded',
    tables: datasets.map(d => {
      const sample = d.data && d.data.length > 0 ? d.data[0] : {};
      const columns = (d.columns || []).map(col => {
        const sampleVal = sample[col];
        const type = inferTypeFromValue(sampleVal);
        return {
          name: col,
          type,
          description: `字段 ${col}`
        };
      });

      return {
        name: `uploaded_${d.id}`,
        sourceId: d.id,
        sourceName: d.name,
        description: `上传文件: ${d.name}（${d.rowCount} 行）`,
        columns,
        rowCount: d.rowCount
      };
    })
  };
}

function inferTypeFromValue(val) {
  if (val === null || val === undefined) return 'TEXT';
  if (typeof val === 'number') {
    return Number.isInteger(val) ? 'INT' : 'DECIMAL(15,2)';
  }
  if (typeof val === 'boolean') return 'BOOLEAN';
  if (val instanceof Date) return 'DATE';
  if (/^\d{4}-\d{2}-\d{2}/.test(String(val))) return 'DATE';
  return 'VARCHAR(255)';
}

function inferEnumFromValues(datasets) {
  const enumMap = {};
  for (const d of datasets) {
    if (!d.data || d.data.length === 0) continue;
    for (const col of d.columns || []) {
      const unique = new Set();
      for (const row of d.data.slice(0, 200)) {
        if (row[col] != null) unique.add(row[col]);
      }
      if (unique.size > 0 && unique.size <= 20) {
        enumMap[col] = Array.from(unique);
      }
    }
  }
  return enumMap;
}

function getStaticSchema() {
  return {
    database: 'nl2chart',
    tables: [
      {
        name: 'sales_data',
        description: '销售数据表',
        columns: [
          { name: 'id', type: 'INT', description: '主键ID', primary: true },
          { name: 'region', type: 'VARCHAR(50)', description: '地区', enum: ['华东', '华北', '华南', '西南'] },
          { name: 'product', type: 'VARCHAR(100)', description: '产品', enum: ['笔记本电脑', '手机', '平板电脑'] },
          { name: 'sales_amount', type: 'DECIMAL(15,2)', description: '销售额（元）' },
          { name: 'quantity', type: 'INT', description: '销售量（件）' },
          { name: 'sale_date', type: 'DATE', description: '销售日期，格式 YYYY-MM-DD' }
        ],
        indexes: ['idx_region', 'idx_product', 'idx_sale_date']
      }
    ]
  };
}

function buildSchemaText(schema) {
  if (!schema) return '\n## 数据库 Schema\n（暂无可用数据）\n';

  let text = `\n## 数据库 Schema\n`;
  text += `数据库: ${schema.database}\n\n`;

  schema.tables.forEach(table => {
    text += `### 表: ${table.name}\n`;
    text += `${table.description || ''}\n\n`;
    text += `| 字段 | 类型 | 说明 |\n`;
    text += `|------|------|------|\n`;
    table.columns.forEach(col => {
      let extra = '';
      if (col.primary) extra += ' [主键]';
      if (col.enum && col.enum.length > 0) extra += ` (可选: ${col.enum.join('/')})`;
      const nullable = col.nullable ? ' (可空)' : '';
      text += `| ${col.name} | ${col.type}${nullable} | ${col.description || ''}${extra} |\n`;
    });
    if (table.rowCount) text += `\n总行数: ${table.rowCount}\n`;
    text += `\n`;
  });

  text += `## SQL 规则\n`;
  text += `- 只允许 SELECT 查询\n`;
  text += `- 禁止 DROP/DELETE/UPDATE/INSERT 等修改操作\n`;
  text += `- 禁止访问系统表\n`;
  text += `- 支持聚合函数: COUNT, SUM, AVG, MAX, MIN\n`;
  text += `- 支持 WHERE 过滤、GROUP BY 分组、HAVING 过滤、ORDER BY 排序、LIMIT 限制\n`;

  return text;
}

async function getSchema({ pool = null, datasets = [], preferDynamic = true } = {}) {
  if (preferDynamic) {
    if (pool) {
      const mysqlSchema = await getMySQLSchema(pool);
      if (mysqlSchema) {
        if (datasets && datasets.length > 0) {
          const uploadedSchema = getUploadedSchema(datasets);
          if (uploadedSchema) {
            mysqlSchema.tables = mysqlSchema.tables.concat(uploadedSchema.tables);
          }
        }
        return mysqlSchema;
      }
    }

    if (datasets && datasets.length > 0) {
      const uploadedSchema = getUploadedSchema(datasets);
      if (uploadedSchema) return uploadedSchema;
    }
  }

  return getStaticSchema();
}

function getSchemaSync({ datasets = [] } = {}) {
  if (datasets && datasets.length > 0) {
    const uploadedSchema = getUploadedSchema(datasets);
    if (uploadedSchema) return uploadedSchema;
  }
  return getStaticSchema();
}

function schemaToText(schema) {
  return buildSchemaText(schema);
}

export { SqlSafetyFilter, JsonSqlEngine, MySqlEngine, createSqlEngine, getSchema, getSchemaSync, schemaToText, getStaticSchema, getMySQLSchema, getUploadedSchema, buildSchemaText };