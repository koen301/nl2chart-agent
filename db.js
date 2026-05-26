require('dotenv').config();
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data.json');

const DB_TYPE = process.env.DB_TYPE || 'json';
const MYSQL_HOST = process.env.MYSQL_HOST;
const MYSQL_PORT = process.env.MYSQL_PORT || 3306;
const MYSQL_USER = process.env.MYSQL_USER || 'root';
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || '';
const MYSQL_DATABASE = process.env.MYSQL_DATABASE || 'nl2chart';

let mysqlPool = null;

async function initMySQL() {
  const mysql = require('mysql2/promise');
  
  mysqlPool = mysql.createPool({
    host: MYSQL_HOST,
    port: parseInt(MYSQL_PORT),
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
    database: MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });

  const connection = await mysqlPool.getConnection();
  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS sales_data (
        id INT AUTO_INCREMENT PRIMARY KEY,
        region VARCHAR(50) NOT NULL,
        product VARCHAR(100) NOT NULL,
        sales_amount DECIMAL(15, 2) NOT NULL,
        quantity INT NOT NULL,
        sale_date DATE NOT NULL,
        INDEX idx_region (region),
        INDEX idx_product (product),
        INDEX idx_sale_date (sale_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    const [rows] = await connection.query('SELECT COUNT(*) as count FROM sales_data');
    if (rows[0].count === 0) {
      console.log('正在初始化 Mock 数据到 MySQL...');
      const mockData = generateMockData();
      for (const record of mockData) {
        await connection.query(
          'INSERT INTO sales_data (region, product, sales_amount, quantity, sale_date) VALUES (?, ?, ?, ?, ?)',
          [record.region, record.product, record.sales_amount, record.quantity, record.sale_date]
        );
      }
      console.log(`成功插入 ${mockData.length} 条 Mock 数据`);
    }

    console.log('MySQL 数据库初始化完成');
  } finally {
    connection.release();
  }

  return mysqlPool;
}

function initJSON() {
  let data = loadData();
  
  // 如果没有数据，插入 Mock 数据
  if (!data || !data.sales_data || data.sales_data.length === 0) {
    console.log('正在初始化 Mock 数据...');
    data = {
      sales_data: generateMockData()
    };
    saveData(data);
    console.log(`成功插入 ${data.sales_data.length} 条 Mock 数据`);
  }
  
  return {
    // 查询方法
    query: (sql, params = {}) => {
      return queryData(data, sql, params);
    },
    // 获取所有数据
    getAll: () => data.sales_data,
    // 获取数据条数
    getCount: () => data.sales_data.length
  };
}

// 加载数据
function loadData() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const content = fs.readFileSync(DB_PATH, 'utf-8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.error('加载数据失败:', error.message);
  }
  return null;
}

// 保存数据
function saveData(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    console.error('保存数据失败:', error.message);
  }
}

