require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { initDB } = require('./db');
const { DataAgent } = require('./agent');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));  // 托管前端页面

const API_KEY = process.env.API_KEY;
const API_URL = process.env.API_URL;
const LLM_MODEL = process.env.LLM_MODEL;

// 初始化数据库
const db = initDB();

// 初始化 Agent
const agent = new DataAgent(API_URL, API_KEY, LLM_MODEL, db);

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

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`后端服务运行在 http://localhost:${PORT}`);
  console.log(`Agent 接口: http://localhost:${PORT}/api/agent`);
  console.log(`数据概览: http://localhost:${PORT}/api/data/overview`);
});
