/**
 * @Author: Liu Jiarong
 * @Date: 2024-11-30 01:38:09
 * @LastEditors: Liu Jiarong
 * @LastEditTime: 2024-11-30 01:38:36
 * @FilePath: /openAILittle/larkNotifier.js
 * @Description: 
 * @
 * @Copyright (c) 2024 by ${git_name_email}, All Rights Reserved. 
 */


async function sendLarkNotification(data, requestBody, webhookUrl) {
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        msg_type: "post",
        content: {
          post: {
            zh_cn: {
              title: "AI 代理服务器转发请求",
              content: [
                [{ tag: "text", text: `模型：${data.modelName}` }],
                [{ tag: "text", text: `IP 地址：${data.ip}` }],
                [{ tag: "text", text: `用户 ID：${data.userId}` }],
                [{ tag: "text", text: `时间：${data.time}` }],
                [{ tag: "text", text: "用户请求内容：" }],
                [{ tag: "text", text: `${requestBody}` }],
              ],
            },
          },
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`发送消息到 Lark 失败: ${response.status} ${response.statusText}`);
    }
  } catch (error) {
    console.error('发送通知到 Lark 失败:', error);
  }
}

module.exports = { sendLarkNotification };