// 生成 Mock 数据
function generateMockData() {
  return [
    { id: 1, region: '华东', product: '笔记本电脑', sales_amount: 125000, quantity: 25, sale_date: '2024-01-15' },
    { id: 2, region: '华东', product: '手机', sales_amount: 89000, quantity: 45, sale_date: '2024-01-18' },
    { id: 3, region: '华东', product: '平板电脑', sales_amount: 67000, quantity: 18, sale_date: '2024-01-22' },
    { id: 4, region: '华北', product: '笔记本电脑', sales_amount: 98000, quantity: 20, sale_date: '2024-01-16' },
    { id: 5, region: '华北', product: '手机', sales_amount: 112000, quantity: 56, sale_date: '2024-01-19' },
    { id: 6, region: '华南', product: '平板电脑', sales_amount: 78000, quantity: 21, sale_date: '2024-01-20' },
    { id: 7, region: '华东', product: '笔记本电脑', sales_amount: 135000, quantity: 27, sale_date: '2024-02-10' },
    { id: 8, region: '华东', product: '手机', sales_amount: 95000, quantity: 48, sale_date: '2024-02-14' },
    { id: 9, region: '华北', product: '笔记本电脑', sales_amount: 105000, quantity: 21, sale_date: '2024-02-11' },
    { id: 10, region: '华北', product: '手机', sales_amount: 118000, quantity: 59, sale_date: '2024-02-15' },
    { id: 11, region: '华南', product: '平板电脑', sales_amount: 82000, quantity: 22, sale_date: '2024-02-18' },
    { id: 12, region: '华南', product: '手机', sales_amount: 71000, quantity: 36, sale_date: '2024-02-20' },
    { id: 13, region: '华东', product: '笔记本电脑', sales_amount: 142000, quantity: 28, sale_date: '2024-03-05' },
    { id: 14, region: '华东', product: '手机', sales_amount: 102000, quantity: 51, sale_date: '2024-03-08' },
    { id: 15, region: '华东', product: '平板电脑', sales_amount: 75000, quantity: 20, sale_date: '2024-03-12' },
    { id: 16, region: '华北', product: '笔记本电脑', sales_amount: 115000, quantity: 23, sale_date: '2024-03-06' },
    { id: 17, region: '华北', product: '手机', sales_amount: 125000, quantity: 63, sale_date: '2024-03-09' },
    { id: 18, region: '华南', product: '笔记本电脑', sales_amount: 88000, quantity: 18, sale_date: '2024-03-10' },
    { id: 19, region: '华南', product: '平板电脑', sales_amount: 91000, quantity: 24, sale_date: '2024-03-15' },
    { id: 20, region: '华南', product: '手机', sales_amount: 76000, quantity: 38, sale_date: '2024-03-18' },
    { id: 21, region: '华东', product: '笔记本电脑', sales_amount: 156000, quantity: 31, sale_date: '2024-04-02' },
    { id: 22, region: '华东', product: '手机', sales_amount: 108000, quantity: 54, sale_date: '2024-04-05' },
    { id: 23, region: '华北', product: '笔记本电脑', sales_amount: 122000, quantity: 24, sale_date: '2024-04-03' },
    { id: 24, region: '华北', product: '手机', sales_amount: 131000, quantity: 66, sale_date: '2024-04-07' },
    { id: 25, region: '华南', product: '平板电脑', sales_amount: 95000, quantity: 25, sale_date: '2024-04-10' },
    { id: 26, region: '西南', product: '笔记本电脑', sales_amount: 67000, quantity: 13, sale_date: '2024-04-12' },
    { id: 27, region: '西南', product: '手机', sales_amount: 54000, quantity: 27, sale_date: '2024-04-15' },
    { id: 28, region: '华东', product: '笔记本电脑', sales_amount: 168000, quantity: 34, sale_date: '2024-05-01' },
    { id: 29, region: '华东', product: '手机', sales_amount: 115000, quantity: 58, sale_date: '2024-05-04' },
    { id: 30, region: '华东', product: '平板电脑', sales_amount: 82000, quantity: 22, sale_date: '2024-05-08' },
    { id: 31, region: '华北', product: '笔记本电脑', sales_amount: 135000, quantity: 27, sale_date: '2024-05-02' },
    { id: 32, region: '华北', product: '手机', sales_amount: 142000, quantity: 71, sale_date: '2024-05-05' },
    { id: 33, region: '华南', product: '笔记本电脑', sales_amount: 98000, quantity: 20, sale_date: '2024-05-06' },
    { id: 34, region: '华南', product: '手机', sales_amount: 85000, quantity: 43, sale_date: '2024-05-09' },
    { id: 35, region: '西南', product: '平板电脑', sales_amount: 72000, quantity: 19, sale_date: '2024-05-10' },
    { id: 36, region: '西南', product: '手机', sales_amount: 61000, quantity: 31, sale_date: '2024-05-13' },
    { id: 37, region: '华东', product: '笔记本电脑', sales_amount: 178000, quantity: 36, sale_date: '2024-06-01' },
    { id: 38, region: '华东', product: '手机', sales_amount: 125000, quantity: 63, sale_date: '2024-06-05' },
    { id: 39, region: '华北', product: '笔记本电脑', sales_amount: 145000, quantity: 29, sale_date: '2024-06-02' },
    { id: 40, region: '华北', product: '手机', sales_amount: 155000, quantity: 78, sale_date: '2024-06-06' },
    { id: 41, region: '华南', product: '笔记本电脑', sales_amount: 108000, quantity: 22, sale_date: '2024-06-03' },
    { id: 42, region: '华南', product: '平板电脑', sales_amount: 99000, quantity: 26, sale_date: '2024-06-08' },
    { id: 43, region: '西南', product: '手机', sales_amount: 68000, quantity: 34, sale_date: '2024-06-10' },
    { id: 44, region: '西南', product: '笔记本电脑', sales_amount: 75000, quantity: 15, sale_date: '2024-06-12' },
  ];
}

