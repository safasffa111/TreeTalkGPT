const { parentPort, workerData } = require('worker_threads');
const { extractAttachmentText } = require('./attachment-text-extractor');

(async () => {
  try {
    const { filePath, metadata } = workerData || {};
    const result = await extractAttachmentText(filePath, metadata || {});
    parentPort.postMessage({ ok: true, result });
  } catch (error) {
    parentPort.postMessage({
      ok: false,
      result: {
        ok: false,
        status: 'failed',
        parser: 'worker-error',
        text: '',
        message: `附件解析工作线程失败：${error?.message || String(error)}`,
        error: error?.message || String(error),
      },
    });
  }
})();
