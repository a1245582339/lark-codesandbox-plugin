import type { WebContainer } from '@webcontainer/api';

const DB_NAME = 'pnpm-store-cache';
const DB_VERSION = 6;
const STORE_NAME = 'cache';

// pnpm store 固定路径（相对于 WebContainer 工作目录）
const PNPM_STORE_PATH = '.local/share/pnpm/store';

interface FileEntry {
  path: string;
  contents: Uint8Array;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      // 删除旧的 store
      if (db.objectStoreNames.contains('files')) {
        db.deleteObjectStore('files');
      }
      if (db.objectStoreNames.contains('cache')) {
        db.deleteObjectStore('cache');
      }
      db.createObjectStore(STORE_NAME);
    };
  });
}

// 压缩数据
async function compress(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream();
  const compressedStream = stream.pipeThrough(new CompressionStream('gzip'));
  const chunks: Uint8Array[] = [];
  const reader = compressedStream.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

// 解压数据
async function decompress(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream();
  const decompressedStream = stream.pipeThrough(new DecompressionStream('gzip'));
  const chunks: Uint8Array[] = [];
  const reader = decompressedStream.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

// 将文件列表序列化为二进制格式
function serializeFiles(files: FileEntry[]): Uint8Array {
  const encoder = new TextEncoder();

  // 计算总大小
  let totalSize = 4; // 文件数量 (4 bytes)
  for (const file of files) {
    const pathBytes = encoder.encode(file.path);
    totalSize += 4 + pathBytes.length + 4 + file.contents.length;
  }

  const buffer = new Uint8Array(totalSize);
  const view = new DataView(buffer.buffer);
  let offset = 0;

  // 写入文件数量
  view.setUint32(offset, files.length, true);
  offset += 4;

  // 写入每个文件
  for (const file of files) {
    const pathBytes = encoder.encode(file.path);

    // 路径长度
    view.setUint32(offset, pathBytes.length, true);
    offset += 4;

    // 路径内容
    buffer.set(pathBytes, offset);
    offset += pathBytes.length;

    // 内容长度
    view.setUint32(offset, file.contents.length, true);
    offset += 4;

    // 内容
    buffer.set(file.contents, offset);
    offset += file.contents.length;
  }

  return buffer;
}

// 从二进制格式反序列化文件列表
function deserializeFiles(buffer: Uint8Array): FileEntry[] {
  const decoder = new TextDecoder();
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const files: FileEntry[] = [];
  let offset = 0;

  // 读取文件数量
  const fileCount = view.getUint32(offset, true);
  offset += 4;

  // 读取每个文件
  for (let i = 0; i < fileCount; i++) {
    // 路径长度
    const pathLength = view.getUint32(offset, true);
    offset += 4;

    // 路径内容
    const pathBytes = buffer.slice(offset, offset + pathLength);
    const path = decoder.decode(pathBytes);
    offset += pathLength;

    // 内容长度
    const contentLength = view.getUint32(offset, true);
    offset += 4;

    // 内容
    const contents = buffer.slice(offset, offset + contentLength);
    offset += contentLength;

    files.push({ path, contents });
  }

  return files;
}

async function readDirRecursive(
  webcontainer: WebContainer,
  dirPath: string,
  basePath: string = ''
): Promise<FileEntry[]> {
  const files: FileEntry[] = [];

  try {
    const entries = await webcontainer.fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = dirPath + '/' + entry.name;
      const relativePath = basePath ? basePath + '/' + entry.name : entry.name;

      if (entry.isDirectory()) {
        const subFiles = await readDirRecursive(webcontainer, fullPath, relativePath);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        try {
          const contents = await webcontainer.fs.readFile(fullPath);
          files.push({ path: relativePath, contents });
        } catch {
          // Skip files that can't be read
        }
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return files;
}

export async function savePnpmStoreToCache(
  webcontainer: WebContainer,
  onProgress?: (message: string) => void
): Promise<void> {
  onProgress?.('开始保存 pnpm store 缓存...');
  onProgress?.(`pnpm store 路径: ${PNPM_STORE_PATH}`);
  onProgress?.('正在读取 pnpm store 文件...');

  const files = await readDirRecursive(webcontainer, PNPM_STORE_PATH);

  if (files.length === 0) {
    onProgress?.('没有找到需要缓存的文件');
    return;
  }

  onProgress?.(`读取到 ${files.length} 个文件，正在序列化...`);

  const serialized = serializeFiles(files);
  onProgress?.(`序列化完成 (${(serialized.length / 1024 / 1024).toFixed(2)}MB)，正在压缩...`);

  const compressed = await compress(serialized);

  const ratio = ((1 - compressed.length / serialized.length) * 100).toFixed(1);
  onProgress?.(`压缩完成: ${(serialized.length / 1024 / 1024).toFixed(2)}MB -> ${(compressed.length / 1024 / 1024).toFixed(2)}MB (节省 ${ratio}%)`);

  onProgress?.('正在保存到 IndexedDB...');
  const db = await openDB();
  const transaction = db.transaction(STORE_NAME, 'readwrite');
  const store = transaction.objectStore(STORE_NAME);

  await new Promise<void>((resolve, reject) => {
    const request = store.put(compressed, 'pnpm-store');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });

  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });

  db.close();
  onProgress?.(`已缓存 ${files.length} 个文件`);
}

// 并行执行任务，限制并发数
async function parallelLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number
): Promise<T[]> {
  const results: T[] = [];
  let index = 0;

  async function runNext(): Promise<void> {
    while (index < tasks.length) {
      const currentIndex = index++;
      results[currentIndex] = await tasks[currentIndex]();
    }
  }

  const workers = Array(Math.min(limit, tasks.length))
    .fill(null)
    .map(() => runNext());

  await Promise.all(workers);
  return results;
}

export async function restorePnpmStoreFromCache(
  webcontainer: WebContainer,
  onProgress?: (message: string) => void
): Promise<boolean> {
  onProgress?.('正在检查 pnpm store 缓存...');

  const db = await openDB();
  const transaction = db.transaction(STORE_NAME, 'readonly');
  const store = transaction.objectStore(STORE_NAME);

  const compressed = await new Promise<Uint8Array | undefined>((resolve, reject) => {
    const request = store.get('pnpm-store');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  db.close();

  if (!compressed) {
    onProgress?.('没有找到缓存');
    return false;
  }

  onProgress?.(`找到缓存 (${(compressed.length / 1024 / 1024).toFixed(2)}MB)，正在解压...`);

  const serialized = await decompress(compressed);
  const files = deserializeFiles(serialized);

  onProgress?.(`正在恢复 ${files.length} 个缓存文件...`);

  // 收集所有目录
  const dirs = new Set<string>();
  for (const file of files) {
    const parts = file.path.split('/');
    let currentPath = PNPM_STORE_PATH;
    for (let i = 0; i < parts.length - 1; i++) {
      currentPath += '/' + parts[i];
      dirs.add(currentPath);
    }
  }

  // 按深度排序并创建目录
  const sortedDirs = Array.from(dirs).sort((a, b) => a.split('/').length - b.split('/').length);
  for (const dir of sortedDirs) {
    try {
      await webcontainer.fs.mkdir(dir, { recursive: true });
    } catch {
      // 忽略已存在的目录
    }
  }

  // 并行写入文件（限制并发数为 50）
  const tasks = files.map((file) => async () => {
    const fullPath = `${PNPM_STORE_PATH}/${file.path}`;
    await webcontainer.fs.writeFile(fullPath, file.contents);
  });

  await parallelLimit(tasks, 50);

  onProgress?.(`已恢复 ${files.length} 个缓存文件`);
  return true;
}

export async function hasPnpmStoreCache(): Promise<boolean> {
  try {
    const db = await openDB();
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);

    const result = await new Promise<unknown>((resolve, reject) => {
      const request = store.get('pnpm-store');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    db.close();
    return !!result;
  } catch {
    return false;
  }
}