// 查询数据（简化版 SQL 解析）
function queryData(data, sql, params) {
  let results = [...data.sales_data];
  
  // 解析 WHERE 条件
  if (sql.includes('WHERE')) {
    const whereMatch = sql.match(/WHERE (.+?)(?:GROUP BY|ORDER BY|LIMIT|$)/i);
    if (whereMatch) {
      const conditions = whereMatch[1];
      
      if (conditions.includes('region = ?')) {
        results = results.filter(r => r.region === params.region);
      }
      
      if (conditions.includes('product = ?')) {
        results = results.filter(r => r.product === params.product);
      }
      
      if (conditions.includes('sale_date >= ?')) {
        results = results.filter(r => r.sale_date >= params.startDate);
      }
      
      if (conditions.includes('sale_date <= ?')) {
        results = results.filter(r => r.sale_date <= params.endDate);
      }
    }
  }
  
  // 处理 GROUP BY 聚合
  if (sql.includes('GROUP BY')) {
    const groupByMatch = sql.match(/GROUP BY (\w+)/i);
    if (groupByMatch) {
      const groupField = groupByMatch[1];
      const aggregated = {};
      
      results.forEach(record => {
        const key = record[groupField];
        if (!aggregated[key]) {
          aggregated[key] = {
            [groupField]: key,
            total_sales: 0,
            total_quantity: 0
          };
        }
        aggregated[key].total_sales += record.sales_amount;
        aggregated[key].total_quantity += record.quantity;
      });
      
      results = Object.values(aggregated);
    }
  }
  
  // 处理 ORDER BY
  if (sql.includes('ORDER BY')) {
    const orderByMatch = sql.match(/ORDER BY (\w+)(?: ASC| DESC)?/i);
    if (orderByMatch) {
      const orderField = orderByMatch[1];
      results.sort((a, b) => {
        if (a[orderField] < b[orderField]) return -1;
        if (a[orderField] > b[orderField]) return 1;
        return 0;
      });
    }
  }
  
  // 处理聚合函数
  if (sql.includes('SUM(') || sql.includes('AVG(') || sql.includes('MAX(') || sql.includes('MIN(') || sql.includes('COUNT(')) {
    const sumMatch = sql.match(/(SUM|AVG|MAX|MIN|COUNT)\((\w+)\) as (\w+)/i);
    if (sumMatch) {
      const operation = sumMatch[1].toLowerCase();
      const field = sumMatch[2];
      const alias = sumMatch[3];
      
      let value;
      switch (operation) {
        case 'sum':
          value = results.reduce((sum, r) => sum + (r[field] || 0), 0);
          break;
        case 'avg':
          value = results.length > 0 ? results.reduce((sum, r) => sum + (r[field] || 0), 0) / results.length : 0;
          break;
        case 'max':
          value = results.length > 0 ? Math.max(...results.map(r => r[field] || 0)) : 0;
          break;
        case 'min':
          value = results.length > 0 ? Math.min(...results.map(r => r[field] || 0)) : 0;
          break;
        case 'count':
          value = results.length;
          break;
      }
      
      return { [alias]: value };
    }
  }
  
  return results;
}

async function initDB() {
  const useMySQL = DB_TYPE === 'mysql' && MYSQL_HOST;
  
  if (useMySQL) {
    console.log('使用 MySQL 数据库');
    const pool = await initMySQL();
    
    return {
      query: async (sql, params = {}) => {
        const connection = await pool.getConnection();
        try {
          let formattedSql = sql;
          if (params.region) {
            formattedSql = formattedSql.replace('?', `'${params.region}'`);
          }
          if (params.product) {
            formattedSql = formattedSql.replace('?', `'${params.product}'`);
          }
          if (params.startDate) {
            formattedSql = formattedSql.replace('?', `'${params.startDate}'`);
          }
          if (params.endDate) {
            formattedSql = formattedSql.replace('?', `'${params.endDate}'`);
          }
          
          const [rows] = await connection.query(formattedSql);
          return rows;
        } catch (error) {
          console.error('MySQL 查询失败:', error.message);
          throw error;
        } finally {
          connection.release();
        }
      },
      getAll: async () => {
        const connection = await pool.getConnection();
        try {
          const [rows] = await connection.query('SELECT * FROM sales_data');
          return rows;
        } finally {
          connection.release();
        }
      },
      getCount: async () => {
        const connection = await pool.getConnection();
        try {
          const [rows] = await connection.query('SELECT COUNT(*) as count FROM sales_data');
          return rows[0].count;
        } finally {
          connection.release();
        }
      }
    };
  } else {
    console.log('使用 JSON File 数据库');
    return initJSON();
  }
}

module.exports = { initDB };
