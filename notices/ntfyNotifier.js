/**
 * @Author: Liu Jiarong
 * @Date: 2024-11-30 01:35:27
 * @LastEditors: Liu Jiarong
 * @LastEditTime: 2024-11-30 01:35:51
 * @FilePath: /openAILittle/ntfyNotifier.js
 * @Description: 
 * @
 * @Copyright (c) 2024 by ${git_name_email}, All Rights Reserved. 
 */
async function sendNTFYNotification(data, requestBody, ntfyTopic, ntfyToken) {
  try {
    const response = await fetch(`https://ntfy.liujiarong.top/${ntfyTopic}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ntfyToken}`,
        'Content-Type': 'application/json',
        'Title': `${data.ip}`,
        'Priority': 'urgent',
        'Tags': 'eyes,loudspeaker,left_right_arrow'
      },
      body: `模型：${data.modelName}\nIP 地址：${data.ip}\n用户 ID：${data.userId}\n时间：${data.time}\n用户请求内容：\n${requestBody}`,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`发送消息到 ntfy 失败: ${response.status} ${response.statusText}\n${errorBody}`);
    }

  } catch (error) {
    console.error('发送通知到 ntfy 失败:', error);
  }
}

module.exports = { sendNTFYNotification };
