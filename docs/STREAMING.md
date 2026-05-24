# 🌊 流式输出功能说明

> 使用 Server-Sent Events (SSE) 实时展示 Agent 思考过程

---

## 📖 功能概述

流式输出功能允许前端实时接收并展示 Agent 的执行过程，包括：

- ✅ **步骤展示** - 显示当前执行到第几步
- ✅ **工具调用** - 实时展示调用的工具和参数
- ✅ **工具结果** - 显示工具执行结果摘要
- ✅ **最终响应** - 展示 Agent 的最终分析结果
- ✅ **图表渲染** - 自动生成并渲染可视化图表

---

## 🎯 效果展示

### 传统方式（非流式）
```
用户: "展示华东地区各产品的销售总额"
[等待 3-5 秒...]
Agent: "已为您生成华东地区产品销售总额的柱状图..."
```

### 流式方式（实时展示）
```
用户: "展示华东地区各产品的销售总额"

Agent: 
  正在执行第 1 步...
  🛠️ 调用工具: querySalesData
  { region: '华东', groupBy: 'product' }
  ✅ 获取到 3 条数据

  正在执行第 2 步...
  🛠️ 调用工具: generateChartConfig
  { type: 'bar', title: '华东地区产品销售总额' }
  ✅ 生成 bar 图: 华东地区产品销售总额

  📊 分析结果:
  已为您生成华东地区产品销售总额的柱状图。其中笔记本电脑销售额最高...
```

---

## 🔧 技术实现

### 1. 后端 SSE 端点

**路由:** `POST /api/agent/stream`

**请求体:**
```json
{
  "userInput": "展示华东地区各产品的销售总额"
}
```

**响应格式 (SSE):**
```
event: step
data: {"type":"step_start","step":1,"message":"正在执行第 1 步..."}

event: tool_call
data: {"type":"tool_call","tool":"querySalesData","args":{"region":"华东","groupBy":"product"},"step":1}

event: tool_result
data: {"type":"tool_result","tool":"querySalesData","result":{"success":true,"count":3,"summary":"获取到 3 条数据"},"step":1}

event: complete
data: {"type":"final_response","content":"已为您生成...","chartConfig":{...}}

event: end
data: {"type":"end"}
```

### 2. Agent 流式执行方法

使用 JavaScript Generator 函数 (`async *executeStream`) 实现：

```javascript
async *executeStream(userInput) {
  // 初始化消息历史
  
  for (let step = 0; step < this.maxSteps; step++) {
    // 发送步骤开始事件
    yield {
      event: 'step',
      data: { type: 'step_start', step: step + 1, message: '...' }
    };
    
    // 调用 LLM
    const response = await axios({...});
    
    // 如果不调用工具，任务完成
    if (!message.tool_calls) {
      yield {
        event: 'complete',
        data: { type: 'final_response', content: message.content }
      };
      return;
    }
    
    // 执行工具调用
    for (const toolCall of message.tool_calls) {
      // 发送工具调用事件
      yield {
        event: 'tool_call',
        data: { type: 'tool_call', tool: toolName, args: args }
      };
      
      // 执行工具
      const result = await this.tools[toolName](args);
      
      // 发送工具结果事件
      yield {
        event: 'tool_result',
        data: { type: 'tool_result', tool: toolName, result: result }
      };
    }
  }
}
```

### 3. 前端 EventSource 实现

自定义 EventSource 支持 POST 请求：

```javascript
class EventSourcePolyfill {
  constructor(url, body) {
    this.url = url;
    this.body = body;
    this.listeners = {};
    this.connect();
  }
  
  connect() {
    fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(this.body)
    })
    .then(response => {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      
      // 读取流式数据
      const readStream = () => {
        reader.read().then(({ done, value }) => {
          if (done) return;
          
          // 解析 SSE 格式
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          
          // 触发对应事件
          for (const line of lines) {
            if (line.startsWith('event:')) {
              currentEvent = line.substring(6).trim();
            } else if (line.startsWith('data:')) {
              currentData = line.substring(5).trim();
            } else if (line.trim() === '') {
              this.listeners[currentEvent]?.forEach(cb => cb({ data: currentData }));
            }
          }
          
          readStream();
        });
      };
      
      readStream();
    });
  }
}
```

---

## 📡 SSE 事件类型

