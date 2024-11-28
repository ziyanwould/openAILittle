//  pushDeerNotifier.js
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

if (isMainThread) {
    //  主线程中的函数，用于发送通知
    function sendNotification(data, requestBody, pushkey) {
        const worker = new Worker(__filename, {
            workerData: { data, requestBody, pushkey },
        });
        worker.on('message', (message) => {
            console.log(message); //  接收 worker 线程的消息（例如，成功或失败信息）
        });
        worker.on('error', (error) => {
            console.error('Worker thread error:', error);
        });
        worker.on('exit', (code) => {
            if (code !== 0)
                console.error(`Worker stopped with exit code ${code}`);
        });
    }

    module.exports = { sendNotification };
} else {
    //  Worker 线程中的代码，负责实际发送通知和重试逻辑
    const { data, requestBody, pushkey } = workerData;
    const MAX_RETRIES = 3;

    async function sendNotificationToPushdeer(retries = 0) {
        let retryInterval = 1000;
        try {
            const response = await fetch('https://pushdeer.pro.liujiarong.top/message/push', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pushkey,
                    text: 'AI 代理服务器转发请求',
                    type: 'markdown',
                    desp: `\`\`\`\n模型：${data.modelName}\nIP 地址：${data.ip}\n用户 ID：${data.userId}\n时间：${data.time}\n用户请求内容：\n${requestBody}\n\`\`\``,
                }),
            });

            if (!response.ok) {
                if (response.status >= 500 && retries < MAX_RETRIES) {
                    throw new Error(`Failed to send message to PushDeer: ${response.status} ${response.statusText}`);
                } else {
                    throw new Error(`PushDeer returned an error: ${response.status} ${response.statusText}`); //  处理其他错误
                }
            }

            parentPort.postMessage('Message sent successfully to PushDeer'); //  发送成功消息到主线程
        } catch (error) {
            if (retries < MAX_RETRIES) {
                parentPort.postMessage(`Retrying notification (${retries + 1}/${MAX_RETRIES}) in ${retryInterval / 1000} seconds...`);
                await new Promise(resolve => setTimeout(resolve, retryInterval));
                retryInterval *= 2;
                await sendNotificationToPushdeer(retries + 1); //  递归重试
            } else {
                parentPort.postMessage(`Max retries reached. Giving up on this notification. Error: ${error.message}`);
            }
        }
    }

    sendNotificationToPushdeer();  // worker thread 立即开始发送
}
