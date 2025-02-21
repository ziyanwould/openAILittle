/**
 * @Author: Liu Jiarong
 * @Date: 2025-02-20 22:23:13
 * @LastEditors: Liu Jiarong
 * @LastEditTime: 2025-02-20 22:23:33
 * @FilePath: /openAILittle/fetch.js
 * @Description: 
 * @ 批量注册newApi 用户
 * @Copyright (c) 2025 by ${git_name_email}, All Rights Reserved. 
 */
const fs = require('fs').promises;

// 生成随机字符串函数
function generateRandomString(length = 8) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    return Array.from({ length }, () =>
        chars[Math.floor(Math.random() * chars.length)]
    ).join('');
}

// 注册用户函数
async function registerUser() {
    const username = generateRandomString();
    const password = generateRandomString();
    const url = 'https://api-1-hemf.onrender.com/api/user/register?turnstile=';

    const options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            username,
            password,
            password2: password,
            email: "",
            verification_code: "",
            aff_code: "PGJy" // 固定aff_code
        })
    };

    try {
        const response = await fetch(url, options);
        const json = await response.json();

        console.log('Response:', json);

        if (json.success) {
            await saveCredentials({ username, password });
            console.log(`Credentials saved: ${username}/${password}`);
        }
    } catch (err) {
        console.error('Request error:', err);
    } finally {
        // 设置下次请求时间（20-30秒之间）
        const nextDelay = Math.floor(Math.random() * 11 + 300) * 1000;
        setTimeout(registerUser, nextDelay);
    }
}

// 异步保存凭证到文件
async function saveCredentials(data) {
    try {
        // 保存为JSON格式，每行一个对象
        await fs.appendFile('credentials.json', JSON.stringify(data) + '\n');
    } catch (err) {
        console.error('File save error:', err);
    }
}

// 启动注册流程
console.log('Starting registration process...');
registerUser();