const { parentPort, workerData } = require('worker_threads');

async function sendNotification(notificationType, data, requestBody, config) {
  try {
    let url, options;
    switch (notificationType) {
      case 'lark':
        url = config.lark.webhookUrl;
        options = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            msg_type: 'post',
            content: {
              post: {
                zh_cn: {
                  title: 'AI 代理服务器转发请求',
                  content: [
                    [{ tag: 'text', text: `模型：${data.modelName}` }],
                    [{ tag: 'text', text: `IP 地址：${data.ip}` }],
                    [{ tag: 'text', text: `用户 ID：${data.userId}` }],
                    [{ tag: 'text', text: `时间：${data.time}` }],
                    [{ tag: 'text', text: '用户请求内容：' }],
                    [{ tag: 'text', text: `${requestBody}` }],
                  ],
                },
              },
            },
          }),
        };
        break;
      case 'dingtalk':
        url = config.dingtalk.webhookUrl;
        options = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            msgtype: 'text',
            text: { content: `chatnio：${data.modelName} - ${data.ip} - ${data.userId} - ${data.time} - ${requestBody}` },
          }),
        };
        break;
      case 'ntfy':
        url = `https://ntfy.liujiarong.top/${config.ntfy.topic}`;
        options = {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.ntfy.token}`,
            'Content-Type': 'application/json',
            Title: `${data.ip}`,
            Priority: 'urgent',
            Tags: 'eyes,loudspeaker,left_right_arrow',
          },
          body: `模型：${data.modelName}\nIP 地址：${data.ip}\n用户 ID：${data.userId}\n时间：${data.time}\n用户请求内容：\n${requestBody}`,
        };
        break;
      case 'pushdeer':
        url = 'https://api2.pushdeer.com/message/push';
        options = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pushkey: config.pushdeer.pushkey,
            text: 'AI 代理服务器转发请求',
            type: 'markdown',
            desp: `\`\`\`\n模型：${data.modelName}\nIP 地址：${data.ip}\n用户 ID：${data.userId}\n时间：${data.time}\n用户请求内容：\n${requestBody}\n\`\`\``,
          }),
        };
        break;
      default:
        throw new Error(`未知的通知类型: ${notificationType}`);
    }

    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error(`发送通知失败 (${notificationType}): ${response.status} ${response.statusText}`);
    }
    parentPort.postMessage({ type: notificationType, status: 'success' });
  } catch (error) {
    parentPort.postMessage({ type: notificationType, status: 'error', error: error.message });
  }
}

// 工作线程立即开始发送通知
sendNotification(workerData.notificationType, workerData.data, workerData.requestBody, workerData.config);

