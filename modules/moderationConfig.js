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
        'default': { enabled: false }
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
        "default": {
          "enabled": false
        },
        "dall-e-img": {
          "enabled": true
        },
        "gpt-5-nano": {
          "enabled": true
        },
        "gpt-4o-mini": {
          "enabled": true
        },
        "gpt-4.1-nano": {
          "enabled": true
        },
        "deepseek-ai/DeepSeek-V3.1": {
          "enabled": false
        },
        "claude-opus-4-1-20250805": {
          "enabled": true
        },
        "claude-sonnet-4-5": {
          "enabled": true
        },
        "gpt-5": {
          "enabled": true
        },
        "gpt-5-mini": {
          "enabled": true
        },
        "gemini-flash-latest": {
          "enabled": true
        },
        "gemini-flash-lite-latest": {
          "enabled": true
        }
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
    },

    '/cloudflare': {
      enabled: true,
      description: 'Cloudflare AI 图像生成路由',
      models: {
        '@cf/black-forest-labs/flux-1-schnell': { enabled: true },
        '@cf/lykon/dreamshaper-8-lcm': { enabled: true },
        '@cf/leonardo/phoenix-1.0': { enabled: true },
        '@cf/leonardo/lucid-origin': { enabled: true },
        '@cf/runwayml/stable-diffusion-v1-5-inpainting': { enabled: true },
        '@cf/bytedance/stable-diffusion-xl-lightning': { enabled: true },
        '@cf/stabilityai/stable-diffusion-xl-base-1.0': { enabled: true },
        '@cf/runwayml/stable-diffusion-v1-5-img2img': { enabled: true },
        'default': { enabled: true }
      }
    },

    '/siliconflow': {
      enabled: true,
      description: 'SiliconFlow AI 图像生成路由',
      models: {
        'Qwen/Qwen-Image': { enabled: true },           // 文生图模型
        'Qwen/Qwen-Image-Edit': { enabled: true },      // 图生图/图像编辑模型
        'Kwai-Kolors/Kolors': { enabled: true },        // 快手可图文生图模型
        'default': { enabled: true }
      }
    },

    '/image-middleware': {
      enabled: true,
      description: '本地图像/视频生成中间层路由',
      models: {
        'cogview-3': { enabled: true },                 // 智谱 CogView3 文生图
        'cogview-3-flash': { enabled: true },           // 智谱 CogView3 快速版
        'grok-2-image': { enabled: true },              // Grok-2 文生图
        'grok-2': { enabled: true },                    // Grok-2 多模态
        'Kwai-Kolors/Kolors': { enabled: true },        // 快手 Kolors 图像模型
        'Qwen/Qwen-Image': { enabled: true },           // 通义千问文生图
        'Qwen/Qwen-Image-Edit': { enabled: true },      // 通义千问图像编辑
        'Qwen/Qwen-Image-Edit-2509': { enabled: true }, // 通义千问最新图像编辑
        'volc-ark-image': { enabled: true },            // 火山方舟文生图
        'volc-ark': { enabled: true },                  // 火山方舟视频多合一
        'volc-ark-t2v': { enabled: true },              // 火山方舟文生视频
        'volc-ark-i2v': { enabled: true },              // 火山方舟图生视频
        'volc-ark-i2v-lite': { enabled: true },         // 火山方舟图生视频轻量版
        'Wan-AI/Wan2.2-T2V-A14B': { enabled: true },    // 硅基流动 WAN 文生视频
        'Wan-AI/Wan2.2-I2V-A14B': { enabled: true },    // 硅基流动 WAN 图生视频
        'default': { enabled: true }                    // 兜底启用所有支持模型
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
