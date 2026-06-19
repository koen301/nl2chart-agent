import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import xlsx from 'xlsx';
import { parse } from 'csv-parse/sync';
import { initDB } from './db/index.js';
import { DataAgent, MultiAgent, SqlAgent } from './agent/index.js';

const USE_MULTI_AGENT = process.env.USE_MULTI_AGENT === 'true';
const USE_SQL_AGENT = process.env.USE_SQL_AGENT === 'true';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const API_KEY = process.env.API_KEY;
const API_URL = process.env.API_URL;
const LLM_MODEL = process.env.LLM_MODEL;

let db;
let agent;

async function startServer() {
  db = await initDB();
  if (USE_SQL_AGENT) {
    agent = new SqlAgent(API_URL, API_KEY, LLM_MODEL, db);
    console.log('使用 SQL Agent 模式 (LLM 生成 SQL + 安全过滤)');
  } else if (USE_MULTI_AGENT) {
    agent = new MultiAgent(API_URL, API_KEY, LLM_MODEL, db);
    console.log('使用多 Agent 架构 (Planner + Executor + Reviewer)');
  } else {
    agent = new DataAgent(API_URL, API_KEY, LLM_MODEL, db);
    console.log('使用单 Agent 架构');
  }

  // SQL 网关路由注入（演示项目同进程部署）
  // 未来独立部署：把此调用挂到独立 Express 实例
  const { registerGatewayRoutes } = await import('./gateway/routes.js');
  registerGatewayRoutes(app, db);
}

app.post('/api/agent/stream', async (req, res) => {
  const { userInput } = req.body;
  if (!userInput) {
    return res.status(400).json({ error: '缺少 userInput' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    for await (const chunk of agent.executeStream(userInput)) {
      const eventData = `event: ${chunk.event}\ndata: ${JSON.stringify(chunk.data)}\n\n`;
      res.write(eventData);
    }
    
    res.write('event: end\ndata: {"type": "end"}\n\n');
    res.end();
  } catch (error) {
    console.error('Agent 流式执行失败:', error.message);
    const errorData = `event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`;
    res.write(errorData);
    res.end();
  }
});

app.get('/api/tools', async (req, res) => {
  const toolsModule = await import('./agent/tools.js');
  const { toolSchemas } = toolsModule;
  res.json({
    success: true,
    tools: Object.keys(toolSchemas).map(name => ({
      name,
      description: toolSchemas[name].description
    }))
  });
});

// SQL 网关路由已在 startServer() 内部注入（演示项目同进程部署）

const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
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
  limits: { fileSize: 10 * 1024 * 1024 },
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

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: '没有上传文件' });
  }
  
  try {
    const filePath = req.file.path;
    const { data, columns } = parseFile(filePath);
    
    const datasetId = req.file.filename;
    
    fs.unlinkSync(filePath);
    
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

    if (agent && typeof agent.refreshSchema === 'function') {
      agent.refreshSchema();
    }
    
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

const PORT = process.env.PORT || 3000;
startServer().then(() => {
  app.listen(PORT, () => {
    console.log(`后端服务运行在 http://localhost:${PORT}`);
    console.log(`Agent 流式接口: http://localhost:${PORT}/api/agent/stream`);
  });
});
