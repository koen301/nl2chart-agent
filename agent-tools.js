// Agent 工具集定义
const { v4: uuidv4 } = require('uuid');

// 工具 Schema 定义
const toolSchemas = {
  querySalesData: {
    name: 'querySalesData',
    description: '查询销售数据数据库，支持按地区、产品、时间范围筛选，返回原始数据或聚合统计',
    parameters: {
      type: 'object',
      properties: {
        region: {
          type: 'string',
          enum: ['华东', '华北', '华南', '西南'],
          description: '地区筛选，可选'
        },
        product: {
          type: 'string',
          enum: ['笔记本电脑', '手机', '平板电脑'],
          description: '产品筛选，可选'
        },
        startDate: {
          type: 'string',
          description: '开始日期，格式 YYYY-MM-DD，可选'
        },
        endDate: {
          type: 'string',
          description: '结束日期，格式 YYYY-MM-DD，可选'
        },
        groupBy: {
          type: 'string',
          enum: ['region', 'product', 'month', 'none'],
          description: '聚合维度：按地区、产品、月份或不聚合'
        }
      },
      required: ['groupBy']
    }
  },
  
  generateChartConfig: {
    name: 'generateChartConfig',
    description: '根据查询结果生成图表配置，支持柱状图、折线图、饼图',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['bar', 'line', 'pie'],
          description: '图表类型：柱状图、折线图、饼图'
        },
        title: {
          type: 'string',
          description: '图表标题'
        },
        labels: {
          type: 'array',
          items: { type: 'string' },
          description: 'X轴或分类标签数组'
        },
        values: {
          type: 'array',
          items: { type: 'number' },
          description: '对应的数值数组，长度与labels相同'
        }
      },
      required: ['type', 'title', 'labels', 'values']
    }
  },
  
  calculateStatistics: {
    name: 'calculateStatistics',
    description: '对数据进行统计分析，计算总和、平均值、最大值、最小值等',
    parameters: {
      type: 'object',
      properties: {
        metric: {
          type: 'string',
          enum: ['sales_amount', 'quantity'],
          description: '要统计的指标'
        },
        operation: {
          type: 'string',
          enum: ['sum', 'avg', 'max', 'min', 'count'],
          description: '统计操作类型'
        }
      },
      required: ['metric', 'operation']
    }
  },
  
  exportData: {
    name: 'exportData',
    description: '导出查询结果为JSON格式数据',
    parameters: {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          enum: ['json'],
          description: '导出格式'
        },
        limit: {
          type: 'number',
          description: '限制导出条数'
        }
      },
      required: ['format']
    }
  }
};

// 工具实现
class AgentTools {
  constructor(db) {
    this.db = db;
  }
  
  // 查询销售数据
  async querySalesData(args) {
    let results = this.db.getAll();
    
    // 应用筛选条件
    if (args.region) {
      results = results.filter(r => r.region === args.region);
    }
    
    if (args.product) {
      results = results.filter(r => r.product === args.product);
    }
    
    if (args.startDate) {
      results = results.filter(r => r.sale_date >= args.startDate);
    }
    
    if (args.endDate) {
      results = results.filter(r => r.sale_date <= args.endDate);
    }
    
    // 根据groupBy进行聚合
    if (args.groupBy !== 'none') {
      const aggregated = {};
      
      results.forEach(record => {
        let key;
        if (args.groupBy === 'month') {
          key = record.sale_date.substring(0, 7); // YYYY-MM
        } else {
          key = record[args.groupBy];
        }
        
        if (!aggregated[key]) {
          aggregated[key] = {
            [args.groupBy === 'month' ? 'month' : args.groupBy]: key,
            total_sales: 0,
            total_quantity: 0
          };
        }
        aggregated[key].total_sales += record.sales_amount;
        aggregated[key].total_quantity += record.quantity;
      });
      
      results = Object.values(aggregated);
      
      // 按月份排序
      if (args.groupBy === 'month') {
        results.sort((a, b) => a.month.localeCompare(b.month));
      }
    }
    
    return {
      success: true,
      count: results.length,
      data: results
    };
  }
  
  // 生成图表配置
  async generateChartConfig(args) {
    const config = {
      id: uuidv4(),
      type: args.type,
      title: args.title,
      labels: args.labels,
      values: args.values,
      createdAt: new Date().toISOString()
    };
    
    return {
      success: true,
      config
    };
  }
  
  // 计算统计信息
  async calculateStatistics(args) {
    const allData = this.db.getAll();
    
    let value;
    switch (args.operation) {
      case 'sum':
        value = allData.reduce((sum, r) => sum + (r[args.metric] || 0), 0);
        break;
      case 'avg':
        value = allData.length > 0 ? allData.reduce((sum, r) => sum + (r[args.metric] || 0), 0) / allData.length : 0;
        break;
      case 'max':
        value = allData.length > 0 ? Math.max(...allData.map(r => r[args.metric] || 0)) : 0;
        break;
      case 'min':
        value = allData.length > 0 ? Math.min(...allData.map(r => r[args.metric] || 0)) : 0;
        break;
      case 'count':
        value = allData.length;
        break;
      default:
        return { success: false, error: '不支持的统计操作' };
    }
    
    return {
      success: true,
      metric: args.metric,
      operation: args.operation,
      value: value
    };
  }
  
  // 导出数据
  async exportData(args) {
    let results = this.db.getAll();
    
    if (args.limit) {
      results = results.slice(0, args.limit);
    }
    
    return {
      success: true,
      format: args.format,
      count: results.length,
      data: results
    };
  }
}

module.exports = { toolSchemas, AgentTools };