| 事件名称 | 触发时机 | 数据格式 |
|---------|---------|---------|
| **step** | 开始执行新步骤 | `{ type: 'step_start', step: number, message: string }` |
| **tool_call** | 调用工具时 | `{ type: 'tool_call', tool: string, args: object, step: number }` |
| **tool_result** | 工具执行完成 | `{ type: 'tool_result', tool: string, result: object, step: number }` |
| **complete** | Agent 执行完成 | `{ type: 'final_response', content: string, chartConfig: object }` |
| **error** | 发生错误时 | `{ type: 'error', error: string }` |
| **end** | 流结束 | `{ type: 'end' }` |

---

## 🎨 前端展示效果

### 步骤指示器
```html
<div class="step-indicator">第 1 步</div>
```
显示当前执行步骤，使用蓝色背景突出显示。

### 工具调用卡片
```html
<div class="tool-call">
  <div class="step-indicator">第 1 步</div>
  <div class="tool-name">🛠️ 调用工具: querySalesData</div>
  <div class="args-preview">{ "region": "华东", "groupBy": "product" }</div>
</div>
```
黄色背景，展示工具名称和参数预览。

### 工具结果卡片
```html
<div class="tool-result">
  ✅ 获取到 3 条数据
</div>
```
绿色背景，展示执行结果摘要。

### 最终响应
```html
<div class="final-response">
  <strong>📊 分析结果:</strong>
  <p>已为您生成华东地区产品销售总额的柱状图...</p>
</div>
```
蓝色背景，展示 Agent 的最终回答。

---

## 🚀 使用方法

### 1. 启动服务器

```bash
pnpm start
```

### 2. 访问前端页面

打开浏览器访问: http://localhost:3000

### 3. 输入自然语言查询

在对话框中输入您的需求，例如：
- "展示华东地区各产品的销售总额"
- "绘制2024年上半年各月份的销售趋势折线图"
- "用饼图展示各地区的销售占比"

### 4. 实时观看执行过程

你会看到 Agent 的完整思考过程：
1. 🤔 分析需求
2. 🛠️ 调用工具（显示工具名和参数）
3. ✅ 展示工具执行结果
4. 📊 生成最终答案和图表

---

## 🔍 调试技巧

### 1. 查看浏览器控制台

打开浏览器开发者工具（F12），可以看到：
- Network 标签：查看 SSE 连接和数据流
- Console 标签：查看日志输出

### 2. 查看服务器日志

服务器会输出详细的执行日志：
```
=== Agent 流式执行开始 ===
用户需求: 展示华东地区各产品的销售总额

--- 第 1 步 ---
LLM 回复: [调用工具]
调用工具: querySalesData { region: '华东', groupBy: 'product' }
工具返回: { success: true, count: 3, data: [...] }

--- 第 2 步 ---
LLM 回复: [调用工具]
调用工具: generateChartConfig { type: 'bar', title: '...' }
工具返回: { success: true, config: {...} }

=== Agent 执行完成 ===
```

### 3. 使用 curl 测试 SSE 端点

```bash
curl -X POST http://localhost:3000/api/agent/stream \
  -H "Content-Type: application/json" \
  -d '{"userInput":"展示华东地区各产品的销售总额"}' \
  -N
```

`-N` 参数表示不使用缓冲，实时输出。

---

## 🎯 优势对比

### 传统方式 vs 流式方式

| 特性 | 传统方式 | 流式方式 |
|------|---------|---------|
| **响应速度** | 等待全部完成 | 实时展示 |
| **用户体验** | 黑盒，不知道在做什么 | 透明，可以看到每一步 |
| **调试难度** | 难以定位问题 | 容易发现错误步骤 |
| **等待焦虑** | 用户可能以为卡住了 | 用户知道正在处理 |
| **可解释性** | 低 | 高（展示完整推理链） |

---

## 🔮 未来优化方向

- [ ] **打字机效果** - 最终响应逐字显示
- [ ] **进度条** - 显示整体执行进度
- [ ] **时间统计** - 显示每步耗时
- [ ] **可视化执行图** - 用图形展示 Thought-Action-Observation 流程
- [ ] **中断功能** - 允许用户中途取消执行
- [ ] **历史记录** - 保存完整的执行过程供回放

---

## 📚 相关资源

- [Server-Sent Events 规范](https://html.spec.whatwg.org/multipage/server-sent-events.html)
- [MDN: Using server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)
- [ReAct Paper](https://arxiv.org/abs/2210.03629)

---

**流式输出让 Agent 的思考过程更加透明和可解释！** 🌊✨
