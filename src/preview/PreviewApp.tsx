import { useState, useEffect, useRef, useCallback } from 'react';
import { WebContainer, type FileSystemTree } from '@webcontainer/api';
import { Terminal } from 'xterm';
import { decompressFromEncodedURIComponent } from 'lz-string';
import JSZip from 'jszip';
import 'xterm/css/xterm.css';
import { savePnpmStoreToCache, restorePnpmStoreFromCache } from './pnpmCache';
import {
  detectFramework,
  analyzeDependencies,
  type FrameworkAdapter,
  type FrameworkType,
} from '../adapters';

// 全局单例 WebContainer 实例
let globalWebContainer: WebContainer | null = null;
let isBooting = false;

async function getWebContainer(): Promise<WebContainer> {
  if (globalWebContainer) {
    return globalWebContainer;
  }

  if (isBooting) {
    // 等待其他地方正在启动的实例
    while (isBooting) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (globalWebContainer) {
      return globalWebContainer;
    }
  }

  isBooting = true;
  try {
    globalWebContainer = await WebContainer.boot();
    return globalWebContainer;
  } finally {
    isBooting = false;
  }
}

type Status = 'idle' | 'booting' | 'installing' | 'running' | 'error';
type DepStatus = 'pending' | 'installing' | 'installed';

interface Dependency {
  name: string;
  status: DepStatus;
}

interface CodeData {
  code: string;
  fileName: string;
  frameworkType?: FrameworkType;
  fromParent?: boolean; // 是否从父窗口打开
}

interface GetCodeResult {
  data: CodeData;
  isUrlMode: boolean; // 是否使用 URL 压缩模式（支持跨浏览器分享）
}

function getCodeFromHash(): GetCodeResult | null {
  const hash = window.location.hash;
  if (!hash || hash.length < 2) {
    return null;
  }
  try {
    const hashContent = hash.substring(1);

    // 检查是否是压缩模式（以 c= 开头）
    if (hashContent.startsWith('c=')) {
      const compressed = hashContent.substring(2);
      const decompressed = decompressFromEncodedURIComponent(compressed);
      if (!decompressed) {
        console.error('Failed to decompress code from URL');
        return null;
      }
      return {
        data: JSON.parse(decompressed),
        isUrlMode: true,
      };
    }

    // 降级模式：从 localStorage 读取
    const key = hashContent;
    const data = localStorage.getItem(key);
    if (!data) {
      return null;
    }
    // 窗口关闭时删除，避免污染 localStorage
    window.addEventListener('beforeunload', () => {
      localStorage.removeItem(key);
    });
    return {
      data: JSON.parse(data),
      isUrlMode: false,
    };
  } catch (e) {
    console.error('Failed to get code from hash:', e);
    return null;
  }
}

// 全局终端实例，避免闭包问题
let globalTerminal: Terminal | null = null;
// 用于 StrictMode 兼容：延迟 dispose 的定时器
let disposeTimer: ReturnType<typeof setTimeout> | null = null;

function writeToTerminal(text: string) {
  if (globalTerminal) {
    globalTerminal.write(text.replace(/\n/g, '\r\n'));
    globalTerminal.scrollToBottom();
  }
}

