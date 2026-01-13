import { useState, useEffect, useRef, useCallback } from 'react';
import { WebContainer, type FileSystemTree } from '@webcontainer/api';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import 'xterm/css/xterm.css';
import { savePnpmStoreToCache, restorePnpmStoreFromCache } from './pnpmCache';

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
}

// 基础依赖（不需要从代码中检测）
const BASE_DEPS = ['react', 'react-dom', 'react/jsx-runtime', 'tailwindcss', 'postcss', 'autoprefixer'];
// 默认显示的依赖
const DEFAULT_DEPS = ['react', 'react-dom', 'tailwindcss'];

function analyzeDependencies(code: string): string[] {
  const deps = new Set<string>();

  // Match import ... from 'package'
  const importFromRegex = /import\s+(?:[\w\s{},*]+\s+from\s+)?['"]([^'"./][^'"]*)['"]/g;
  let match;
  while ((match = importFromRegex.exec(code)) !== null) {
    let pkg = match[1];
    if (pkg.startsWith('@')) {
      const parts = pkg.split('/');
      pkg = parts[0] + '/' + parts[1];
    } else {
      pkg = pkg.split('/')[0];
    }
    deps.add(pkg);
  }

  // Match require('package')
  const requireRegex = /require\s*\(\s*['"]([^'"./][^'"]*)['"]\s*\)/g;
  while ((match = requireRegex.exec(code)) !== null) {
    let pkg = match[1];
    if (pkg.startsWith('@')) {
      const parts = pkg.split('/');
      pkg = parts[0] + '/' + parts[1];
    } else {
      pkg = pkg.split('/')[0];
    }
    deps.add(pkg);
  }

  return Array.from(deps).filter((dep) => !BASE_DEPS.includes(dep));
}

function getCodeFromHash(): CodeData | null {
  const hash = window.location.hash;
  if (!hash || hash.length < 2) {
    return null;
  }
  try {
    const encoded = hash.substring(1);
    const decoded = decodeURIComponent(escape(atob(encoded)));
    return JSON.parse(decoded);
  } catch (e) {
    console.error('Failed to decode hash:', e);
    return null;
  }
}

interface CreateFilesResult {
  files: FileSystemTree;
}

function createFiles(code: string, fileName: string, extraDeps: string[]): CreateFilesResult {
  const isTypeScript = fileName.endsWith('.tsx');
  const componentName = fileName.replace(/\.(jsx|tsx)$/, '');

  const dependencies: Record<string, string> = {
    react: '^18.2.0',
    'react-dom': '^18.2.0',
  };

  extraDeps.forEach((dep) => {
    dependencies[dep] = 'latest';
  });

  const devDependencies: Record<string, string> = {
    '@rsbuild/core': '^1.0.0',
    '@rsbuild/plugin-react': '^1.0.0',
    '@rspack/binding-wasm32-wasi': '^1.0.0',
    tailwindcss: '^3.4.0',
    postcss: '^8.4.0',
    autoprefixer: '^10.4.0',
    ...(isTypeScript
      ? {
          typescript: '^5.3.0',
          '@types/react': '^18.2.0',
          '@types/react-dom': '^18.2.0',
        }
      : {}),
  };

  const packageJson = {
    name: 'react-preview',
    type: 'module',
    scripts: { dev: 'rsbuild dev' },
    dependencies,
    devDependencies,
  };

  const rsbuildConfig = `import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';

export default defineConfig({
  plugins: [pluginReact()],
});`;

  const tailwindConfig = `/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
};`;

  const postcssConfig = `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};`;

  const indexCss = `@tailwind base;
@tailwind components;
@tailwind utilities;`;

  const mainFile = `import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import ${componentName} from './${fileName}';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <${componentName} />
  </React.StrictMode>
);`;

  const npmrc = `store-dir=.local/share/pnpm/store`;

  const files = {
    'package.json': { file: { contents: JSON.stringify(packageJson, null, 2) } },
    '.npmrc': { file: { contents: npmrc } },
    'rsbuild.config.mjs': { file: { contents: rsbuildConfig } },
    'tailwind.config.js': { file: { contents: tailwindConfig } },
    'postcss.config.mjs': { file: { contents: postcssConfig } },
    src: {
      directory: {
        'index.tsx': { file: { contents: mainFile } },
        'index.css': { file: { contents: indexCss } },
        [fileName]: { file: { contents: code } },
      },
    },
  };

  return { files: files as FileSystemTree };
}

// 全局终端实例，避免闭包问题
let globalTerminal: Terminal | null = null;

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
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const webcontainerRef = useRef<WebContainer | null>(null);
  const shellInputRef = useRef<WritableStreamDefaultWriter<string> | null>(null);
  const initedRef = useRef(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

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

  // 启动交互式 shell
  const startShell = useCallback(async (webcontainer: WebContainer) => {
    const shellProcess = await webcontainer.spawn('jsh', {
      terminal: {
        cols: globalTerminal?.cols || 80,
        rows: globalTerminal?.rows || 24,
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

  // 初始化 xterm
  useEffect(() => {
    if (!terminalContainerRef.current || globalTerminal) return;

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
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(terminalContainerRef.current);
    fitAddon.fit();

    globalTerminal = terminal;
    fitAddonRef.current = fitAddon;

    setTerminalReady(true);

    const handleResize = () => fitAddon.fit();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      terminal.dispose();
      globalTerminal = null;
    };
  }, []);

  // 启动预览
  useEffect(() => {
    if (!terminalReady || initedRef.current) return;
    initedRef.current = true;

    const data = getCodeFromHash();
    if (!data || !data.code) {
      setError('未能接收到代码，请关闭此窗口并重新点击预览按钮');
      updateStatus('error', '未收到代码');
      return;
    }

    log(`收到代码: ${data.fileName}\n\n`);
    runPreview(data.code, data.fileName);
  }, [terminalReady]);

  const runPreview = async (code: string, fileName: string) => {
    // Analyze dependencies
    updateStatus('booting', '正在分析依赖...');
    const extraDeps = analyzeDependencies(code);
    const allDeps = [...DEFAULT_DEPS, ...extraDeps];

    log('分析代码依赖...\n');
    log(`默认依赖: ${DEFAULT_DEPS.join(', ')}\n`);
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

      const { files } = createFiles(code, fileName, extraDeps);

      updateStatus('booting', '正在创建项目文件...');
      await webcontainer.mount(files);
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
      <header className="flex items-center gap-3 px-4 py-3 bg-[#2d2d2d] border-b border-[#404040]">
        <h1 className="text-sm font-medium">React 组件预览</h1>
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <div className={`w-2 h-2 rounded-full ${getStatusDotClass()}`} />
          <span>{statusMessage}</span>
        </div>
      </header>

      {/* Main */}
      <main className="flex flex-1 min-h-0">
        {/* Left Panel */}
        <div className="w-[400px] flex flex-col bg-[#1e1e1e] border-r border-[#404040]">
          {/* Dependencies */}
          <div className="border-b border-[#404040]">
            <div className="flex items-center justify-between px-3 py-2 bg-[#2d2d2d] border-b border-[#404040]">
              <span className="text-xs text-gray-400">📦 依赖</span>
              <span className="px-2 py-0.5 text-[10px] bg-blue-500 text-white rounded-full">
                {dependencies.length}
              </span>
            </div>
            <div className="px-3 py-2 max-h-[150px] overflow-auto">
              {dependencies.length === 0 ? (
                <div className="text-xs text-gray-500">没有额外依赖</div>
              ) : (
                dependencies.map((dep) => (
                  <div
                    key={dep.name}
                    className="flex items-center gap-2 py-1 text-xs font-mono"
                  >
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
              <span className="text-xs text-gray-400">⬛ 终端</span>
            </div>
            <div
              ref={terminalContainerRef}
              className="flex-1 overflow-hidden"
            />
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
                ↻ 刷新
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
