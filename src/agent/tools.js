import { v4 as uuidv4 } from 'uuid';

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
    description: '根据查询结果生成图表配置，支持柱状图、折线图、饼图、散点图、雷达图、热力图、仪表盘。重要：调用此工具前必须先用 querySalesData/queryUploadedData/calculateStatistics 获取实际数据，并把数据中的数值字段填入 values 数组（例如：查到了 [{product:"笔记本",total_sales:904000},{product:"手机",total_sales:634000}]，则 values 应为 [904000, 634000]，labels 为 ["笔记本","手机"]）。values 不能为空数组。【雷达图数据准备】雷达图用于多维度对比分析，需要：1) 将各维度数据归一化到0-100范围(当前值/最大值*100)；2) labels为维度名称(如["销售额","销售量","华东占比"...]);3) values为二维数组，每个子数组是一个主体的归一化数据，如：values=[[100,85,60],[88,100,45],[36,21,30]]表示3个主体在各维度的归一化值',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['bar', 'line', 'pie', 'doughnut', 'scatter', 'radar', 'heatmap', 'gauge'],
          description: '图表类型：bar(柱状图)、line(折线图)、pie(饼图)、doughnut(环形图)、scatter(散点图)、radar(雷达图)、heatmap(热力图)、gauge(仪表盘)'
        },
        title: {
          type: 'string',
          description: '图表标题'
        },
        labels: {
          type: 'array',
          items: { type: 'string' },
          description: '分类标签数组，用于饼图、雷达图、仪表盘等'
        },
        values: {
          type: 'array',
          description: '对应的数值数组；热力图需要二维数组[[]]'
        },
        xLabel: {
          type: 'string',
          description: '散点图X轴名称，可选'
        },
        yLabel: {
          type: 'string',
          description: '散点图Y轴名称，可选'
        },
        xLabels: {
          type: 'array',
          items: { type: 'string' },
          description: '热力图X轴标签数组，可选'
        },
        yLabels: {
          type: 'array',
          items: { type: 'string' },
          description: '热力图Y轴标签数组，可选'
        },
        seriesNames: {
          type: 'array',
          items: { type: 'string' },
          description: '多系列图表（如折线图多线）的系列名称数组，可选'
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
  },
  
  queryUploadedData: {
    name: 'queryUploadedData',
    description: '查询用户上传的数据集，支持查看数据内容、字段信息和基本统计',
    parameters: {
      type: 'object',
      properties: {
        datasetId: {
          type: 'string',
          description: '数据集ID，如果不提供则返回所有可用数据集列表'
        },
        action: {
          type: 'string',
          enum: ['list', 'query', 'info'],
          description: '操作类型：list=列出所有数据集，query=查询数据，info=查看数据集信息'
        },
        filters: {
          type: 'object',
          description: '查询过滤条件，键为字段名，值为过滤值'
        },
        limit: {
          type: 'number',
          description: '限制返回条数，默认100'
        }
      },
      required: ['action']
    }
  }
};

class AgentTools {
  constructor(db) {
    this.db = db;
  }
  
