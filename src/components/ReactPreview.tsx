import React, { useState, useEffect, useRef } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { type AttachmentFile, downloadAttachmentContent } from '../services/bitable';

interface ReactPreviewProps {
  files: AttachmentFile[];
}

// 验证文件列表，检查 App.tsx/App.jsx 的要求
function validateAppFiles(files: AttachmentFile[]): { valid: boolean; error?: string; appFile?: AttachmentFile } {
  const appFiles = files.filter(f =>
    f.name === 'App.tsx' || f.name === 'App.jsx'
  );

  if (appFiles.length === 0) {
    return {
      valid: false,
      error: '缺少入口文件：请上传 App.tsx 或 App.jsx 文件'
    };
  }

  if (appFiles.length > 1) {
    const hasAppTsx = appFiles.some(f => f.name === 'App.tsx');
    const hasAppJsx = appFiles.some(f => f.name === 'App.jsx');

    if (hasAppTsx && hasAppJsx) {
      return {
        valid: false,
        error: '入口文件冲突：不能同时存在 App.tsx 和 App.jsx，请只保留一个'
      };
    }

    return {
      valid: false,
      error: `发现多个入口文件：${appFiles.map(f => f.name).join(', ')}，请只保留一个`
    };
  }

  return { valid: true, appFile: appFiles[0] };
}

