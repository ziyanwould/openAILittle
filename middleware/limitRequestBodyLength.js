/**
 * @Author: Liu Jiarong
 * @Date: 2025-03-15 20:04:15
 * @LastEditors: Liu Jiarong
 * @LastEditTime: 2025-03-15 20:32:00
 * @FilePath: /openAILittle/middleware/limitRequestBodyLength.js
 * @Description: 
 * @
 * @Copyright (c) 2025 by ${git_name_email}, All Rights Reserved. 
 */
// 中间件函数，用于限制 req.body 文本长度
const moment = require('moment');
const limitRequestBodyLength = (maxLength , errorMessage , whitelistedUserIds , whitelistedIPs ) => {
    return (req, res, next) => {
      const userId = req.headers['x-user-id'] || req.body.user;
      const userIP = req.headers['x-user-ip'] || req.body.user_ip || req.ip;
  
      // 检查用户 ID 或 IP 是否在白名单中
      if (whitelistedUserIds.includes(userId) || whitelistedIPs.includes(userIP)) {
        console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} Request from whitelisted user ${userId || userIP} - skipping length check.`);
        next();
        return;
      }
  
      let totalLength = 0;
  
      // Gemini 格式
      if (req.body.contents && Array.isArray(req.body.contents)) {
        for (const contentItem of req.body.contents) {
          if (contentItem.parts && Array.isArray(contentItem.parts)) {
            for (const part of contentItem.parts) {
              if (part.text) {
                totalLength += String(part.text).length;
              }
            }
          }
        }
      }
      // 三方模型和 OpenAI 格式
      else if (req.body.messages && Array.isArray(req.body.messages)) {
        for (const message of req.body.messages) {
          if (message.content) {
            if (typeof message.content === 'string') {
              totalLength += message.content.length;
            } else if (Array.isArray(message.content)) {
              for (const contentItem of message.content) {
                if (contentItem.text) {
                  totalLength += String(contentItem.text).length;
                }
              }
            } else if (typeof message.content === 'object' && message.content !== null && message.content.text) {
              // 针对 content 为单个对象的情况
              totalLength += String(message.content.text).length;
            }
          }
        }
      }
  
      if (totalLength > maxLength) {
        console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} Request blocked: Text length exceeds limit (${totalLength} > ${maxLength}).`);
        return res.status(400).json({
          "error": {
            "message": errorMessage,
            "type": "invalid_request_error"
          }
        });
      }
  
      next();
    };
  };

  module.exports = limitRequestBodyLength;