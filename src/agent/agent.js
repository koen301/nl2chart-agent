/**
 * Data Agent（单 Agent 模式）
 *
 * 职责：
 * - 单 LLM 循环：理解需求 → 选用工具 → 执行 → 总结
 * - 通过 AgentTools 间接访问数据/网关
 *
 * 与 SQL 网关的关系：
 * - 本 Agent 不直接生成/执行 SQL
 * - 数据通道走 AgentTools → SQL 网关（POST /api/sql/query）
 * - 与 sql-agent.js（直生 SQL）职责分开
 */

import axios from 'axios';
import { AgentTools } from './tools.js';

class DataAgent {
  constructor(apiUrl, apiKey, model, db) {
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
    this.model = model;
    this.tools = new AgentTools(db);
    this.maxSteps = 5;
  }
  
  async execute(userInput) {
    console.log('\n=== Agent 开始执行 ===');
    console.log('用户需求:', userInput);
    
    let messages = [
      {
        role: 'system',
        content: `你是一个智能数据分析 Agent，拥有多种工具帮助用户分析和可视化数据。

数据来源：
1. 内置销售数据库（地区：华东/华北/华南/西南，产品：笔记本电脑/手机/平板电脑）
2. 用户上传的 CSV/Excel 数据文件

执行流程：
1. 分析用户需求，理解用户想看什么数据
2. 确定数据来源：
   - 如果用户提到"上传的文件"或具体文件名，使用 queryUploadedData 工具
   - 否则使用 querySalesData 查询内置销售数据
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
    
    const toolsModule = await import('./tools.js');
    const tools = Object.values(toolsModule.toolSchemas).map(schema => ({
      type: 'function',
      function: schema
    }));
    
    for (let step = 0; step < this.maxSteps; step++) {
      console.log(`\n--- 第 ${step + 1} 步 ---`);
      
      try {
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
        
        if (!message.tool_calls || message.tool_calls.length === 0) {
          console.log('\n=== Agent 执行完成 ===');
          return {
            success: true,
            finalResponse: message.content,
            conversation: messages,
            chartConfig: this.extractChartConfig(messages)
          };
        }
        
        for (const toolCall of message.tool_calls) {
          const toolName = toolCall.function.name;
          const args = JSON.parse(toolCall.function.arguments);
          
          console.log(`调用工具: ${toolName}`, args);
          
          let result;
          if (this.tools[toolName]) {
            result = await this.tools[toolName](args);
          } else {
            result = { success: false, error: `未知工具: ${toolName}` };
          }
          
          console.log('工具返回:', JSON.stringify(result).substring(0, 200));
          
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
    
    console.log('\n=== 达到最大执行步数 ===');
    return {
      success: true,
      finalResponse: '已达到最大执行步数，请简化您的需求',
      conversation: messages,
      chartConfig: this.extractChartConfig(messages)
    };
  }
  
  async *executeStream(userInput) {
    console.log('\n=== Agent 流式执行开始 ===');
    console.log('用户需求:', userInput);
    
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
    
    const toolsModule = await import('./tools.js');
    const tools = Object.values(toolsModule.toolSchemas).map(schema => ({
      type: 'function',
      function: schema
    }));
    
    let chartConfig = null;
    
    for (let step = 0; step < this.maxSteps; step++) {
      console.log(`\n--- 第 ${step + 1} 步 ---`);
      
      yield {
        event: 'step',
        data: {
          type: 'step_start',
          step: step + 1,
          message: `正在执行第 ${step + 1} 步...`
        }
      };
      
      try {
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
        
        if (!message.tool_calls || message.tool_calls.length === 0) {
          console.log('\n=== Agent 执行完成 ===');
          
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
        
        for (const toolCall of message.tool_calls) {
          const toolName = toolCall.function.name;
          const args = JSON.parse(toolCall.function.arguments);
          
          console.log(`调用工具: ${toolName}`, args);
          
          yield {
            event: 'tool_call',
            data: {
              type: 'tool_call',
              tool: toolName,
              args: args,
              step: step + 1
            }
          };
          
          let result;
          if (this.tools[toolName]) {
            result = await this.tools[toolName](args);
          } else {
            result = { success: false, error: `未知工具: ${toolName}` };
          }
          
          console.log('工具返回:', JSON.stringify(result).substring(0, 200));
          
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
          
          if (result.config) {
            chartConfig = result.config;
          }
          
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
  
  extractChartConfig(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'tool') {
        try {
          const content = JSON.parse(messages[i].content);
          if (content.config) {
            return content.config;
          }
        } catch (e) {
        }
      }
    }
    return null;
  }
}

export { DataAgent };