  async querySalesData(args) {
    let results;
    if (typeof this.db.getAll === 'function') {
      results = this.db.getAll();
    } else {
      results = await this.db.getAll();
    }
    
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
    
    if (args.groupBy !== 'none') {
      const aggregated = {};
      
      results.forEach(record => {
        let key;
        if (args.groupBy === 'month') {
          key = record.sale_date.substring(0, 7);
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
      
      if (args.groupBy === 'month') {
        results.sort((a, b) => a.month.localeCompare(b.month));
      }
    }

    global.recentQueryResult = { source: 'querySalesData', args, data: results };

    return {
      success: true,
      count: results.length,
      data: results
    };
  }
  
  async generateChartConfig(args) {
    // 兜底：如果 LLM 传入空 values，自动从最近的工具返回中提取数据
    let values = args.values;
    let labels = args.labels;
    let valueField = null;

    if (!values || (Array.isArray(values) && values.length === 0)) {
      const recentData = global.recentQueryResult;
      if (recentData && recentData.data && recentData.data.length > 0) {
        const sample = recentData.data[0];
        const numericFields = Object.keys(sample).filter(k =>
          typeof sample[k] === 'number' ||
          (typeof sample[k] === 'string' && /^\d+(\.\d+)?$/.test(sample[k]))
        );
        const excludeFields = ['id', 'index', 'rowNumber'];
        const availableFields = numericFields.filter(f => !excludeFields.includes(f));
        const preferredFields = availableFields.filter(f => /sales|amount|total|sum|value|price|count|quantity/i.test(f));

        if (preferredFields.length > 0) {
          valueField = preferredFields[0];
        } else if (availableFields.length > 0) {
          valueField = availableFields[0];
        }

        if (valueField) {
          values = recentData.data.map(r => Number(r[valueField]) || 0);

          if (!labels || labels.length === 0) {
            const labelField = Object.keys(sample).find(k =>
              k !== valueField && typeof sample[k] === 'string'
            );
            if (labelField) {
              labels = recentData.data.map(r => r[labelField]);
            } else {
              labels = recentData.data.map((_, i) => `类别${i + 1}`);
            }
          }

          console.log(`[generateChartConfig] 兜底: 自动从查询结果提取 ${values.length} 个值 (字段: ${valueField})`);
        }
      }
    }

    if (!values || (Array.isArray(values) && values.length === 0)) {
      return {
        success: false,
        error: 'values 不能为空，请先调用 querySalesData/queryUploadedData/calculateStatistics 获取数据'
      };
    }

    const config = {
      id: uuidv4(),
      type: args.type,
      title: args.title,
      labels: labels,
      values: values,
      createdAt: new Date().toISOString()
    };

    return {
      success: true,
      config
    };
  }
  
  async calculateStatistics(args) {
    let allData;
    if (typeof this.db.getAll === 'function') {
      allData = this.db.getAll();
    } else {
      allData = await this.db.getAll();
    }
    
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
    
    global.recentQueryResult = {
      source: 'calculateStatistics',
      args,
      data: [{ [args.metric]: value, _label: `${args.operation}_${args.metric}` }]
    };

    return {
      success: true,
      metric: args.metric,
      operation: args.operation,
      value: value
    };
  }
  
  async exportData(args) {
    let results;
    if (typeof this.db.getAll === 'function') {
      results = this.db.getAll();
    } else {
      results = await this.db.getAll();
    }
    
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
  
  async queryUploadedData(args) {
    const { action, datasetId, filters, limit = 100 } = args;
    
    if (!global.uploadedDatasets) {
      return {
        success: false,
        error: '暂无上传的数据集'
      };
    }
    
    if (action === 'list') {
      const datasets = Object.values(global.uploadedDatasets).map(d => ({
        id: d.id,
        name: d.name,
        columns: d.columns,
        rowCount: d.data.length
      }));
      
      return {
        success: true,
        datasets
      };
    }
    
    if (action === 'info') {
      let targetDataset = datasetId ? global.uploadedDatasets[datasetId] : null;
      if (!targetDataset) {
        const datasetKeys = Object.keys(global.uploadedDatasets);
        if (datasetKeys.length === 1) {
          targetDataset = global.uploadedDatasets[datasetKeys[0]];
        }
      }
      if (!targetDataset) {
        return {
          success: false,
          error: datasetId ? '数据集不存在' : '请提供 datasetId'
        };
      }
      
      const stats = {};
      targetDataset.columns.forEach(col => {
        const values = targetDataset.data.map(row => row[col]).filter(v => v != null && v !== '');
        if (values.length > 0) {
          const numericValues = values.map(v => parseFloat(v)).filter(v => !isNaN(v));
          if (numericValues.length > 0) {
            stats[col] = {
              type: 'numeric',
              count: values.length,
              min: Math.min(...numericValues),
              max: Math.max(...numericValues),
              avg: (numericValues.reduce((a, b) => a + b, 0) / numericValues.length).toFixed(2)
            };
          } else {
            stats[col] = {
              type: 'string',
              count: values.length,
              unique: new Set(values).size,
              sample: values.slice(0, 5)
            };
          }
        }
      });

      return {
        success: true,
        dataset: {
          id: targetDataset.id,
          name: targetDataset.name,
          columns: targetDataset.columns,
          rowCount: targetDataset.data.length,
          stats
        }
      };
    }

    if (action === 'query') {
      let targetDataset = datasetId ? global.uploadedDatasets[datasetId] : null;
      if (!targetDataset) {
        const datasetKeys = Object.keys(global.uploadedDatasets);
        if (datasetKeys.length === 1) {
          targetDataset = global.uploadedDatasets[datasetKeys[0]];
        }
      }
      if (!targetDataset) {
        return {
          success: false,
          error: datasetId ? '数据集不存在' : '请提供 datasetId'
        };
      }

      let results = targetDataset.data;
      
      if (filters) {
        results = results.filter(row => {
          for (const [key, value] of Object.entries(filters)) {
            const rowValue = String(row[key] || '').toLowerCase();
            const filterValue = String(value).toLowerCase();
            if (!rowValue.includes(filterValue)) return false;
          }
          return true;
        });
      }
      
      results = results.slice(0, limit);
      
      return {
        success: true,
        dataset: {
          id: targetDataset.id,
          name: targetDataset.name,
          columns: targetDataset.columns
        },
        count: results.length,
        total: targetDataset.data.length,
        data: results
      };
    }

    global.recentQueryResult = null;
    
    return {
      success: false,
      error: '无效的操作类型'
    };
  }
}

export { toolSchemas, AgentTools };
