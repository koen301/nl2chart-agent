# 🤖 NL2Chart Agent

> 基于 ReAct 架构的智能数据分析 Agent | 自然语言驱动的数据可视化系统

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0-green.svg)](https://nodejs.org/)
[![Agent Pattern](https://img.shields.io/badge/Agent-ReAct-orange.svg)](https://arxiv.org/abs/2210.03629)
[![AI SDK Branch](https://img.shields.io/badge/分支-ai--sdk-FF4785.svg?logo=vercel&logoColor=white)](https://github.com/koen301/nl2chart-agent/tree/ai-sdk)

---

## 🏢 产品矩阵

> NL2Chart Agent 同时提供**两条交付路径**，对应企业落地中两类典型决策：**可控自研** vs **快速演进**。

| 分支 | 定位 | 核心价值 | 适用场景 |
|------|------|----------|----------|
| [`main`](https://github.com/koen301/nl2chart-agent/tree/main) **(生产稳定版)** | **自研可控** —— 零 LLM 框架依赖，原生 OpenAI 协议级集成 | ✅ 供应链零风险 / 私有化 & 信创合规 / 协议级审计 / 任意深度定制 | 金融、政务、医疗等**强合规**场景；自建 LLM 网关；需要白盒排障的生产环境 |
| [`ai-sdk`](https://github.com/koen301/nl2chart-agent/tree/ai-sdk) **(快速演进版)** | **AI SDK 驱动** —— `streamText` + Zod + `@ai-sdk/openai-compatible` | ✅ 30% 代码量 / 内置多 Provider 切换 / 类型安全 / 社区活跃迭代 | 互联网产品 / PoC 验证 / 频繁切换模型厂商 / 团队偏 TypeScript 类型工程化 |

**两分支均完整具备** SQL 安全网关、流式响应、多 Agent 架构、文件上传、CSV/Excel 数据导入、ECharts 可视化等企业级能力，按需选择技术栈。

---

## 🌍 在线演示

**在线体验地址**: [https://nl2chart-agent-production-91df.up.railway.app/](https://nl2chart-agent-production-91df.up.railway.app/)

> ⚠️ 注意：演示环境使用的免费 LLM API 可能存在调用限制，如遇问题请自行部署。

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
- **🤖 多 Agent 协作**（可选）: Planner + Executor + Reviewer 架构，避免单 Agent 盲目执行问题
- **🛡️ SQL Agent 模式**（可选）: LLM 自动生成 SQL + Schema 注入 + 网关安全过滤
- **🚧 SQL 网关**: 独立网关层（可拆分为独立服务），集中处理 SQL 安全校验、行数限制

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
| **图表类型** | 柱状图、折线图、饼图、环形图、散点图、雷达图、热力图、仪表盘 |

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

# 多 Agent 架构 (可选，默认单 Agent)
# USE_MULTI_AGENT=true  # 启用 Planner + Executor + Reviewer 多 Agent 协作
# USE_MULTI_AGENT=false # 使用单 Agent 架构 (默认)

# SQL Agent 模式 (可选)
# USE_SQL_AGENT=true   # 启用 SQL Agent (LLM 生成 SQL + 安全过滤)
# USE_SQL_AGENT=false  # 不使用 (默认)

# 数据库配置 (可选)
# DB_TYPE=json    # 默认使用 JSON File，无需配置
# DB_TYPE=mysql  # 使用 MySQL，需要配置以下参数
# MYSQL_HOST=localhost
# MYSQL_PORT=3306
# MYSQL_USER=root
# MYSQL_PASSWORD=your-password
# MYSQL_DATABASE=nl2chart
```

#### 4. 启动服务

```bash
pnpm start
# 或
node src/index.js
```

服务启动后，访问: http://localhost:3000

> 💡 若启动后 Agent 调用报 `getaddrinfo EAI_AGAIN ...`（本地 DNS 偶发解析失败），改用：
> ```bash
> pnpm start:dnssafe
> ```

---

## 📁 项目结构

```
nl2chart-agent/
├── src/                     # 源代码目录
│   ├── index.js             # Express 主服务器 & API 路由（含网关路由注入）
│   ├── agent/               # Agent 模块
│   │   ├── index.js         # Agent 入口 (根据环境变量选择模式)
│   │   ├── agent.js         # 单 Agent 引擎 (ReAct 循环)
│   │   ├── multi-agent.js   # 多 Agent 引擎 (Planner + Executor + Reviewer)
│   │   ├── sql-agent.js     # SQL Agent 引擎 (LLM 生成 SQL，过 HTTP 调网关)
│   │   └── tools.js         # 工具集定义 & 实现
│   ├── engines/             # 执行引擎（按数据源拆分）
│   │   ├── index.js         # 工厂：按 db.type 自动选择引擎
│   │   ├── mysql-engine.js  # MySQL 引擎：直连 DB，无 SQL 解析
│   │   └── json-engine.js   # JSON 引擎：node-sql-parser + 内存模拟执行
│   ├── gateway/             # SQL 网关（独立模块，可拆分部署）
│   │   ├── safety-filter.js # 网关唯一安全边界（黑名单 + 长度限制 + 系统表拦截）
│   │   ├── sql-gateway.js   # 网关核心：校验 → 委托引擎 → 限行
│   │   ├── routes.js        # HTTP 路由：/api/sql/query, /api/sql/schema
│   │   └── standalone.js    # 独立服务启动入口（生产用）
│   └── db/                  # 数据库模块
│       ├── index.js         # 数据库入口
│       └── db.js            # 数据库实现 (JSON File / MySQL)
├── data/                    # 数据目录
│   └── sales.json           # JSON 数据库文件 (44 条 Mock 数据)
├── public/                  # 静态资源目录
│   ├── index.html           # 前端交互界面 (含 ECharts 渲染)
│   └── lib/
│       └── echarts.min.js   # ECharts 图表库
├── uploads/                 # 上传文件目录 (运行时生成)
├── docs/                    # 文档目录
│   └── STREAMING.md         # 流式输出功能说明
├── package.json             # 项目依赖配置
├── .env.example             # 环境变量模板
└── .gitignore               # Git 忽略配置
```

---

## 🛠️ 技术架构

### 核心模块

#### 1. Agent 引擎 (`agent.js`)

实现 ReAct 范式的执行循环（单 Agent 模式）：

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

#### 2. 多 Agent 架构 (`multi-agent.js`)

启用 `USE_MULTI_AGENT=true` 后使用，Planner + Executor + Reviewer 协作模式：

```
用户输入 → Planner（规划步骤） → Executor（执行工具） → Reviewer（审查结果）
                                              ↓
                                          循环直到完成或达到最大步数
```

- **Planner**: 理解用户需求，制定执行计划
- **Executor**: 根据计划调用具体工具
- **Reviewer**: 审查执行结果，判断是否继续或终止

#### 3. SQL Agent 架构 (`sql-agent.js`)

启用 `USE_SQL_AGENT=true` 后使用，LLM 自动生成 SQL，通过 HTTP 走 SQL 网关执行：

```
用户输入 → LLM 推理 → 生成 SQL → POST /api/sql/query（网关）→ 安全过滤 → 执行 → 生成图表
```

**核心特性：**
- **Schema 注入**: 通过 `GET /api/sql/schema` 自动注入数据库表结构，LLM 知道有哪些字段
- **安全过滤**（集中在网关 `safety-filter.js`，agent 层不重复）：
  - 禁止 DROP/DELETE/UPDATE/INSERT 等修改操作
  - 禁止访问系统表（mysql/information_schema 等）
  - 限制 SQL 长度（2000 字符）
- **执行引擎**（按数据源自动选择）：
  - **JSON 模式**: 走 `JsonEngine`，使用 `node-sql-parser` 解析 AST，在内存中执行
  - **MySQL 模式**: 走 `MySqlEngine`，**不解析 SQL**，直接交给 DB 执行
- **行数限制**: 网关自动追加 `LIMIT N`，防止返回大量数据影响 LLM
- **支持完整 SQL 语法**: WHERE、GROUP BY、HAVING、ORDER BY、LIMIT、聚合函数

#### 4. SQL 网关 (`gateway/`)

集中安全边界，统一数据通道：

```
┌─────────────┐     HTTP       ┌─────────────────┐
│  Agent / 前端 │ ─────────────→ │   SQL 网关       │
│  （不连 DB）  │  /api/sql/*    │ safety-filter   │
└─────────────┘                 │  ├─ 黑名单       │
                                │  ├─ 长度限制     │
                                │  └─ 系统表拦截   │
                                │       ↓         │
                                │   引擎调度       │
                                │  ├─ MySqlEngine │
                                │  └─ JsonEngine  │
                                └─────────────────┘
```

**演示项目（当前）：** 同进程内嵌，由 `src/index.js` 在 `startServer()` 中注入路由  
**生产部署：** 删除该行 + `pnpm gateway:standalone` 启动独立服务，Agent 通过 `gatewayConfig.gatewayUrl` 指向新地址

#### 4. 工具系统 (`tools.js`)

**单 Agent / 多 Agent 模式（5 个工具）：**

| 工具名称 | 功能描述 | 输入参数 | 输出 |
|---------|---------|---------|------|
| **querySalesData** | 查询内置销售数据库 | region, product, startDate, endDate, groupBy | 数据集 |
| **queryUploadedData** | 查询用户上传的数据集 | action, datasetId, filters, limit | 数据集/统计信息 |
| **calculateStatistics** | 统计分析 | metric, operation (sum/avg/max/min/count) | 统计值 |
| **generateChartConfig** | 生成图表配置 | type, title, labels, values, xLabel, yLabel | 图表配置对象 |
| **exportData** | 导出数据 | format, limit | 导出数据 |

**SQL Agent 模式（3 个工具）：**

| 工具名称 | 功能描述 | 输入参数 | 输出 |
|---------|---------|---------|------|
| **executeSql** | 执行 SQL 查询 | sql (SELECT 语句) | 查询结果 |
| **generateChartConfig** | 生成图表配置 | type, title, labels, values | 图表配置对象 |
| **exportData** | 导出数据 | format, limit | 导出数据 |

**支持 8 种图表类型：** 柱状图 (bar)、折线图 (line)、饼图 (pie)、环形图 (doughnut)、散点图 (scatter)、雷达图 (radar)、热力图 (heatmap)、仪表盘 (gauge)

#### 6. 数据层 (`db.js`)

- 支持 **JSON File**（默认）和 **MySQL** 两种数据库
- JSON File 模式：零配置即用，适合开发和演示
- MySQL 模式：配置环境变量即可切换，适合生产环境
- 自动初始化 Mock 数据（44条销售记录）

### 技术栈

| 类别 | 技术 |
|------|------|
| **Agent 框架** | 自研 ReAct Agent |
| **LLM API** | OpenAI Compatible Function Calling |
| **后端** | Node.js + Express.js (v5) |
| **数据库** | JSON File / MySQL (可配置) |
| **前端** | HTML/CSS/JS + ECharts v5 |
| **架构模式** | RESTful API, 模块化设计 |

---

## 📡 API 文档

### 1. Agent 对话接口（SSE 流式）

**POST** `/api/agent/stream`

**请求体:**
```json
{
  "userInput": "绘制2024年上半年各月份的销售趋势折线图"
}
```

**响应:** `Content-Type: text/event-stream`（Server-Sent Events），按 `event:` 推送以下事件：

| Event | data.type | 说明 |
|-------|-----------|------|
| `step` | `step_start` | Agent 进入新一步（`data.step` 为步号） |
| `message` | `content` | LLM 思考/总结的增量文本 |
| `tool_call` | — | LLM 决定调用某个工具（`data.tool`、`data.args`） |
| `tool_result` | — | 工具执行结果摘要（`data.result.summary`） |
| `complete` | — | 整轮结束，附带最终 `chartConfig`（若有） |
| `end` | — | 流结束 |
| `error` | — | 错误信息（`data.error`） |

**完整示例**（含图表配置）：

```
event: complete
data: {"chartConfig": {"type":"line","title":"2024年上半年销售趋势","labels":["2024-01",...], "values":[456000, 512000, ...]}}
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

### 3. SQL 网关 - 查询执行

**POST** `/api/sql/query`

**请求体:**
```json
{
  "sql": "SELECT region, SUM(sales_amount) AS total FROM sales GROUP BY region",
  "maxRows": 1000
}
```

**响应:**
```json
{
  "success": true,
  "data": [{ "region": "华东", "total": 1234567 }],
  "count": 4,
  "limit": 1000,
  "truncated": false,
  "duration": 23,
  "engine": "mysql"
}
```

**安全校验失败（400）:**
```json
{
  "success": false,
  "error": "SQL 安全校验失败",
  "reason": "只允许 SELECT 查询语句",
  "code": "SQL_UNSAFE"
}
```

### 4. SQL 网关 - 获取 Schema

**GET** `/api/sql/schema` — 返回 JSON 结构

**GET** `/api/sql/schema?format=text` — 返回纯文本（注入到 system prompt）

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
| 支持图表类型 | 8 种 (柱状图、折线图、饼图、环形图、散点图、雷达图、热力图、仪表盘) |
| 文件支持 | CSV、Excel (.xlsx/.xls) |

---

## 🔮 未来规划

- [ ] **评估框架**: 自动化工具选择准确率测试
- [ ] **部署优化**: Docker 容器化 + 云平台部署
- [ ] **SQL 网关独立部署**: 拆为独立进程/容器，Agent 通过 `gatewayConfig.gatewayUrl` 指向

> **关于鉴权 / 多租户 / 多轮会话 / 限流配额**：本服务的 Agent 始终是**无状态**的——不内置用户认证、会话存储、多轮上下文与限流。
>
> 这些横切关注点由前置层负责（Auth Gateway / BFF 负责鉴权、多租户与限流，Session Store 负责历史持久化），Agent 只需把历史作为 `messages` 数组前缀注入即可。好处是：Agent 保持单一职责，可水平扩展，同一套代码可被多种身份方案复用。

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
