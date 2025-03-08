/**
 * @Author: Liu Jiarong
 * @Date: 2025-03-08 22:37:05
 * @LastEditors: Liu Jiarong
 * @LastEditTime: 2025-03-08 23:34:29
 * @FilePath: /openAILittle/modules/chatnioRateLimits.js
 * @Description: 
 * @
 * @Copyright (c) 2025 by ${git_name_email}, All Rights Reserved. 
 */
// chatnioRateLimits.js

module.exports = {
    // 公共模型限制 (针对用户 ID 和 IP 地址的列表)
    commonLimits: {
      //受限的用户列表
      restrictedUserIds: ['哥廷根', '菲尔', 'ggh1357', "root"],
      //受限的IP地址列表
      restrictedIPs: ['34.94.175.65', '0.0.0.0'],
      //模型以及对应的限制
      models: {
        'gpt-4-turbo': {
          limits: [
            { windowMs: 60 * 1000, max: 5 }, // 1 分钟内最多 5 次
            { windowMs: 60 * 60 * 1000, max: 100 }, // 1 小时内最多 100 次
          ],
          dailyLimit: 500,
        },
         'gpt-4o-mini': {
          limits: [
            { windowMs: 60 * 1000, max: 3 }, // 1 分钟内最多 5 次
           // { windowMs: 60 * 60 * 1000, max: 100 }, // 1 小时内最多 100 次
          ],
          dailyLimit: 500,
        },
        // ... 其他公共限制的模型 ...
      },
    },
  
    // 自定义用户/IP 限制 (覆盖公共限制)
    customLimits: {
      'user789': { // 用户 ID
        'gpt-4-turbo': {
          limits: [
            { windowMs: 60 * 1000, max: 10 }, //  user789 gpt-4-turbo 1 分钟 10 次
            { windowMs: 3600 * 1000, max: 200}
          ],
          dailyLimit: 1000,
        },
        // ... user789 的其他模型限制 ...
      },
      '192.168.1.200': { // IP 地址
        'gpt-4o': {
          limits: [
            { windowMs: 60 * 1000, max: 20 }, // 192.168.1.200 这个ip 1 分钟 20 次
             { windowMs: 3600 * 1000, max: 300}
          ],
          dailyLimit: 800,
        },
        // ... 192.168.1.200 的其他模型限制 ...
  
      },
       'user999': { // 用户 ID
        // ... user999 的其他模型限制 ...
          //不设置，默认无限制
      },
      // ... 其他自定义限制 ...
    },
  };