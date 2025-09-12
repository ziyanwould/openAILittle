/**
 * @Author: Liu Jiarong
 * @Date: 2025-01-14 22:00:00
 * @LastEditors: Liu Jiarong
 * @LastEditTime: 2025-09-11 22:18:14
 * @FilePath: /openAILittle/modules/moderationConfig.js
 * @Description: 内容审查配置 - 针对不同通道和模型的内容审查策略
 */

module.exports = {
  // 全局配置
  global: {
    enabled: true, // 全局是否启用内容审查
    apiEndpoint: 'https://open.bigmodel.cn/api/paas/v4/moderations', // 智谱AI内容安全API
    timeout: 10000, // 请求超时时间(ms)
  },

  // 按路由前缀配置内容审查策略
  routes: {
    '/v1': {
      enabled: true,
      description: 'OpenAI API 路由',
      models: {
        'gpt-4': { enabled: true },
        'gpt-4-turbo': { enabled: true },
        'gpt-3.5-turbo': { enabled: true },
        'deepseek-v3': { enabled: true },
        'deepseek-r1': { enabled: true },
        'grok-3': { enabled: false },
        'default': { enabled: false } // 默认不启用
      }
    },
    
    '/google': {
      enabled: false,
      description: 'Google Gemini 路由',
      models: {
        'gemini-1.5-pro': { enabled: false },
        'gemini-2.0-flash': { enabled: false },
        'default': { enabled: false }
      }
    },
    
    '/chatnio': {
      enabled: true,
      description: 'ChatNio 平台路由',
      models: {
        'dall-e-img': { enabled: true },
        'gpt-4o-mini': { enabled: true },
        'gpt-4.1-nano': { enabled: true },
        'gpt-5-nano': { enabled: true },
        'deepseek-ai/DeepSeek-V3.1': { enabled: false },
        'default': { enabled: false }
      }
    },
    
    '/freelyai': {
      enabled: false,
      description: 'FreelyAI 路由',
      models: {
        'default': { enabled: false }
      }
    },
    
    '/freeopenai': {
      enabled: true,
      description: '免费 OpenAI 路由',
      models: {
        'dall-e-img': { enabled: true },
        'gpt-4o-mini': { enabled: true },
        'gpt-4.1-nano': { enabled: true },
        'gpt-5-nano': { enabled: true },
        'default': { enabled: false }
      }
    },
    
    '/freegemini': {
      enabled: false,
      description: '免费 Gemini 路由',
      models: {
        'default': { enabled: false }
      }
    }
  },

  // 审查失败时的错误响应配置
  errorResponse: {
    code: 4035,
    message: '内容审查未通过，请检查您的输入内容是否符合使用规范。',
    details: '您的请求包含不当内容，已被安全系统拦截。请修改内容后重新提交。'
  },

  // 审查内容提取配置
  contentExtraction: {
    // 从请求体中提取需要审查的内容字段
    fields: ['prompt', 'content', 'message', 'input'],
    // 嵌套字段提取 (如 messages 数组中的 content)
    nestedFields: {
      'messages': 'content',
      'conversation': 'content'
    },
    // 最大内容长度限制 (智谱AI内容安全API限制为2000字符)
    maxLength: 2000
  }
};