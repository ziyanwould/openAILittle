const fs = require('fs');
const moment = require('moment');
const crypto = require('crypto');
// 辅助函数，用于准备数据进行哈希计算
function prepareDataForHashing(data) {
    if (typeof data === 'string') {
      return data;
    } else if (Buffer.isBuffer(data)) {
      return data;
    } else if (Array.isArray(data)) {
      // 递归处理嵌套数组
      return data.map(prepareDataForHashing).join('');
    } else if (typeof data === 'object' && data !== null) {
      // 处理其他对象类型，例如包含 base64 编码图片数据的对象
      // 你需要根据实际情况修改这部分代码
      if (data.type && data.type.startsWith('image') && typeof data.image_url.url === 'string') {
        const str = data.image_url.url;
        const base64Image = str.replace(/^data:image\/\w+;base64,/, '');
        return base64Image;
      } else {
        console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} prepareDataForHashing: 遇到了未处理的对象类型`, data);
        return JSON.stringify(data);
      }
    } else {
      // 处理其他数据类型
      return String(data);
    }
  }
  
  // 简单判断是否为自然语言
  // 使用最多的8种语言做判断，特别是中文和英文，判断其语句是否完整，是否是自然语言。
  function isNaturalLanguage(text) {
    // 新增代码标记检测（防止代码片段误判）
    const codePatterns = [
      /console\.log\(/,    // JS代码
      /def\s+\w+\(/,       // Python函数
      /<\?php/,            // PHP代码
      /<\/?div>/           // HTML标签
    ];
  
    if (codePatterns.some(pattern => pattern.test(text))) {
      return false;
    }
    // 定义支持的语言及其对应的正则表达式
    const languageRegexMap = {
      'english': /^[A-Za-z0-9,.!?\s]+$/, // 英文：字母、数字、标点符号和空格
      'chinese': /^[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef0-9,.!?\s]+$/, // 中文：汉字、标点符号和空格
      'chinese-english': /^[A-Za-z0-9\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef,.!?\s]+$/, // 中英文混合：字母、数字、汉字、标点符号和空格
      'spanish': /^[A-Za-z0-9áéíóúüñÁÉÍÓÚÜÑ,.!?\s]+$/, // 西班牙语：字母、数字、标点符号、特殊字符和空格
      'french': /^[A-Za-z0-9àâäçéèêëîïôöùûüÿœæÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŸŒÆ,.!?\s]+$/, // 法语：字母、数字、标点符号、特殊字符和空格
      'german': /^[A-Za-z0-9äöüßÄÖÜẞ,.!?\s]+$/, // 德语：字母、数字、标点符号、特殊字符和空格
      'russian': /^[А-Яа-я0-9,.!?\s]+$/, // 俄语：西里尔字母、数字、标点符号和空格
      'portuguese': /^[A-Za-z0-9áàâãçéèêíìîóòôõúùûüÁÀÂÃÇÉÈÊÍÌÎÓÒÔÕÚÙÛÜ,.!?\s]+$/, // 葡萄牙语：字母、数字、标点符号、特殊字符和空格
      'arabic': /^[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\s]+$/, // 阿拉伯语：阿拉伯字符和空格
    };
  
    // 遍历支持的语言，检查文本是否匹配
    for (const [language, regex] of Object.entries(languageRegexMap)) {
      if (regex.test(text)) {
        console.log(`Detected language: ${language}`);
        return true;
      }
    }
  
    // 如果不匹配任何一种语言，则判断是否为Markdown格式
    // 这里只是一个简单的Markdown判断，可以根据需要进行更复杂的判断
    if (text.includes('**') || text.includes('##') || text.includes('[link](url)')) {
      return true;
    }
    console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} isNaturalLanguage: 未匹配到语言`, text);
    // 如果没有匹配到任何语言，则认为不是自然语言
    return false;
  }
  
  // 从文件中读取敏感模式的函数
  function readSensitivePatternsFromFile(filename) {
    try {
      const data = fs.readFileSync(filename, 'utf8');
      const patterns = JSON.parse(data).map(item => ({
        pattern: new RegExp(item.pattern, 'g'),
        description: item.description
      }));
      return patterns;
    } catch (err) {
      console.error(`Error reading file ${filename}:`, err);
      return [];
    }
  }
  
  // 使用模式检测敏感内容的功能
  function detectSensitiveContent(text, patterns) {
    for (let i = 0; i < patterns.length; i++) {
      if (text.search(patterns[i].pattern) !== -1) {
        return true;
      }
    }
    return false;
  }
  
  // 辅助函数，用于检查字符串是否为时间戳格式，并允许一定的误差
  function isTimestamp(str, allowedErrorMs = 10 * 60 * 1000) {
    const timestamp = parseInt(str, 10) * 1000; //  毫秒级时间戳
    if (isNaN(timestamp)) {
      return false;
    }
    // 增加时间范围的校验，需要用户传过来的就是当前时间附近的时间戳
    const currentTime = Date.now();
    return Math.abs(currentTime - timestamp) <= allowedErrorMs;
  }

  // 从文件中加载受限用户配置
function loadRestrictedUsersConfigFromFile(filePath) {
  try {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(fileContent);
  } catch (err) {
    console.error(`Failed to load restricted users config from ${filePath}:`, err);
    return {};
  }
}

  module.exports = {
    prepareDataForHashing,
    isNaturalLanguage,
    readSensitivePatternsFromFile,
    detectSensitiveContent,
    isTimestamp,
    loadRestrictedUsersConfigFromFile
  };