const PreviewApp = () => {
  const [status, setStatus] = useState<Status>('idle');
  const [statusMessage, setStatusMessage] = useState('等待接收代码...');
  const [dependencies, setDependencies] = useState<Dependency[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [terminalReady, setTerminalReady] = useState(false);
  const [commandInput, setCommandInput] = useState('');
  const [shellReady, setShellReady] = useState(false);
  const [fromParent, setFromParent] = useState(false);
  const [isUrlMode, setIsUrlMode] = useState(false);
  const [frameworkName, setFrameworkName] = useState<string>('组件');
  const [downloading, setDownloading] = useState(false);
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const webcontainerRef = useRef<WebContainer | null>(null);
  const shellInputRef = useRef<WritableStreamDefaultWriter<string> | null>(null);
  const initedRef = useRef(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const adapterRef = useRef<FrameworkAdapter | null>(null);

  const log = useCallback((text: string) => {
    writeToTerminal(text);
  }, []);

  const updateStatus = useCallback((newStatus: Status, message: string) => {
    setStatus(newStatus);
    setStatusMessage(message);
  }, []);

  const updateDepStatus = useCallback((newStatus: DepStatus) => {
    setDependencies((prev) => prev.map((dep) => ({ ...dep, status: newStatus })));
  }, []);

  const refreshPreview = useCallback(() => {
    if (iframeRef.current) {
      iframeRef.current.src = iframeRef.current.src;
    }
  }, []);

  // 下载项目为 zip 文件
  const downloadProject = useCallback(async () => {
    const webcontainer = webcontainerRef.current;
    if (!webcontainer) return;

    setDownloading(true);
    log('\n[下载] 正在打包项目文件...\n');

    try {
      const zip = new JSZip();

      // 递归读取目录
      const readDir = async (dirPath: string, zipFolder: JSZip) => {
        const entries = await webcontainer.fs.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = dirPath === '/' ? `/${entry.name}` : `${dirPath}/${entry.name}`;
          // 跳过 node_modules 和 .pnpm-store 目录
          if (entry.name === 'node_modules' || entry.name === '.pnpm-store') {
            continue;
          }
          if (entry.isDirectory()) {
            const subFolder = zipFolder.folder(entry.name);
            if (subFolder) {
              await readDir(fullPath, subFolder);
            }
          } else {
            try {
              const content = await webcontainer.fs.readFile(fullPath);
              // 处理 package.json，移除不需要的依赖
              if (entry.name === 'package.json') {
                const text = new TextDecoder().decode(content);
                const pkg = JSON.parse(text);
                // 移除 @rspack/binding-wasm32-wasi
                if (pkg.dependencies) {
                  delete pkg.dependencies['@rspack/binding-wasm32-wasi'];
                }
                if (pkg.devDependencies) {
                  delete pkg.devDependencies['@rspack/binding-wasm32-wasi'];
                }
                zipFolder.file(entry.name, JSON.stringify(pkg, null, 2));
              } else {
                zipFolder.file(entry.name, content);
              }
            } catch (e) {
              console.warn(`跳过文件: ${fullPath}`, e);
            }
          }
        }
      };

      await readDir('/', zip);

      // 生成 zip 文件
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);

      // 触发下载
      const a = document.createElement('a');
      a.href = url;
      a.download = `${frameworkName.toLowerCase().replace(/\s+/g, '-')}-project.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      log('[下载] 项目打包完成!\n');
    } catch (err) {
      console.error('下载失败:', err);
      log(`[下载] 打包失败: ${err instanceof Error ? err.message : '未知错误'}\n`);
    } finally {
      setDownloading(false);
    }
  }, [frameworkName, log]);

  // 启动交互式 shell
  const startShell = useCallback(async (webcontainer: WebContainer) => {
    // 使用固定的终端尺寸，避免访问 terminal.cols/rows 可能导致的 dimensions 错误
    const shellProcess = await webcontainer.spawn('jsh', {
      terminal: {
        cols: 80,
        rows: 20,
      },
    });

    shellProcess.output.pipeTo(
      new WritableStream({
        write: (data) => {
          if (globalTerminal) {
            globalTerminal.write(data);
          }
        },
      })
    );

    const input = shellProcess.input.getWriter();
    shellInputRef.current = input;
    setShellReady(true);

    return shellProcess;
  }, []);

  // 执行命令
  const executeCommand = useCallback(() => {
    if (!shellInputRef.current || !commandInput.trim()) return;
    shellInputRef.current.write(commandInput + '\n');
    setCommandInput('');
  }, [commandInput]);

  // 初始化 xterm（兼容 React StrictMode）
  // 参考: https://github.com/xtermjs/xterm.js/issues/4983
  useEffect(() => {
    const container = terminalContainerRef.current;
    if (!container) return;

    // 如果有待执行的 dispose，取消它（StrictMode 重新挂载的情况）
    if (disposeTimer) {
      clearTimeout(disposeTimer);
      disposeTimer = null;
    }

    // 如果已有终端实例且仍然有效，直接复用
    if (globalTerminal) {
      // 确保终端附加到当前容器
      if (!container.querySelector('.xterm')) {
        globalTerminal.open(container);
      }
      setTerminalReady(true);
      return;
    }

    const terminal = new Terminal({
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
      },
      fontSize: 13,
      fontFamily: "'SF Mono', 'Fira Code', Consolas, monospace",
      cursorBlink: false,
      disableStdin: true,
      cols: 80,
      rows: 20,
      scrollback: 1000,
    });

    terminal.open(container);
    globalTerminal = terminal;

    // 等待 open() 内部初始化完成后再标记就绪
    const readyTimer = setTimeout(() => {
      setTerminalReady(true);
    }, 50);

    return () => {
      clearTimeout(readyTimer);
      // 延迟 dispose，让 StrictMode 的快速重新挂载有机会取消
      disposeTimer = setTimeout(() => {
        if (globalTerminal === terminal) {
          terminal.dispose();
          globalTerminal = null;
        }
        disposeTimer = null;
      }, 100);
    };
  }, []);

  // 启动预览
  useEffect(() => {
    if (!terminalReady || initedRef.current) return;
    initedRef.current = true;

    const result = getCodeFromHash();
    if (!result || !result.data.code) {
      setError('未能接收到代码，请关闭此窗口并重新点击预览按钮');
      updateStatus('error', '未收到代码');
      return;
    }

    const { data, isUrlMode: urlMode } = result;

    // 检测是否从父窗口打开（通过 opener 或同源 referrer 判断）
    const hasOpener = !!window.opener;
    const hasSameOriginReferrer = document.referrer && document.referrer.startsWith(window.location.origin);
    if (hasOpener || hasSameOriginReferrer) {
      setFromParent(true);
    }

    // 设置是否使用 URL 模式
    setIsUrlMode(urlMode);

    log(`收到代码: ${data.fileName}\n\n`);
    runPreview(data.code, data.fileName);
  }, [terminalReady]);

  // 监听来自父窗口的代码更新
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.data?.type !== 'code-update') return;

      const { code, fileName } = event.data;
      if (!code || !fileName || !webcontainerRef.current) return;

      try {
        // 写入更新后的代码到文件
        await webcontainerRef.current.fs.writeFile(`/src/${fileName}`, code);
        log(`[HMR] 代码已更新: ${fileName}\n`);
      } catch (err) {
        console.error('Failed to update code:', err);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [log]);

  const runPreview = async (code: string, fileName: string) => {
    // 检测框架类型
    const detection = detectFramework(fileName);
    if (!detection) {
      setError(`不支持的文件类型: ${fileName}`);
      updateStatus('error', '不支持的文件类型');
      return;
    }

    const { adapter } = detection;
    adapterRef.current = adapter;
    setFrameworkName(adapter.name);

    // Analyze dependencies
    updateStatus('booting', '正在分析依赖...');
    const extraDeps = analyzeDependencies(code, adapter.baseDeps);
    const allDeps = [...adapter.defaultDeps, ...extraDeps];

    log(`检测到框架: ${adapter.name}\n`);
    log('分析代码依赖...\n');
    log(`默认依赖: ${adapter.defaultDeps.join(', ')}\n`);
    if (extraDeps.length > 0) {
      log(`额外依赖: ${extraDeps.join(', ')}\n`);
    }
    log('\n');

    setDependencies(allDeps.map((name) => ({ name, status: 'pending' })));

    // Check crossOriginIsolated
    if (!window.crossOriginIsolated) {
      updateStatus('booting', '等待跨域隔离环境...');
      await new Promise((resolve) => setTimeout(resolve, 2000));
      if (!window.crossOriginIsolated) {
        setError('浏览器环境不支持 WebContainers，请刷新页面重试');
        updateStatus('error', '环境不支持');
        return;
      }
    }

    try {
      updateStatus('booting', '正在启动 WebContainer...');
      log('启动 WebContainer...\n');

      const webcontainer = await getWebContainer();
      webcontainerRef.current = webcontainer;
      log('WebContainer 已启动\n\n');

      // 清理旧文件
      updateStatus('booting', '正在清理旧文件...');
      try {
        const entries = await webcontainer.fs.readdir('/');
        for (const entry of entries) {
          await webcontainer.fs.rm(`/${entry}`, { recursive: true });
        }
      } catch {
        // 忽略清理错误
      }

      // 使用适配器创建文件
      const files = adapter.createFiles(code, fileName, extraDeps);

      updateStatus('booting', '正在创建项目文件...');
      await webcontainer.mount(files as FileSystemTree);
      log('项目文件已创建\n\n');

      // 恢复 pnpm store 缓存
      const cacheRestored = await restorePnpmStoreFromCache(webcontainer, (msg) => {
        log(msg + '\n');
      });
      if (cacheRestored) {
        log('\n');
      }

      // 安装依赖
      updateStatus('installing', '正在安装依赖...');
      updateDepStatus('installing');
      log('$ pnpm install\n');

      const installProcess = await webcontainer.spawn('pnpm', ['install']);
      installProcess.output.pipeTo(
        new WritableStream({
          write: (data) => log(data),
        })
      );

      const exitCode = await installProcess.exit;
      if (exitCode !== 0) {
        throw new Error('依赖安装失败');
      }

      updateDepStatus('installed');
      log('\n');

      // 后台保存 pnpm store 缓存（不阻塞启动）
      savePnpmStoreToCache(webcontainer, (msg) => {
        console.log('[缓存]', msg);
      }).catch((err) => {
        console.error('保存 pnpm store 缓存失败:', err);
      });

      updateStatus('running', '正在启动开发服务器...');
      log('$ pnpm run dev\n');

      const devProcess = await webcontainer.spawn('pnpm', ['run', 'dev']);
      devProcess.output.pipeTo(
        new WritableStream({
          write: (data) => log(data),
        })
      );

      webcontainer.on('server-ready', async (_port, url) => {
        updateStatus('running', '开发服务器已启动');
        setPreviewUrl(url);

        // 启动交互式 shell
        await startShell(webcontainer);
      });
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : '启动失败');
      updateStatus('error', '启动失败');
    }
  };

  const getStatusDotClass = () => {
    switch (status) {
      case 'booting':
      case 'installing':
        return 'bg-amber-500';
      case 'running':
        return 'bg-emerald-500';
      case 'error':
        return 'bg-red-500';
      default:
        return 'bg-gray-500';
    }
  };

  const getDepStatusText = (depStatus: DepStatus) => {
    switch (depStatus) {
      case 'pending':
        return '待安装';
      case 'installing':
        return '安装中';
      case 'installed':
        return '已安装';
    }
  };

  const getDepStatusClass = (depStatus: DepStatus) => {
    switch (depStatus) {
      case 'pending':
        return 'bg-gray-700 text-gray-400';
      case 'installing':
        return 'bg-amber-900 text-amber-400';
      case 'installed':
        return 'bg-emerald-900 text-emerald-400';
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-[#1e1e1e] text-white font-sans">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-[#2d2d2d] border-b border-[#404040]">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-medium">{frameworkName} 组件预览</h1>
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <div className={`w-2 h-2 rounded-full ${getStatusDotClass()}`} />
            <span>{statusMessage}</span>
          </div>
        </div>
        <button
          onClick={downloadProject}
          disabled={!previewUrl || downloading}
          className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
        >
          {downloading ? (
            <>
              <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              打包中...
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              下载项目
            </>
          )}
        </button>
      </header>

      {/* 分享提示 */}
      {fromParent && (
        <div
          className={`px-4 py-2 border-b text-xs ${isUrlMode ? 'bg-blue-900/50 border-blue-800 text-blue-200' : 'bg-amber-900/50 border-amber-800 text-amber-200'}`}
        >
          {isUrlMode
            ? '可以直接复制当前页面 URL 分享给他人。注意：分享后的代码更新不会同步，如需更新请重新分享新的链接'
            : '文件内容过大，无法通过 URL 分享'}
        </div>
      )}

      {/* Main */}
      <main className="flex flex-1 min-h-0">
        {/* Left Panel */}
        <div className="w-[400px] flex flex-col bg-[#1e1e1e] border-r border-[#404040]">
          {/* Dependencies */}
          <div className="border-b border-[#404040]">
            <div className="flex items-center justify-between px-3 py-2 bg-[#2d2d2d] border-b border-[#404040]">
              <span className="text-xs text-gray-400">依赖</span>
              <span className="px-2 py-0.5 text-[10px] bg-blue-500 text-white rounded-full">
                {dependencies.length}
              </span>
            </div>
            <div className="px-3 py-2 max-h-[150px] overflow-auto">
              {dependencies.length === 0 ? (
                <div className="text-xs text-gray-500">没有额外依赖</div>
              ) : (
                dependencies.map((dep) => (
                  <div key={dep.name} className="flex items-center gap-2 py-1 text-xs font-mono">
                    <span className="text-blue-400">{dep.name}</span>
                    <span
                      className={`ml-auto px-2 py-0.5 rounded text-[10px] ${getDepStatusClass(dep.status)}`}
                    >
                      {getDepStatusText(dep.status)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Terminal */}
          <div className="flex flex-col flex-1 min-h-0">
            <div className="px-3 py-2 bg-[#2d2d2d] border-b border-[#404040]">
              <span className="text-xs text-gray-400">终端</span>
            </div>
            <div ref={terminalContainerRef} className="flex-1 overflow-hidden" />
            {/* 命令输入框 */}
            <div className="flex items-center gap-2 px-3 py-2 bg-[#2d2d2d] border-t border-[#404040]">
              <span className="text-xs text-gray-500">$</span>
              <input
                ref={inputRef}
                type="text"
                value={commandInput}
                onChange={(e) => setCommandInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    executeCommand();
                  }
                }}
                placeholder={shellReady ? '输入命令...' : '等待 Shell 启动...'}
                disabled={!shellReady}
                className="flex-1 bg-transparent text-sm text-gray-200 placeholder-gray-600 outline-none font-mono disabled:opacity-50"
              />
              <button
                onClick={executeCommand}
                disabled={!shellReady || !commandInput.trim()}
                className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                执行
              </button>
            </div>
          </div>
        </div>

        {/* Preview */}
        <div className="flex flex-col flex-1">
          <div className="flex items-center justify-between px-3 py-2 bg-[#2d2d2d] border-b border-[#404040]">
            <span className="text-xs text-gray-400">预览</span>
            {previewUrl && (
              <button
                onClick={refreshPreview}
                className="px-2 py-1 text-xs text-gray-300 hover:text-white hover:bg-[#404040] rounded transition-colors"
                title="刷新预览"
              >
                刷新
              </button>
            )}
          </div>
          <div className="flex-1 relative">
            {error ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-red-500 text-center px-5">{error}</div>
              </div>
            ) : !previewUrl ? (
              <div className="flex flex-col items-center justify-center h-full gap-4">
                <div className="w-8 h-8 border-3 border-[#404040] border-t-blue-500 rounded-full animate-spin" />
                <div className="text-gray-400">{statusMessage}</div>
              </div>
            ) : (
              <iframe ref={iframeRef} src={previewUrl} className="w-full h-full border-none bg-white" />
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default PreviewApp;
