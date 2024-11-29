const { Worker } = require('worker_threads');
const path = require('path'); // 引入 path 模块

async function sendNotification(data, requestBody, config) {
  const workerPath = path.join(__dirname, 'notificationWorker.js'); // 获取绝对路径

  const promises = [];
  if (config.lark && config.lark.enabled) promises.push(sendNotificationWorker('lark'));
  if (config.dingtalk && config.dingtalk.enabled) promises.push(sendNotificationWorker('dingtalk'));
  if (config.ntfy && config.ntfy.enabled) promises.push(sendNotificationWorker('ntfy'));
  if (config.pushdeer && config.pushdeer.enabled) promises.push(sendNotificationWorker('pushdeer'));

  async function sendNotificationWorker(notificationType) {
      return new Promise((resolve, reject) => {
          const worker = new Worker(workerPath, {
              workerData: { notificationType, data, requestBody, config },
          });
          worker.on('message', (message) => {
              if (message.status === 'success') {
                  console.log(`通知 (${message.type}): 发送成功`);
                  resolve();
              } else {
                  console.error(`通知 (${message.type}): 失败 - ${message.error}`);
                  reject(new Error(`通知 (${message.type}) 失败: ${message.error}`));
              }
          });
          worker.on('error', (error) => {
              console.error(`工作线程错误 (${notificationType}):`, error);
              reject(error);
          });
          worker.on('exit', (code) => {
              if (code !== 0) console.error(`工作线程以退出代码 ${code} 停止 (${notificationType})`);
          });
      });
  }

  await Promise.allSettled(promises); // 单独处理成功和失败的结果。
}

module.exports = { sendNotification };
