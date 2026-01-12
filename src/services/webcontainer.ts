import { WebContainer, type FileSystemTree } from '@webcontainer/api';

let webcontainerInstance: WebContainer | null = null;

export interface ContainerStatus {
  status: 'idle' | 'booting' | 'installing' | 'running' | 'error';
  message: string;
  previewUrl?: string;
}

type StatusCallback = (status: ContainerStatus) => void;

/**
 * 检查是否支持 crossOriginIsolated
 */
export function checkCrossOriginIsolated(): boolean {
  return typeof window !== 'undefined' && window.crossOriginIsolated === true;
}

/**
 * 等待 crossOriginIsolated 可用（Service Worker 注册后）
 */
export async function waitForCrossOriginIsolated(
  timeout: number = 5000
): Promise<boolean> {
  if (checkCrossOriginIsolated()) {
    return true;
  }

  // 等待 Service Worker 注册并刷新页面
  return new Promise((resolve) => {
    const startTime = Date.now();
    const checkInterval = setInterval(() => {
      if (checkCrossOriginIsolated()) {
        clearInterval(checkInterval);
        resolve(true);
      } else if (Date.now() - startTime > timeout) {
        clearInterval(checkInterval);
        resolve(false);
      }
    }, 100);
  });
}

/**
 * 获取或创建WebContainer实例
 */
export async function getWebContainer(
  onStatus?: StatusCallback
): Promise<WebContainer> {
  if (webcontainerInstance) {
    return webcontainerInstance;
  }

  // 检查 crossOriginIsolated
  if (!checkCrossOriginIsolated()) {
    onStatus?.({
      status: 'booting',
      message: '正在等待跨域隔离环境...',
    });

    const isIsolated = await waitForCrossOriginIsolated(3000);
    if (!isIsolated) {
      throw new Error(
        '浏览器不支持 crossOriginIsolated。请刷新页面重试，或确保使用支持的浏览器（Chrome/Edge/Firefox）。'
      );
    }
  }

  onStatus?.({ status: 'booting', message: '正在启动 WebContainer...' });

  webcontainerInstance = await WebContainer.boot();
  return webcontainerInstance;
}

/**
 * 生成React项目文件结构
 */
function createProjectFiles(componentCode: string, fileName: string): FileSystemTree {
  const isTypeScript = fileName.endsWith('.tsx');
  const componentName = fileName.replace(/\.(jsx|tsx)$/, '');

  return {
    'package.json': {
      file: {
        contents: JSON.stringify(
          {
            name: 'react-preview',
            type: 'module',
            scripts: {
              dev: 'vite',
              build: 'vite build',
            },
            dependencies: {
              react: '^18.2.0',
              'react-dom': '^18.2.0',
            },
            devDependencies: {
              vite: '^5.0.0',
              '@vitejs/plugin-react': '^4.2.0',
              ...(isTypeScript
                ? {
                    typescript: '^5.3.0',
                    '@types/react': '^18.2.0',
                    '@types/react-dom': '^18.2.0',
                  }
                : {}),
            },
          },
          null,
          2
        ),
      },
    },
    'vite.config.js': {
      file: {
        contents: `
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
        `.trim(),
      },
    },
    'index.html': {
      file: {
        contents: `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>React Preview</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: system-ui, -apple-system, sans-serif; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.${isTypeScript ? 'tsx' : 'jsx'}"></script>
  </body>
</html>
        `.trim(),
      },
    },
    src: {
      directory: {
        [`main.${isTypeScript ? 'tsx' : 'jsx'}`]: {
          file: {
            contents: `
import React from 'react';
import ReactDOM from 'react-dom/client';
import ${componentName} from './${fileName}';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <${componentName} />
  </React.StrictMode>
);
            `.trim(),
          },
        },
        [fileName]: {
          file: {
            contents: componentCode,
          },
        },
      },
    },
  };
}

/**
 * 运行React预览
 */
export async function runReactPreview(
  componentCode: string,
  fileName: string,
  onStatus?: StatusCallback,
  onOutput?: (data: string) => void
): Promise<string> {
  const container = await getWebContainer(onStatus);

  onStatus?.({ status: 'booting', message: '正在准备项目文件...' });

  // 创建项目文件
  const files = createProjectFiles(componentCode, fileName);
  await container.mount(files);

  onStatus?.({ status: 'installing', message: '正在安装依赖 (npm install)...' });

  // 安装依赖
  const installProcess = await container.spawn('npm', ['install']);

  installProcess.output.pipeTo(
    new WritableStream({
      write(data) {
        onOutput?.(data);
      },
    })
  );

  const installExitCode = await installProcess.exit;
  if (installExitCode !== 0) {
    onStatus?.({ status: 'error', message: '依赖安装失败' });
    throw new Error('依赖安装失败');
  }

  onStatus?.({ status: 'running', message: '正在启动开发服务器 (npm run dev)...' });

  // 启动开发服务器
  const devProcess = await container.spawn('npm', ['run', 'dev']);

  devProcess.output.pipeTo(
    new WritableStream({
      write(data) {
        onOutput?.(data);
      },
    })
  );

  // 等待服务器准备就绪
  return new Promise((resolve) => {
    container.on('server-ready', (_port, url) => {
      onStatus?.({
        status: 'running',
        message: '开发服务器已启动',
        previewUrl: url,
      });
      resolve(url);
    });
  });
}

/**
 * 更新组件代码（热更新）
 */
export async function updateComponentCode(
  componentCode: string,
  fileName: string
): Promise<void> {
  if (!webcontainerInstance) {
    throw new Error('WebContainer 未初始化');
  }

  await webcontainerInstance.fs.writeFile(`/src/${fileName}`, componentCode);
}

/**
 * 销毁WebContainer实例
 */
export async function destroyWebContainer(): Promise<void> {
  if (webcontainerInstance) {
    webcontainerInstance.teardown();
    webcontainerInstance = null;
  }
}
