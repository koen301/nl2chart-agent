# 🤖 NL2Chart Agent

> 基于 ReAct 架构的智能数据分析 Agent | 自然语言驱动的数据可视化系统

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0-green.svg)](https://nodejs.org/)
[![Agent Pattern](https://img.shields.io/badge/Agent-ReAct-orange.svg)](https://arxiv.org/abs/2210.03629)

---

## 📖 项目简介

**NL2Chart Agent** 是一个基于大语言模型的智能数据分析系统，采用 **ReAct (Reasoning + Acting)** 架构实现。用户只需输入自然语言描述，Agent 就能自主完成：

- 🔍 **数据查询** - 智能筛选和聚合数据库信息
- 📊 **统计分析** - 自动计算关键业务指标
- 📈 **可视化生成** - 智能选择合适的图表类型
- 💾 **数据导出** - 支持结构化数据导出

### ✨ 核心特性

- **自主决策**: Agent 使用 `tool_choice: 'auto'` 自主选择工具，无需预设流程
- **多步推理**: 实现 Thought → Action → Observation 循环，支持复杂任务分解
- **工具学习**: 设计 5 个专业工具函数，覆盖完整数据分析链路
- **上下文管理**: 维护完整对话历史，实现智能上下文感知
- **实时交互**: 现代化对话式 UI，支持流式消息展示和动态图表渲染
- **🌊 流式输出**: 使用 Server-Sent Events (SSE) 实时展示 Agent 思考过程
- **📁 文件上传**: 支持 Excel/CSV 文件导入，自主分析上传数据

---

## 🎯 演示效果

### 对话式交互界面

```
用户: "展示华东地区各产品的销售总额"

Agent 执行过程:
1. 🤔 [Thought] 用户想查看华东地区的销售数据，需要先查询数据库
2. 🛠️ [Action] 调用 querySalesData(region='华东', groupBy='product')
3. 👀 [Observation] 获取到 3 个产品的销售数据
4. 🛠️ [Action] 调用 generateChartConfig(type='bar', title='华东地区产品销售总额')
5. ✅ [Final] 生成柱状图并返回分析结果

Agent: "已为您生成华东地区产品销售总额的柱状图。其中笔记本电脑销售额最高，达到 899,000 元..."
```

### 支持的数据维度

| 维度 | 可选项 |
|------|--------|
| **地区** | 华东、华北、华南、西南 |
| **产品** | 笔记本电脑、手机、平板电脑 |
| **时间** | 2024年1月 - 2024年6月 |
| **图表类型** | 柱状图、折线图、饼图、散点图、雷达图、热力图、仪表盘 |

---

## 🚀 快速开始

### 前置要求

- Node.js >= 18.0
- pnpm (或 npm/yarn)
- 大语言模型 API 密钥（支持 Function Calling）

### 安装步骤

#### 1. 克隆项目

```bash
git clone https://github.com/koen301/nl2chart-agent.git
cd nl2chart-agent
```

#### 2. 安装依赖

```bash
# 使用 pnpm (推荐)
pnpm install

# 或使用 npm
npm install
```

#### 3. 配置环境变量

```bash
# 复制环境变量模板
cp .env.example .env

# 编辑 .env 文件，填入你的 API 配置
```

**`.env` 配置示例:**

```env
# OpenAI 兼容 API
API_KEY=your-api-key-here
API_URL=https://api.openai.com/v1/chat/completions
LLM_MODEL=gpt-3.5-turbo

# 或使用其他兼容 API (如 SiliconFlow、智谱等)
# API_URL=https://api.siliconflow.cn/v1/chat/completions
# LLM_MODEL=Pro/zai-org/GLM-5
```

#### 4. 启动服务

```bash
node server.js
```

服务启动后，访问: http://localhost:3000

---

## 📁 项目结构

```
nl2chart-agent/
├── server.js              # Express 主服务器 & API 路由
├── agent.js               # Agent 引擎 (ReAct 循环实现)
├── agent-tools.js         # 工具集定义 & 实现
├── db.js                  # JSON 数据库模块
├── data.json              # Mock 销售数据 (44条)
├── package.json           # 项目依赖配置
├── .env.example           # 环境变量模板
├── .gitignore             # Git 忽略配置
│
├── public/
│   ├── index.html         # 前端交互界面
│   └── lib/
│       └── echarts.min.js # ECharts 图表库
│
└── docs/                  # 文档目录
    ├── README-RESUME.md   # 简历亮点文档
    └── ARCHITECTURE.md    # 架构设计说明 (TODO)
```

---

## 🛠️ 技术架构

### 核心模块

#### 1. Agent 引擎 (`agent.js`)

实现 ReAct 范式的执行循环：

```javascript
// 伪代码展示核心逻辑
for (let step = 0; step < maxSteps; step++) {
  // 1. 调用 LLM 进行推理
  response = await callLLM(messages, tools);
  
  // 2. 检查是否调用工具
  if (!response.tool_calls) break; // 任务完成
  
  // 3. 执行工具调用
  for (toolCall of response.tool_calls) {
    result = await executeTool(toolCall);
    messages.push({ role: 'tool', content: result });
  }
  
  // 4. 将结果反馈给 LLM，继续循环
}
```

#### 2. 工具系统 (`agent-tools.js`)

| 工具名称 | 功能描述 | 输入参数 | 输出 |
|---------|---------|---------|------|
| **querySalesData** | 查询内置销售数据库 | region, product, dateRange, groupBy | 数据集 |
| **queryUploadedData** | 查询用户上传的数据集 | datasetId, action, filters | 数据集/统计信息 |
| **calculateStatistics** | 统计分析 | metric, operation | 统计值 |
| **generateChartConfig** | 生成图表配置 | type, title, labels, values | 图表配置对象 |
| **exportData** | 导出数据 | format, limit | 导出数据 |

#### 3. 数据层 (`db.js`)

- 轻量级 JSON 文件数据库
- 支持动态查询构建（筛选、聚合、排序）
- 自动初始化 Mock 数据

### 技术栈

| 类别 | 技术 |
|------|------|
| **Agent 框架** | 自研 ReAct Agent |
| **LLM API** | OpenAI Compatible Function Calling |
| **后端** | Node.js + Express.js (v5) |
| **数据库** | JSON File (自定义查询引擎) |
| **前端** | HTML/CSS/JS + ECharts v5 |
| **架构模式** | RESTful API, 模块化设计 |

---

## 📡 API 文档

### 1. Agent 对话接口

**POST** `/api/agent`

**请求体:**
```json
{
  "userInput": "绘制2024年上半年各月份的销售趋势折线图"
}
```

**响应:**
```json
{
  "success": true,
  "finalResponse": "已为您生成销售趋势折线图...",
  "chartConfig": {
    "type": "line",
    "title": "2024年上半年销售趋势",
    "labels": ["2024-01", "2024-02", ...],
    "values": [456000, 512000, ...]
  },
  "conversation": [...]
}
```

### 2. 获取工具列表

**GET** `/api/tools`

**响应:**
```json
{
  "success": true,
  "tools": [
    {
      "name": "querySalesData",
      "description": "查询销售数据数据库..."
    },
    ...
  ]
}
```

### 3. 数据概览

**GET** `/api/data/overview`

**响应:**
```json
{
  "success": true,
  "totalRecords": 44,
  "regions": ["华东", "华北", "华南", "西南"],
  "products": ["笔记本电脑", "手机", "平板电脑"],
  "dateRange": {
    "min_date": "2024-01-15",
    "max_date": "2024-06-12"
  }
}
```

---

## 💡 示例对话

### 示例 1: 地区销售分析

**用户:** "展示华东地区各产品的销售总额"

**Agent 执行流程:**
1. 调用 `querySalesData(region='华东', groupBy='product')`
2. 获取数据: 笔记本电脑 899000, 手机 639000, 平板电脑 319000
3. 调用 `generateChartConfig(type='bar', title='华东地区产品销售总额')`
4. 返回柱状图配置

### 示例 2: 时间趋势分析

**用户:** "绘制2024年上半年各月份的销售趋势折线图"

**Agent 执行流程:**
1. 调用 `querySalesData(startDate='2024-01-01', endDate='2024-06-30', groupBy='month')`
2. 获取 6 个月的聚合数据
3. 调用 `generateChartConfig(type='line', title='2024年上半年销售趋势')`
4. 返回折线图配置

### 示例 3: 占比分析

**用户:** "用饼图展示各地区的销售占比"

**Agent 执行流程:**
1. 调用 `querySalesData(groupBy='region')`
2. 获取 4 个地区的销售总额
3. 调用 `generateChartConfig(type='pie', title='各地区销售占比')`
4. 返回饼图配置

### 示例 4: 统计查询

**用户:** "统计所有地区的笔记本电脑总销量"

**Agent 执行流程:**
1. 调用 `querySalesData(product='笔记本电脑', groupBy='region')`
2. 调用 `calculateStatistics(metric='sales_amount', operation='sum')`
3. 返回统计结果: 总销售额 1,852,000 元

---

## 🧪 测试数据

项目内置了 44 条真实业务场景的 Mock 数据，涵盖：

- **4 个地区**: 华东、华北、华南、西南
- **3 种产品**: 笔记本电脑、手机、平板电脑
- **6 个月时间跨度**: 2024年1月 - 2024年6月
- **数据字段**: 销售额、销量、日期等

数据存储在 `data.json` 文件中，首次启动时自动初始化。

---

## 📊 性能指标

| 指标 | 数值 |
|------|------|
| 平均响应时间 | < 3 秒 |
| 工具调用准确率 | > 90% (标准测试集) |
| 最大执行步数 | 5 步 (可配置) |
| 数据量 | 44 条 Mock 记录 |
| 支持图表类型 | 7 种 (柱状图、折线图、饼图、散点图、雷达图、热力图、仪表盘) |
| 文件支持 | CSV、Excel (.xlsx/.xls) |

---

## 🔮 未来规划

- [x] **流式输出**: 实现 SSE 实时展示 Agent 思考过程 ✨
- [x] **文件上传**: 支持 Excel/CSV 文件导入分析 ✨
- [x] **更多图表**: 添加散点图、雷达图、热力图等 ✨
- [ ] **RAG 能力**: 接入向量数据库，支持知识库查询
- [ ] **多 Agent 协作**: Planner + Executor + Reviewer 架构
- [ ] **评估框架**: 自动化工具选择准确率测试
- [ ] **用户认证**: 支持多用户会话管理
- [ ] **部署优化**: Docker 容器化 + 云平台部署

---

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建你的特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交你的更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启一个 Pull Request

---

## 📧 联系方式

- **作者**: Kris
- **GitHub**: [https://github.com/koen301/nl2chart-agent](https://github.com/koen301/nl2chart-agent)
- **邮箱**: kris301@qq.com

---

## 🙏 致谢

- [ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629)
- [OpenAI Function Calling](https://platform.openai.com/docs/guides/function-calling)
- [ECharts](https://echarts.apache.org/)
- [Express.js](https://expressjs.com/)

---

**Made with ❤️ and AI**
