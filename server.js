require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const xlsx = require('xlsx');
const { parse } = require('csv-parse/sync');
const { initDB } = require('./db');
const { DataAgent } = require('./agent');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const API_KEY = process.env.API_KEY;
const API_URL = process.env.API_URL;
const LLM_MODEL = process.env.LLM_MODEL;

let db;
let agent;

async function startServer() {
  db = await initDB();
  agent = new DataAgent(API_URL, API_KEY, LLM_MODEL, db);
}

// 定义 Function Calling 的 Schema
const chartFunction = {
  name: 'renderChart',
  description: '根据用户自然语言描述，生成图表的配置',
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
        description: 'X轴或分类标签，例如 ["周一","周二","周三"]'
      },
      values: {
        type: 'array',
        items: { type: 'number' },
        description: '对应的数值，长度与labels相同'
      }
    },
    required: ['type', 'title', 'labels', 'values']
  }
};

// Agent 接口 - 新的智能数据分析接口
app.post('/api/agent', async (req, res) => {
  const { userInput } = req.body;
  if (!userInput) {
    return res.status(400).json({ error: '缺少 userInput' });
  }

  try {
    const result = await agent.execute(userInput);
    return res.json(result);
  } catch (error) {
    console.error('Agent 执行失败:', error.message);
    res.status(500).json({ error: 'Agent 执行错误' });
  }
});

// Agent 流式接口 (SSE)
app.post('/api/agent/stream', async (req, res) => {
  const { userInput } = req.body;
  if (!userInput) {
    return res.status(400).json({ error: '缺少 userInput' });
  }

  // 设置 SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    // 使用流式执行方法
    for await (const chunk of agent.executeStream(userInput)) {
      // 格式化 SSE 数据
      const eventData = `event: ${chunk.event}\ndata: ${JSON.stringify(chunk.data)}\n\n`;
      res.write(eventData);
    }
    
    // 发送结束事件
    res.write('event: end\ndata: {"type": "end"}\n\n');
    res.end();
  } catch (error) {
    console.error('Agent 流式执行失败:', error.message);
    const errorData = `event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`;
    res.write(errorData);
    res.end();
  }
});

// 获取可用工具列表（用于前端展示）
app.get('/api/tools', (req, res) => {
  const { toolSchemas } = require('./agent-tools');
  res.json({
    success: true,
    tools: Object.keys(toolSchemas).map(name => ({
      name,
      description: toolSchemas[name].description
    }))
  });
});

// 获取数据库概览信息
app.get('/api/data/overview', (req, res) => {
  try {
    const allData = db.getAll();
    const regions = [...new Set(allData.map(r => r.region))];
    const products = [...new Set(allData.map(r => r.product))];
    const dates = allData.map(r => r.sale_date).sort();
    
    res.json({
      success: true,
      totalRecords: allData.length,
      regions: regions,
      products: products,
      dateRange: {
        min_date: dates[0],
        max_date: dates[dates.length - 1]
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/chart', async (req, res) => {
  const { userInput } = req.body;
  if (!userInput) {
    return res.status(400).json({ error: '缺少 userInput' });
  }

  try {
    const response = await axios({
      method: 'post',
      url: API_URL,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      data: {
        model: LLM_MODEL,
        messages: [
          {
            role: 'system',
            content: `你是一个数据分析助手。用户会输入自然语言描述，你判断他想看什么图表，并调用 renderChart 函数返回图表配置。
            注意：只调用函数，不要输出额外文字。如果用户描述模糊，合理推断默认数据（例如最近一周的随机趋势数据）。`
          },
          { role: 'user', content: userInput }
        ],
        tools: [{
          type: 'function',
          function: chartFunction
        }],
        tool_choice: { type: 'function', function: { name: 'renderChart' } },  // 强制调用函数
        temperature: 0.2
      }
    });

    const toolCalls = response.data.choices[0].message.tool_calls;
    if (toolCalls && toolCalls.length > 0) {
      const chartConfig = JSON.parse(toolCalls[0].function.arguments);
      return res.json({ success: true, chartConfig });
    } else {
      // 理论上不会走到这里（因为强制 tool_choice），但兜底
      return res.json({ success: false, message: '模型未返回图表配置，请换个说法重试。' });
    }
  } catch (error) {
    console.error('AI 调用失败:', error.message);
    res.status(500).json({ error: 'AI 服务错误' });
  }
});

// 配置 multer 用于文件上传
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB 限制
  fileFilter: (req, file, cb) => {
    const allowedExt = ['.csv', '.xlsx', '.xls'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExt.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('只支持 CSV/Excel 文件'));
    }
  }
});

// 解析文件内容
function parseFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  let data = [];
  let columns = [];
  
  if (ext === '.csv') {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });
    data = records;
    if (data.length > 0) {
      columns = Object.keys(data[0]);
    }
  } else if (ext === '.xlsx' || ext === '.xls') {
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    data = xlsx.utils.sheet_to_json(worksheet);
    if (data.length > 0) {
      columns = Object.keys(data[0]);
    }
  }
  
  return { data, columns };
}

// 文件上传接口
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: '没有上传文件' });
  }
  
  try {
    const filePath = req.file.path;
    const { data, columns } = parseFile(filePath);
    
    // 生成数据集ID
    const datasetId = req.file.filename;
    
    // 清理上传的文件（保留数据在内存中）
    fs.unlinkSync(filePath);
    
    // 将数据存储到全局对象中（生产环境应使用数据库）
    if (!global.uploadedDatasets) {
      global.uploadedDatasets = {};
    }
    global.uploadedDatasets[datasetId] = {
      id: datasetId,
      name: req.file.originalname,
      columns,
      data,
      createdAt: new Date().toISOString()
    };
    
    res.json({
      success: true,
      dataset: {
        id: datasetId,
        name: req.file.originalname,
        columns,
        rowCount: data.length
      }
    });
  } catch (error) {
    console.error('文件解析失败:', error.message);
    res.status(500).json({ success: false, error: '文件解析失败: ' + error.message });
  }
});

// 获取上传的数据集列表
app.get('/api/datasets', (req, res) => {
  if (!global.uploadedDatasets) {
    return res.json({ success: true, datasets: [] });
  }
  
  const datasets = Object.values(global.uploadedDatasets).map(d => ({
    id: d.id,
    name: d.name,
    columns: d.columns,
    rowCount: d.data.length,
    createdAt: d.createdAt
  }));
  
  res.json({ success: true, datasets });
});

// 查询上传的数据集
app.post('/api/datasets/:id/query', (req, res) => {
  const { id } = req.params;
  const { query } = req.body;
  
  if (!global.uploadedDatasets || !global.uploadedDatasets[id]) {
    return res.status(404).json({ success: false, error: '数据集不存在' });
  }
  
  const dataset = global.uploadedDatasets[id];
  
  // 简单查询：支持过滤字段
  let result = dataset.data;
  
  if (req.body.filters) {
    result = result.filter(row => {
      for (const [key, value] of Object.entries(req.body.filters)) {
        if (row[key] != value) return false;
      }
      return true;
    });
  }
  
  if (req.body.limit) {
    result = result.slice(0, req.body.limit);
  }
  
  res.json({
    success: true,
    columns: dataset.columns,
    data: result,
    total: dataset.data.length
  });
});

const PORT = 3000;
startServer().then(() => {
  app.listen(PORT, () => {
    console.log(`后端服务运行在 http://localhost:${PORT}`);
    console.log(`Agent 接口: http://localhost:${PORT}/api/agent`);
    console.log(`数据概览: http://localhost:${PORT}/api/data/overview`);
  });
});
