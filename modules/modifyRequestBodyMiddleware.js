/**
 * @Author: Liu Jiarong
 * @Date: 2025-03-15 19:58:30
 * @LastEditors: Liu Jiarong
 * @LastEditTime: 2025-08-03 18:26:45
 * @FilePath: /openAILittle/middleware/modifyRequestBodyMiddleware.js
 * @Description: 封装修改 req.body 的中间件函数
 * 所以通道同一个名称在此处理
 * 不同渠道同一个名称处理，单独渠道请在铭凡aiFlow.js中单独处理
 * @
 * @Copyright (c) 2025 by ${git_name_email}, All Rights Reserved. 
 */
const modifyRequestBodyMiddleware = (req, res, next) => {
  if (req.body && req.body.model) {
    // 匹配 "huggingface/" 开头的模型，区分大小写
    if (req.body.model.startsWith("huggingface/")) {
      if (req.body.top_p !== undefined && req.body.top_p < 1) {
        req.body.top_p = 0.5;
      }
    }
    // 匹配 "Baichuan" 开头的模型，区分大小写
    else if (req.body.model.startsWith("Baichuan")) {
      req.body.frequency_penalty = 1;
    }
    // 匹配包含 "glm-4v" 的模型
    else if (req.body.model.includes("glm-4v")) {
      req.body.max_tokens = 1024;
    }
    // 匹配 "o3-mini" 模型，删除 top_p 参数
    else if (req.body.model === "o3-mini") {
      delete req.body.top_p;
    }
    else if (req.body.model === "o1-mini") {
      delete req.body.top_p;
    }
    else if (req.body.model === "tts-1") {
      req.body = {
        "input": req.body.input,
        "model": "fnlp/MOSS-TTSD-v0.5",
        "stream": false,
        "speed": 1,
        "gain": 0,
        "voice": "fishaudio/fish-speech-1.4:alex",
        "response_format": "mp3"
      }
    }
  }
  next();
};
module.exports = modifyRequestBodyMiddleware;