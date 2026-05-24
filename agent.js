const axios = require('axios');
const { AgentTools } = require('./agent-tools');

class DataAgent {
  constructor(apiUrl, apiKey, model, db) {
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
    this.model = model;
    this.tools = new AgentTools(db);
    this.maxSteps = 5; // 最大执行步数
  }
  
  // Agent 主执行循环（ReAct 模式）- 非流式版本
  async execute(userInput) {
    console.log('\n=== Agent 开始执行 ===');
    console.log('用户需求:', userInput);
    
    // 初始化消息历史
    let messages = [
      {
        role: 'system',
        content: `你是一个智能数据分析 Agent，拥有多种工具帮助用户分析和可视化数据。

执行流程：
1. 分析用户需求，理解用户想看什么数据
2. 选择合适的工具查询数据（querySalesData）
3. 根据需要进行统计分析（calculateStatistics）
4. 生成可视化图表配置（generateChartConfig）
5. 如果需要，导出数据（exportData）

重要规则：
- 先查询数据，再生成图表
- 图表必须基于真实查询结果
- 如果用户需求模糊，合理推断并说明
- 最后输出总结性文字给用户`
      },
      { role: 'user', content: userInput }
    ];
    
    // 获取工具 schemas
    const tools = Object.values(require('./agent-tools').toolSchemas).map(schema => ({
      type: 'function',
      function: schema
    }));
    
    // 执行循环
    for (let step = 0; step < this.maxSteps; step++) {
      console.log(`\n--- 第 ${step + 1} 步 ---`);
      
      try {
        // 调用 LLM
        const response = await axios({
          method: 'post',
          url: this.apiUrl,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
          },
          data: {
            model: this.model,
            messages: messages,
            tools: tools,
            tool_choice: 'auto', // 让模型自主决策
            temperature: 0.2
          }
        });
        
        const message = response.data.choices[0].message;
        messages.push(message);
        
        console.log('LLM 回复:', message.content || '[调用工具]');
        
        // 如果不调用工具，说明任务完成
        if (!message.tool_calls || message.tool_calls.length === 0) {
          console.log('\n=== Agent 执行完成 ===');
          return {
            success: true,
            finalResponse: message.content,
            conversation: messages,
            chartConfig: this.extractChartConfig(messages)
          };
        }
        
        // 执行工具调用
        for (const toolCall of message.tool_calls) {
          const toolName = toolCall.function.name;
          const args = JSON.parse(toolCall.function.arguments);
          
          console.log(`调用工具: ${toolName}`, args);
          
          // 执行对应的工具函数
          let result;
          if (this.tools[toolName]) {
            result = await this.tools[toolName](args);
          } else {
            result = { success: false, error: `未知工具: ${toolName}` };
          }
          
          console.log('工具返回:', JSON.stringify(result).substring(0, 200));
          
          // 将工具结果添加到消息历史
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(result)
          });
        }
        
      } catch (error) {
        console.error('Agent 执行错误:', error.message);
        return {
          success: false,
          error: error.message,
          conversation: messages
        };
      }
    }
    
    // 达到最大步数
    console.log('\n=== 达到最大执行步数 ===');
    return {
      success: true,
      finalResponse: '已达到最大执行步数，请简化您的需求',
      conversation: messages,
      chartConfig: this.extractChartConfig(messages)
    };
  }
  
  // Agent 流式执行方法（SSE）
  async *executeStream(userInput) {
    console.log('\n=== Agent 流式执行开始 ===');
    console.log('用户需求:', userInput);
    
    // 初始化消息历史
    let messages = [
      {
        role: 'system',
        content: `你是一个智能数据分析 Agent，拥有多种工具帮助用户分析和可视化数据。

执行流程：
1. 分析用户需求，理解用户想看什么数据
2. 选择合适的工具查询数据（querySalesData）
3. 根据需要进行统计分析（calculateStatistics）
4. 生成可视化图表配置（generateChartConfig）
5. 如果需要，导出数据（exportData）

重要规则：
- 先查询数据，再生成图表
- 图表必须基于真实查询结果
- 如果用户需求模糊，合理推断并说明
- 最后输出总结性文字给用户`
      },
      { role: 'user', content: userInput }
    ];
    
    // 获取工具 schemas
    const tools = Object.values(require('./agent-tools').toolSchemas).map(schema => ({
      type: 'function',
      function: schema
    }));
    
    let chartConfig = null;
    
    // 执行循环
    for (let step = 0; step < this.maxSteps; step++) {
      console.log(`\n--- 第 ${step + 1} 步 ---`);
      
      try {
        // 发送步骤开始事件
        yield {
          event: 'step',
          data: {
            type: 'step_start',
            step: step + 1,
            message: `正在执行第 ${step + 1} 步...`
          }
        };
        
        // 调用 LLM
        const response = await axios({
          method: 'post',
          url: this.apiUrl,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
          },
          data: {
            model: this.model,
            messages: messages,
            tools: tools,
            tool_choice: 'auto',
            temperature: 0.2
          }
        });
        
        const message = response.data.choices[0].message;
        messages.push(message);
        
        console.log('LLM 回复:', message.content || '[调用工具]');
        
        // 如果不调用工具，说明任务完成
        if (!message.tool_calls || message.tool_calls.length === 0) {
          console.log('\n=== Agent 执行完成 ===');
          
          // 流式发送内容（每 20 个字符发送一次）
          const content = message.content;
          const chunkSize = 20;
          for (let i = 0; i < content.length; i += chunkSize) {
            yield {
              event: 'message',
              data: {
                type: 'content',
                content: content.substring(i, i + chunkSize),
                isEnd: false
              }
            };
          }
          
          yield {
            event: 'complete',
            data: {
              type: 'final_response',
              content: message.content,
              chartConfig: chartConfig
            }
          };
          
          return;
        }
        
        // 执行工具调用
        for (const toolCall of message.tool_calls) {
          const toolName = toolCall.function.name;
          const args = JSON.parse(toolCall.function.arguments);
          
          console.log(`调用工具: ${toolName}`, args);
          
          // 发送工具调用事件
          yield {
            event: 'tool_call',
            data: {
              type: 'tool_call',
              tool: toolName,
              args: args,
              step: step + 1
            }
          };
          
          // 执行对应的工具函数
          let result;
          if (this.tools[toolName]) {
            result = await this.tools[toolName](args);
          } else {
            result = { success: false, error: `未知工具: ${toolName}` };
          }
          
          console.log('工具返回:', JSON.stringify(result).substring(0, 200));
          
          // 发送工具结果事件
          yield {
            event: 'tool_result',
            data: {
              type: 'tool_result',
              tool: toolName,
              result: {
                success: result.success,
                count: result.count,
                summary: this.summarizeResult(result)
              },
              step: step + 1
            }
          };
          
          // 如果是图表配置，保存它
          if (result.config) {
            chartConfig = result.config;
          }
          
          // 将工具结果添加到消息历史
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(result)
          });
        }
        
      } catch (error) {
        console.error('Agent 执行错误:', error.message);
        
        yield {
          event: 'error',
          data: {
            type: 'error',
            error: error.message
          }
        };
        
        return;
      }
    }
    
    // 达到最大步数
    console.log('\n=== 达到最大执行步数 ===');
    yield {
      event: 'complete',
      data: {
        type: 'max_steps_reached',
        content: '已达到最大执行步数，请简化您的需求',
        chartConfig: chartConfig
      }
    };
  }
  
  // 总结工具执行结果（用于流式展示）
  summarizeResult(result) {
    if (!result.success) {
      return '执行失败';
    }
    
    if (result.data && result.data.length > 0) {
      return `获取到 ${result.count} 条数据`;
    }
    
    if (result.value !== undefined) {
      return `计算结果: ${result.value}`;
    }
    
    if (result.config) {
      return `生成 ${result.config.type} 图: ${result.config.title}`;
    }
    
    return '执行成功';
  }
  
  // 从对话历史中提取图表配置
  extractChartConfig(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'tool') {
        try {
          const content = JSON.parse(messages[i].content);
          if (content.config) {
            return content.config;
          }
        } catch (e) {
          // 忽略解析错误
        }
      }
    }
    return null;
  }
}

module.exports = { DataAgent };
