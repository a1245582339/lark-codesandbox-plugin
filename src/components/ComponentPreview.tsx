import React, { useState, useEffect, useRef, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import { compressToEncodedURIComponent } from 'lz-string';
import { type AttachmentFile, downloadAttachmentContent } from '../services/bitable';
import { detectFramework, isSupportedFile, SUPPORTED_EXTENSIONS } from '../adapters';

// URL 长度限制，超过则降级到 localStorage
const MAX_URL_LENGTH = 60000;

// 文件历史记录存储 key
const FILE_HISTORY_KEY = 'component-preview-file-history';
const MAX_HISTORY_FILES = 20;

// 默认示例文件路径（.template 后缀会在加载时去除）
const DEFAULT_EXAMPLE_FILES = [
  'example/示例 生死簿后台管理系统.tsx.template',
  'example/示例 tinder.vue.template',
  'example/示例 死了么.svelte.template',
];

// 历史文件记录
interface HistoryFile {
  id: string; // 唯一ID，允许同名文件
  name: string;
  content: string;
  timestamp: number;
}

// 生成唯一ID
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// 从 localStorage 加载历史文件
function loadFileHistory(): HistoryFile[] {
  try {
    const data = localStorage.getItem(FILE_HISTORY_KEY);
    if (data) {
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('Failed to load file history:', e);
  }
  return [];
}

// 保存历史文件到 localStorage
function saveFileHistory(files: HistoryFile[]) {
  try {
    // 只保留最近的 N 个文件
    const trimmed = files.slice(0, MAX_HISTORY_FILES);
    localStorage.setItem(FILE_HISTORY_KEY, JSON.stringify(trimmed));
  } catch (e) {
    console.error('Failed to save file history:', e);
  }
}

// 添加文件到历史记录（允许同名文件）
function addToHistory(name: string, content: string, history: HistoryFile[], existingId?: string): HistoryFile[] {
  if (existingId) {
    // 更新现有文件
    return history.map((f) =>
      f.id === existingId ? { ...f, content, timestamp: Date.now() } : f
    );
  }
  // 添加新文件到最前面
  return [{ id: generateId(), name, content, timestamp: Date.now() }, ...history];
}

// 加载默认示例文件
async function loadDefaultExamples(): Promise<HistoryFile[]> {
  const examples: HistoryFile[] = [];
  for (const filePath of DEFAULT_EXAMPLE_FILES) {
    try {
      const response = await fetch(filePath);
      if (response.ok) {
        const content = await response.text();
        // 去除 .template 后缀
        const name = (filePath.split('/').pop() || filePath).replace(/\.template$/, '');
        examples.push({
          id: generateId(),
          name,
          content,
          timestamp: Date.now(),
        });
      }
    } catch (e) {
      console.error(`Failed to load example file: ${filePath}`, e);
    }
  }
  return examples;
}

// 框架 Logo SVG 组件
const ReactLogo = () => (
  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="#61DAFB">
    <path d="M12 10.11c1.03 0 1.87.84 1.87 1.89 0 1-.84 1.85-1.87 1.85S10.13 13 10.13 12c0-1.05.84-1.89 1.87-1.89M7.37 20c.63.38 2.01-.2 3.6-1.7-.52-.59-1.03-1.23-1.51-1.9a22.7 22.7 0 01-2.4-.36c-.51 2.14-.32 3.61.31 3.96m.71-5.74l-.29-.51c-.11.29-.22.58-.29.86.27.06.57.11.88.16l-.3-.51m6.54-.76l.81-1.5-.81-1.5c-.3-.53-.62-1-.91-1.47C13.17 9 12.6 9 12 9s-1.17 0-1.71.03c-.29.47-.61.94-.91 1.47L8.57 12l.81 1.5c.3.53.62 1 .91 1.47.54.03 1.11.03 1.71.03s1.17 0 1.71-.03c.29-.47.61-.94.91-1.47M12 6.78c-.19.22-.39.45-.59.72h1.18c-.2-.27-.4-.5-.59-.72m0 10.44c.19-.22.39-.45.59-.72h-1.18c.2.27.4.5.59.72M16.62 4c-.62-.38-2 .2-3.59 1.7.52.59 1.03 1.23 1.51 1.9.82.08 1.63.2 2.4.36.51-2.14.32-3.61-.32-3.96m-.7 5.74l.29.51c.11-.29.22-.58.29-.86-.27-.06-.57-.11-.88-.16l.3.51m1.45-7.05c1.47.84 1.63 3.05 1.01 5.63 2.54.75 4.37 1.99 4.37 3.68s-1.83 2.93-4.37 3.68c.62 2.58.46 4.79-1.01 5.63-1.46.84-3.45-.12-5.37-1.95-1.92 1.83-3.91 2.79-5.38 1.95-1.46-.84-1.62-3.05-1-5.63-2.54-.75-4.37-1.99-4.37-3.68s1.83-2.93 4.37-3.68c-.62-2.58-.46-4.79 1-5.63 1.47-.84 3.46.12 5.38 1.95 1.92-1.83 3.91-2.79 5.37-1.95M17.08 12c.34.75.64 1.5.89 2.26 2.1-.63 3.28-1.53 3.28-2.26s-1.18-1.63-3.28-2.26c-.25.76-.55 1.51-.89 2.26M6.92 12c-.34-.75-.64-1.5-.89-2.26-2.1.63-3.28 1.53-3.28 2.26s1.18 1.63 3.28 2.26c.25-.76.55-1.51.89-2.26m9 2.26l-.3.51c.31-.05.61-.1.88-.16-.07-.28-.18-.57-.29-.86l-.29.51m-2.89 4.04c1.59 1.5 2.97 2.08 3.59 1.7.64-.35.83-1.82.32-3.96-.77.16-1.58.28-2.4.36-.48.67-.99 1.31-1.51 1.9M8.08 9.74l.3-.51c-.31.05-.61.1-.88.16.07.28.18.57.29.86l.29-.51m2.89-4.04C9.38 4.2 8 3.62 7.37 4c-.63.35-.82 1.82-.31 3.96a22.7 22.7 0 012.4-.36c.48-.67.99-1.31 1.51-1.9z"/>
  </svg>
);

const VueLogo = () => (
  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="#4FC08D">
    <path d="M2 3h3.5L12 15l6.5-12H22L12 21 2 3m4.5 0h3L12 7.58 14.5 3h3L12 13.08 6.5 3z"/>
  </svg>
);

const SvelteLogo = () => (
  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="#FF3E00">
    <path d="M20.58 6.75c-1.77-2.65-5.37-3.43-8.1-1.87l-4.17 2.4a5.43 5.43 0 00-2.47 3.37 5.1 5.1 0 00.53 3.85 5.05 5.05 0 00-1.2 1.93 5.21 5.21 0 00.87 5.07c1.77 2.65 5.37 3.43 8.1 1.87l4.17-2.4a5.43 5.43 0 002.47-3.37 5.1 5.1 0 00-.53-3.85 5.05 5.05 0 001.2-1.93 5.21 5.21 0 00-.87-5.07zM9.77 20.41a3.37 3.37 0 01-3.63-1.2 3.08 3.08 0 01-.53-2.31c.03-.18.08-.36.15-.53l.12-.3.31.19a6.13 6.13 0 001.87 1.05l.18.06-.02.18a.93.93 0 00.18.62 1.01 1.01 0 001.09.36.97.97 0 00.36-.17l4.17-2.4a.9.9 0 00.4-.56.86.86 0 00-.13-.66 1.01 1.01 0 00-1.09-.36.97.97 0 00-.36.17l-1.59.92a3.23 3.23 0 01-1.18.53 3.37 3.37 0 01-3.63-1.2 3.08 3.08 0 01-.53-2.31 3.1 3.1 0 011.41-2.06l4.17-2.4a3.23 3.23 0 011.18-.53 3.37 3.37 0 013.63 1.2 3.08 3.08 0 01.53 2.31c-.03.18-.08.36-.15.53l-.12.3-.31-.19a6.13 6.13 0 00-1.87-1.05l-.18-.06.02-.18a.93.93 0 00-.18-.62 1.01 1.01 0 00-1.09-.36.97.97 0 00-.36.17l-4.17 2.4a.9.9 0 00-.4.56.86.86 0 00.13.66 1.01 1.01 0 001.09.36.97.97 0 00.36-.17l1.59-.92a3.23 3.23 0 011.18-.53 3.37 3.37 0 013.63 1.2 3.08 3.08 0 01.53 2.31 3.1 3.1 0 01-1.41 2.06l-4.17 2.4a3.23 3.23 0 01-1.18.53z"/>
  </svg>
);

// 获取框架 Logo 组件
function getFrameworkLogo(type: string | undefined) {
  switch (type) {
    case 'react':
      return <ReactLogo />;
    case 'vue':
      return <VueLogo />;
    case 'svelte':
      return <SvelteLogo />;
    default:
      return <span className="w-4 h-4 text-center">📄</span>;
  }
}

interface ComponentPreviewProps {
  files: AttachmentFile[];
  setFiles: (files: AttachmentFile[]) => void;
  isInBitable: boolean;
}

// 验证文件，检查是否是支持的组件文件
function validateComponentFile(files: AttachmentFile[]): {
  valid: boolean;
  error?: string;
  componentFile?: AttachmentFile;
  frameworkName?: string;
} {
  // 单文件模式：只取第一个支持的文件
  const supportedFiles = files.filter((f) => isSupportedFile(f.name));

  if (supportedFiles.length === 0) {
    return {
      valid: false,
      error: `缺少组件文件：请上传 ${SUPPORTED_EXTENSIONS.join(', ')} 文件`,
    };
  }

  // 取第一个文件作为入口
  const componentFile = supportedFiles[0];
  const detection = detectFramework(componentFile.name);

  if (!detection) {
    return {
      valid: false,
      error: `不支持的文件类型: ${componentFile.name}`,
    };
  }

  return {
    valid: true,
    componentFile,
    frameworkName: detection.adapter.name,
  };
}

const ComponentPreview: React.FC<ComponentPreviewProps> = ({ files, setFiles, isInBitable }) => {
  const [selectedFile, setSelectedFile] = useState<AttachmentFile | null>(null);
  const [codeContent, setCodeContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editorHeight, setEditorHeight] = useState<number>(400);
  const [frameworkName, setFrameworkName] = useState<string>('');
  // 历史文件列表（仅非多维表格环境使用）
  const [fileHistory, setFileHistory] = useState<HistoryFile[]>(() => isInBitable ? [] : loadFileHistory());
  // 当前选中的历史文件 ID（用于高亮和更新）
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);
  const previewWindowRef = useRef<Window | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  // 存储本地上传文件的内容
  const localFileContents = useRef<Map<string, string>>(new Map());
  // 当前预览使用的 localStorage key（降级模式）
  const previewKeyRef = useRef<string | null>(null);
  // 是否使用 URL 模式（跨浏览器共享）
  const useUrlModeRef = useRef<boolean>(false);

  // 计算编辑器高度
  useEffect(() => {
    const updateEditorHeight = () => {
      if (editorContainerRef.current) {
        const rect = editorContainerRef.current.getBoundingClientRect();
        const availableHeight = window.innerHeight - rect.top - 16; // 16px 底部边距
        setEditorHeight(Math.max(300, availableHeight));
      }
    };

    updateEditorHeight();
    window.addEventListener('resize', updateEditorHeight);
    return () => window.removeEventListener('resize', updateEditorHeight);
  }, [codeContent, loading]);

  // 处理本地文件上传
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFiles = e.target.files;
    if (!uploadedFiles || uploadedFiles.length === 0) return;

    const newFiles: AttachmentFile[] = [];
    localFileContents.current.clear();

    for (const file of Array.from(uploadedFiles)) {
      if (isSupportedFile(file.name)) {
        const content = await file.text();
        const token = `local-${Date.now()}-${file.name}`;
        localFileContents.current.set(token, content);
        newFiles.push({
          name: file.name,
          url: '', // 本地文件没有 URL
          token,
          type: file.type,
        });
      }
    }

    setFiles(newFiles);
    // 清空 input 以便重复上传同一文件
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // 验证文件
  const validation = validateComponentFile(files);

  // 当 files 变化时，更新 selectedFile
  useEffect(() => {
    if (files.length > 0 && validation.valid && validation.componentFile) {
      const currentFile = validation.componentFile;
      if (selectedFile?.token !== currentFile.token || selectedFile?.url !== currentFile.url) {
        setSelectedFile(currentFile);
        setFrameworkName(validation.frameworkName || '');
        // 清除历史选中状态，因为加载了新文件
        setActiveHistoryId(null);
      }
    }
    // 不再清空 selectedFile，让历史文件可以保持显示
  }, [files, validation.valid, validation.componentFile?.token, validation.componentFile?.url]);

  // 当 selectedFile 变化时加载内容
  const lastLoadedTokenRef = useRef<string>('');

  useEffect(() => {
    if (!selectedFile) {
      lastLoadedTokenRef.current = '';
      return;
    }

    // 如果 token 没变，不需要重新加载
    if (selectedFile.token === lastLoadedTokenRef.current) {
      return;
    }

    // 历史文件不需要下载，内容已经通过 handleHistoryFileClick 加载
    if (selectedFile.token.startsWith('history-')) {
      lastLoadedTokenRef.current = selectedFile.token;
      return;
    }

    const loadCode = async () => {
      try {
        setLoading(true);
        setError(null);

        let content: string;
        // 检查是否是本地上传的文件
        if (selectedFile.token.startsWith('local-')) {
          content = localFileContents.current.get(selectedFile.token) || '';
        } else {
          content = await downloadAttachmentContent(selectedFile.url);
        }

        setCodeContent(content);
        lastLoadedTokenRef.current = selectedFile.token;

        // 保存到历史记录（新文件）- 仅非多维表格环境
        if (content && !isInBitable) {
          const newHistory = addToHistory(selectedFile.name, content, fileHistory);
          setFileHistory(newHistory);
          saveFileHistory(newHistory);
          // 新添加的文件 ID 是数组第一个
          setActiveHistoryId(newHistory[0].id);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败');
      } finally {
        setLoading(false);
      }
    };

    loadCode();
  }, [selectedFile]);

  // 点击历史文件切换
  const handleHistoryFileClick = useCallback((historyFile: HistoryFile) => {
    // 更新当前代码内容
    setCodeContent(historyFile.content);
    setActiveHistoryId(historyFile.id);

    // 检测框架类型
    const detection = detectFramework(historyFile.name);
    if (detection) {
      setFrameworkName(detection.adapter.name);
    }

    // 创建一个虚拟的 selectedFile 用于预览
    const virtualFile: AttachmentFile = {
      name: historyFile.name,
      url: '',
      token: `history-${historyFile.id}`,
      type: '',
    };
    setSelectedFile(virtualFile);
    lastLoadedTokenRef.current = virtualFile.token;
  }, []);

  // 删除历史文件
  const handleDeleteHistoryFile = useCallback((fileId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newHistory = fileHistory.filter((f) => f.id !== fileId);
    setFileHistory(newHistory);
    saveFileHistory(newHistory);

    // 如果删除的是当前选中的文件
    if (activeHistoryId === fileId) {
      // 如果还有其他历史文件，自动选择第一个
      if (newHistory.length > 0) {
        const nextFile = newHistory[0];
        setActiveHistoryId(nextFile.id);
        setCodeContent(nextFile.content);
        setSelectedFile({
          name: nextFile.name,
          url: '',
          token: `history-${nextFile.id}`,
          type: '',
        });
      } else {
        // 没有其他文件了，清空编辑器
        setActiveHistoryId(null);
        setCodeContent('');
        setSelectedFile(null);
      }
    }
  }, [fileHistory, activeHistoryId]);

  // 初始化时自动加载历史文件或默认示例（仅非多维表格环境）
  const initializedRef = useRef(false);
  useEffect(() => {
    if (isInBitable) return; // 多维表格环境不自动加载历史
    if (initializedRef.current) return;
    if (files.length > 0) return; // 有新上传的文件，不自动加载

    const initHistory = async () => {
      initializedRef.current = true;

      if (fileHistory.length > 0) {
        // 有历史文件，加载第一个
        handleHistoryFileClick(fileHistory[0]);
      } else {
        // 只有在 localStorage 中完全没有历史记录字段时，才加载默认示例
        // 如果字段存在但为空数组，说明用户主动删除了所有文件，不自动加载示例
        const hasHistoryKey = localStorage.getItem(FILE_HISTORY_KEY) !== null;
        if (!hasHistoryKey) {
          const examples = await loadDefaultExamples();
          if (examples.length > 0) {
            setFileHistory(examples);
            saveFileHistory(examples);
            handleHistoryFileClick(examples[0]);
          }
        }
      }
    };

    initHistory();
  }, [isInBitable, files.length, fileHistory, handleHistoryFileClick]);

  // 清理窗口引用
  useEffect(() => {
    return () => {
      if (previewWindowRef.current && !previewWindowRef.current.closed) {
        previewWindowRef.current.close();
      }
    };
  }, []);

  // 代码变化时同步到预览窗口和存储
  const syncCodeToPreview = (code: string) => {
    if (previewWindowRef.current && !previewWindowRef.current.closed && selectedFile) {
      previewWindowRef.current.postMessage(
        {
          type: 'code-update',
          code,
          fileName: selectedFile.name,
        },
        '*'
      );
    }
    // 根据模式同步更新存储
    if (selectedFile) {
      if (useUrlModeRef.current && previewWindowRef.current && !previewWindowRef.current.closed) {
        // URL 模式：更新预览窗口的 URL hash
        const data = JSON.stringify({
          code,
          fileName: selectedFile.name,
          fromParent: true,
        });
        const compressed = compressToEncodedURIComponent(data);
        const newUrl = new URL('./preview.html', window.location.href).href + '#c=' + compressed;
        // 只有 URL 长度在限制内才更新
        if (newUrl.length <= MAX_URL_LENGTH) {
          previewWindowRef.current.location.hash = '#c=' + compressed;
        }
      } else if (previewKeyRef.current) {
        // localStorage 模式
        const data = JSON.stringify({
          code,
          fileName: selectedFile.name,
        });
        localStorage.setItem(previewKeyRef.current, data);
      }
    }
  };

  // 防抖更新历史记录
  const updateHistoryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCodeChange = (value: string | undefined) => {
    const newCode = value || '';
    setCodeContent(newCode);
    syncCodeToPreview(newCode);

    // 防抖更新历史记录（500ms 后更新）- 仅非多维表格环境
    if (!isInBitable && selectedFile && activeHistoryId) {
      if (updateHistoryTimeoutRef.current) {
        clearTimeout(updateHistoryTimeoutRef.current);
      }
      updateHistoryTimeoutRef.current = setTimeout(() => {
        // 使用 existingId 更新现有文件而不是创建新文件
        const newHistory = addToHistory(selectedFile.name, newCode, fileHistory, activeHistoryId);
        setFileHistory(newHistory);
        saveFileHistory(newHistory);
      }, 500);
    }
  };

  const openPreview = () => {
    if (!codeContent || !selectedFile) return;

    // 关闭之前的预览窗口
    if (previewWindowRef.current && !previewWindowRef.current.closed) {
      previewWindowRef.current.close();
    }

    const data = JSON.stringify({
      code: codeContent,
      fileName: selectedFile.name,
      fromParent: true, // 标记为从父窗口打开
    });

    // 尝试使用 URL 压缩模式（支持跨浏览器）
    const compressed = compressToEncodedURIComponent(data);
    const baseUrl = new URL('./preview.html', window.location.href).href;
    const urlWithCompressed = baseUrl + '#c=' + compressed;

    let previewUrl: string;

    if (urlWithCompressed.length <= MAX_URL_LENGTH) {
      // URL 长度在限制内，使用 URL 模式
      useUrlModeRef.current = true;
      previewKeyRef.current = null;
      previewUrl = urlWithCompressed;
    } else {
      // URL 过长，降级到 localStorage 模式
      useUrlModeRef.current = false;
      const key = `preview-${Date.now()}`;
      previewKeyRef.current = key;
      localStorage.setItem(key, data);
      previewUrl = baseUrl + '#' + key;
    }

    // 打开新窗口
    const win = window.open(previewUrl, 'component-preview', 'width=1200,height=800');
    previewWindowRef.current = win;
  };

  // 获取 Monaco 编辑器语言
  const getEditorLanguage = (fileName: string): string => {
    const detection = detectFramework(fileName);
    if (detection) {
      return detection.adapter.getEditorLanguage(fileName);
    }
    // 默认
    if (fileName.endsWith('.tsx') || fileName.endsWith('.ts')) {
      return 'typescript';
    }
    return 'javascript';
  };

  // 支持的文件后缀显示
  const supportedExtensions = SUPPORTED_EXTENSIONS.join(', ');

  // 空状态：多维表格环境下无附件文件时显示，独立环境下无历史文件且无新文件时显示
  if (files.length === 0 && fileHistory.length === 0) {
    return (
      <div className="flex flex-col gap-3 flex-1">
        <input
          ref={fileInputRef}
          type="file"
          accept={SUPPORTED_EXTENSIONS.join(',')}
          onChange={handleFileUpload}
          className="hidden"
        />
        {isInBitable ? (
          <div className="flex flex-col items-center justify-center min-h-[300px] text-center bg-white rounded-lg border border-dashed border-gray-300 gap-2">
            <div className="text-5xl mb-2">📎</div>
            <h3 className="text-base font-semibold text-gray-800">请选择附件字段</h3>
            <p className="text-sm text-gray-500">
              选择包含 {supportedExtensions} 文件的附件单元格
            </p>
          </div>
        ) : (
          <div
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center justify-center min-h-[300px] text-center bg-white rounded-lg border border-dashed border-gray-300 gap-2 cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
          >
            <div className="text-5xl mb-2">📤</div>
            <h3 className="text-base font-semibold text-gray-800">点击上传文件</h3>
            <p className="text-sm text-gray-500">支持 {supportedExtensions} 文件</p>
          </div>
        )}
      </div>
    );
  }

  // 显示验证错误（但如果是从历史文件选择的，则跳过）
  if (!validation.valid && !activeHistoryId) {
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
                <span
                  className={isSupportedFile(file.name) ? 'text-green-600 font-medium' : 'text-gray-500'}
                >
                  📄 {file.name}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* 使用说明 */}
        <div className="px-4 py-3 bg-blue-50 border border-blue-200 rounded-md">
          <h4 className="text-sm font-medium text-blue-800 mb-2">支持的框架</h4>
          <ul className="text-sm text-blue-700 space-y-1 list-disc list-inside">
            <li>React: .jsx, .tsx 文件</li>
            <li>Vue 3: .vue 文件</li>
            <li>Svelte: .svelte 文件</li>
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

      {/* 操作按钮 */}
      <div className="flex gap-2">
        <button
          onClick={openPreview}
          disabled={!codeContent || loading}
          className="flex-1 py-3 text-base font-medium text-white bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg cursor-pointer transition-colors flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              正在加载...
            </>
          ) : (
            <>在新窗口预览</>
          )}
        </button>
        {!isInBitable && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept={SUPPORTED_EXTENSIONS.join(',')}
              onChange={handleFileUpload}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-3 text-base font-medium text-gray-700 bg-gray-200 hover:bg-gray-300 rounded-lg cursor-pointer transition-colors"
            >
              上传新文件
            </button>
          </>
        )}
      </div>

      {/* 使用说明 */}
      <div className="px-4 py-3 bg-blue-50 border border-blue-200 rounded-md">
        <h4 className="text-sm font-medium text-blue-800 mb-2">使用说明</h4>
        <ul className="text-sm text-blue-700 space-y-1 list-disc list-inside">
          <li>支持 React (.jsx/.tsx)、Vue 3 (.vue)、Svelte (.svelte)</li>
          <li>目前只支持单文件组件，不支持文件间引用</li>
          <li>请确保额外依赖都在组件顶部通过 import 引入</li>
          <li>首次打开需要等待环境初始化（约30秒-1分钟）</li>
        </ul>
        <h4 className="text-sm font-medium text-blue-800 mt-3 mb-2">
          当前框架: {frameworkName} | 预装依赖
        </h4>
        <div className="flex flex-wrap gap-1.5">
          {(frameworkName === 'React'
            ? ['react', 'react-dom', 'tailwindcss']
            : frameworkName === 'Vue 3'
              ? ['vue', 'tailwindcss']
              : ['svelte', 'tailwindcss']
          ).map((dep) => (
            <span key={dep} className="px-2 py-0.5 text-xs font-mono bg-blue-100 text-blue-700 rounded">
              {dep}
            </span>
          ))}
        </div>
        <p className="text-xs text-blue-600 mt-2">其他依赖会根据代码中的 import 自动安装</p>
      </div>

      {/* 代码编辑器 */}
      {codeContent && !loading && (
        <div
          ref={editorContainerRef}
          className="bg-white rounded-lg border border-gray-200 overflow-hidden flex"
        >
          {/* 左侧文件列表（仅非多维表格环境显示） */}
          {!isInBitable && (
            <div className="w-52 bg-[#252526] border-r border-[#3c3c3c] flex flex-col">
              <div className="px-3 py-2 text-xs text-gray-400 uppercase tracking-wide flex items-center justify-between">
                <span>历史文件</span>
                <span className="text-[10px] bg-gray-600 px-1.5 rounded">{fileHistory.length}</span>
              </div>
              <div className="flex-1 overflow-y-auto">
                {fileHistory.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-gray-500">暂无历史文件</div>
                ) : (
                  fileHistory.map((historyFile) => {
                    const isActive = activeHistoryId === historyFile.id;
                    const detection = detectFramework(historyFile.name);
                    return (
                      <div
                        key={historyFile.id}
                        onClick={() => handleHistoryFileClick(historyFile)}
                        className={`group flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-[#2a2d2e] ${
                          isActive ? 'bg-[#37373d] text-white' : 'text-gray-300'
                        }`}
                      >
                        <span className="flex-shrink-0">{getFrameworkLogo(detection?.adapter.type)}</span>
                        <span className="truncate flex-1" title={historyFile.name}>{historyFile.name}</span>
                        <button
                          onClick={(e) => handleDeleteHistoryFile(historyFile.id, e)}
                          className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-opacity"
                          title="删除"
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
          {/* 右侧编辑器 */}
          <div className="flex-1 flex flex-col">
            <div className="flex items-center px-3 py-1.5 bg-[#2d2d2d] border-b border-[#3c3c3c]">
              <span className="text-sm text-gray-300">{selectedFile?.name}</span>
              {frameworkName && (
                <span className="ml-2 px-2 py-0.5 text-xs bg-blue-600 text-white rounded">
                  {frameworkName}
                </span>
              )}
            </div>
            <Editor
              height={`${editorHeight}px`}
              language={selectedFile ? getEditorLanguage(selectedFile.name) : 'javascript'}
              theme="vs-dark"
              value={codeContent}
              onChange={handleCodeChange}
              beforeMount={(monaco) => {
                // 禁用所有代码校验
                monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
                  noSemanticValidation: true,
                  noSyntaxValidation: true,
                });
                monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
                  noSemanticValidation: true,
                  noSyntaxValidation: true,
                });
              }}
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                automaticLayout: true,
                tabSize: 2,
                // 启用搜索功能
                find: {
                  addExtraSpaceOnTop: false,
                  autoFindInSelection: 'never',
                  seedSearchStringFromSelection: 'selection',
                },
              }}
              onMount={(editor) => {
                // 确保 Ctrl+F/Cmd+F 触发搜索而非浏览器默认行为
                editor.addCommand(
                  // Monaco.KeyMod.CtrlCmd | Monaco.KeyCode.KeyF
                  2048 | 36,
                  () => {
                    editor.getAction('actions.find')?.run();
                  }
                );
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default ComponentPreview;
