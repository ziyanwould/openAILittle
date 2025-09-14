// 使用原生 fetch (Node.js 18+)

async function sendDingTalkNotification(message, webhookUrl) {
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        msgtype: "text",
        text: {
          content: 'chatnio：' + message
        }
      }),
    });

    if (!response.ok) {
      throw new Error(`发送消息到 DingTalk 失败: ${response.status} ${response.statusText}`);
    }

    console.log("消息成功发送到 DingTalk");
  } catch (error) {
    console.error('发送消息到 DingTalk 失败:', error);
  }
}

module.exports = { sendDingTalkNotification };