const ReactPreview: React.FC<ReactPreviewProps> = ({ files }) => {
  const [selectedFile, setSelectedFile] = useState<AttachmentFile | null>(null);
  const [codeContent, setCodeContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewWindowRef = useRef<Window | null>(null);

  // 验证文件
  const validation = validateAppFiles(files);

  // 当 files 变化时，更新 selectedFile
  useEffect(() => {
    if (files.length > 0 && validation.valid && validation.appFile) {
      // 只使用 App.tsx 或 App.jsx 作为入口文件
      const currentAppFile = validation.appFile;
      if (selectedFile?.token !== currentAppFile.token || selectedFile?.url !== currentAppFile.url) {
        setSelectedFile(currentAppFile);
      }
    } else {
      setSelectedFile(null);
      setCodeContent('');
    }
  }, [files, validation.valid, validation.appFile?.token, validation.appFile?.url]);

  // 当 selectedFile 变化时加载内容（通过 URL 判断是否需要重新加载）
  const lastLoadedUrlRef = useRef<string>('');

  useEffect(() => {
    if (!selectedFile) {
      lastLoadedUrlRef.current = '';
      return;
    }

    // 如果 URL 没变，不需要重新加载
    if (selectedFile.url === lastLoadedUrlRef.current) {
      return;
    }

    const loadCode = async () => {
      try {
        setLoading(true);
        setError(null);
        const content = await downloadAttachmentContent(selectedFile.url);
        setCodeContent(content);
        lastLoadedUrlRef.current = selectedFile.url;
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败');
      } finally {
        setLoading(false);
      }
    };

    loadCode();
  }, [selectedFile]);

  // 清理窗口引用
  useEffect(() => {
    return () => {
      if (previewWindowRef.current && !previewWindowRef.current.closed) {
        previewWindowRef.current.close();
      }
    };
  }, []);

  const openPreview = () => {
    if (!codeContent || !selectedFile) return;

    // 关闭之前的预览窗口
    if (previewWindowRef.current && !previewWindowRef.current.closed) {
      previewWindowRef.current.close();
    }

    // 将代码编码后放入 URL hash
    const data = JSON.stringify({
      code: codeContent,
      fileName: selectedFile.name
    });
    const encoded = btoa(unescape(encodeURIComponent(data)));

    // 使用相对路径获取 preview.html 的完整 URL
    const previewUrl = new URL('./preview.html', window.location.href).href + '#' + encoded;

    // 打开新窗口
    const win = window.open(previewUrl, 'react-preview', 'width=1200,height=800');
    previewWindowRef.current = win;
  };

  if (files.length === 0) {
    return (
      <div className="flex flex-col gap-3 flex-1">
        <div className="flex flex-col items-center justify-center min-h-[300px] text-center bg-white rounded-lg border border-dashed border-gray-300 gap-2">
          <div className="text-5xl mb-2">📎</div>
          <h3 className="text-base font-semibold text-gray-800">请选择附件字段</h3>
          <p className="text-sm text-gray-500">选择包含 App.tsx 或 App.jsx 文件的附件单元格</p>
        </div>
      </div>
    );
  }

  // 显示验证错误
  if (!validation.valid) {
    return (
      <div className="flex flex-col gap-3 flex-1">
        <div className="flex flex-col items-center justify-center min-h-[300px] text-center bg-white rounded-lg border border-dashed border-red-300 gap-2">
          <div className="text-5xl mb-2">⚠️</div>
          <h3 className="text-base font-semibold text-red-600">文件验证失败</h3>
          <p className="text-sm text-red-500 max-w-[280px]">{validation.error}</p>
        </div>

        {/* 显示当前文件列表 */}
        <div className="px-4 py-3 bg-gray-50 border border-gray-200 rounded-md">
          <h4 className="text-sm font-medium text-gray-700 mb-2">当前附件文件：</h4>
          <ul className="text-sm text-gray-600 space-y-1">
            {files.map((file) => (
              <li key={file.token} className="flex items-center gap-2">
                <span className={file.name === 'App.tsx' || file.name === 'App.jsx' ? 'text-red-500 font-medium' : ''}>
                  📄 {file.name}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* 使用说明 */}
        <div className="px-4 py-3 bg-blue-50 border border-blue-200 rounded-md">
          <h4 className="text-sm font-medium text-blue-800 mb-2">文件要求</h4>
          <ul className="text-sm text-blue-700 space-y-1 list-disc list-inside">
            <li>必须包含一个 App.tsx 或 App.jsx 作为入口文件</li>
            <li>不能同时存在 App.tsx 和 App.jsx</li>
            <li>入口文件必须导出一个 React 组件</li>
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 flex-1">
      {/* 文件加载错误提示 */}
      {error && (
        <div className="px-3 py-2.5 bg-red-50 border border-red-200 rounded-md text-sm text-red-600">
          {error}
        </div>
      )}

      {/* 预览按钮 - 占满整行 */}
      <button
        onClick={openPreview}
        disabled={!codeContent || loading}
        className="w-full py-3 text-base font-medium text-white bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg cursor-pointer transition-colors flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            正在加载...
          </>
        ) : (
          <>🚀 在新窗口预览</>
        )}
      </button>

      {/* 使用说明 */}
      <div className="px-4 py-3 bg-blue-50 border border-blue-200 rounded-md">
        <h4 className="text-sm font-medium text-blue-800 mb-2">使用说明</h4>
        <ul className="text-sm text-blue-700 space-y-1 list-disc list-inside">
          <li>附件中必须包含 App.tsx 或 App.jsx 作为入口</li>
          <li>目前只支持单文件组件，不支持文件间引用</li>
          <li>请确保额外依赖都在组件顶部通过 import 引入</li>
          <li>首次打开需要等待环境初始化（约30秒）</li>
        </ul>
        <h4 className="text-sm font-medium text-blue-800 mt-3 mb-2">预装依赖</h4>
        <div className="flex flex-wrap gap-1.5">
          {['react', 'react-dom', 'tailwindcss'].map((dep) => (
            <span key={dep} className="px-2 py-0.5 text-xs font-mono bg-blue-100 text-blue-700 rounded">
              {dep}
            </span>
          ))}
        </div>
        <p className="text-xs text-blue-600 mt-2">其他依赖会根据代码中的 import 自动安装</p>
      </div>

      {/* 代码预览 - 放在底部 */}
      {codeContent && !loading && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden flex flex-col flex-1">
          <div className="flex items-center px-3 py-2 bg-gray-100 border-b border-gray-200">
            <span className="text-sm font-medium text-gray-800">📄 {selectedFile?.name}</span>
          </div>
          <div className="flex-1 overflow-auto">
            <SyntaxHighlighter
              language={selectedFile?.name.endsWith('.tsx') ? 'tsx' : 'jsx'}
              style={vscDarkPlus}
              customStyle={{
                margin: 0,
                padding: '12px',
                fontSize: '12px',
                lineHeight: '1.5',
                minHeight: '100%',
              }}
              showLineNumbers
            >
              {codeContent}
            </SyntaxHighlighter>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReactPreview;
