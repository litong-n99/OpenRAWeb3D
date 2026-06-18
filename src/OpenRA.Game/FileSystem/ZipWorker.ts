/**
 * ZipWorker.ts — Web Worker for non-blocking ZIP decompression
 * OpenRA 对照: 无（浏览器端新增异步解压）
 *
 * 核心范式转换:
 * - C# 同步 ZIP 解压 (SharpZipLib) → fflate unzip 在 Worker 线程中
 * - postMessage with transferable ArrayBuffer 实现零拷贝传输
 *
 * 此文件作为内联 Worker 字符串使用，通过 Blob URL 创建 Worker。
 * Worker 接收原始 ZIP ArrayBuffer，通过 postMessage 返回
 * Record<string, Uint8Array> 的解压文件映射。
 *
 * 用法 (在 ZipFile.ts 中):
 * ```
 * const workerCode = ZIP_WORKER_CODE
 * const blob = new Blob([workerCode], { type: 'application/javascript' })
 * const worker = new Worker(URL.createObjectURL(blob))
 * worker.postMessage(zipBuffer, [zipBuffer])  // 零拷贝传输
 * ```
 */

export const ZIP_WORKER_CODE = `
// ZipWorker — fflate-based ZIP decompression worker
// 使用 importScripts 或动态 import 加载 fflate 的 unzip 函数。
//
// fflate 的 unzip 使用错误优先的回调风格：
//   unzip(data, (err, result) => { ... })
// 其中 result 是 Record<string, Uint8Array>。

self.onmessage = async function(e) {
  const buffer = e.data

  if (!buffer || !(buffer instanceof ArrayBuffer) || buffer.byteLength === 0) {
    self.postMessage({ type: 'error', message: 'Empty or invalid ZIP data' })
    return
  }

  try {
    // 动态导入 fflate — 在生产构建中由打包器解析
    // NOTE: 如果打包器不支持动态导入的代码分割，
    // 则回退到 importScripts
    let unzipFn
    try {
      const mod = await import('fflate')
      unzipFn = mod.unzip
    } catch (_) {
      // Worker 环境中 import 不可用 — 使用 importScripts 回退
      importScripts('https://unpkg.com/fflate@0.8.1/umd/index.js')
      unzipFn = self.fflate?.unzip
      if (!unzipFn) {
        throw new Error('Failed to load fflate in worker')
      }
    }

    const data = new Uint8Array(buffer)

    // 使用错误优先的回调进行解压
    const result = await new Promise((resolve, reject) => {
      unzipFn(data, (err, files) => {
        if (err) {
          reject(err)
          return
        }
        resolve(files || {})
      })
    })

    // 构建传输列表以实现零拷贝传输
    const transferList = []
    const outputFiles = {}

    for (const [name, data] of Object.entries(result)) {
      if (name.endsWith('/')) continue // 跳过目录条目
      // 提取底层 ArrayBuffer 用于传输
      const arr = data
      const buf = arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength)
      transferList.push(buf)
      outputFiles[name] = new Uint8Array(buf)
    }

    self.postMessage({
      type: 'result',
      files: outputFiles,
    }, transferList)
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: 'ZIP decompression failed: ' + String(err),
    })
  }
}
`
