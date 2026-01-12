import { useState, useEffect } from 'react';
import './App.css';
import ReactPreview from './components/ReactPreview';
import {
  initBitable,
  onFieldSelectionChange,
  type AttachmentFile,
} from './services/bitable';

const App = () => {
  const [files, setFiles] = useState<AttachmentFile[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const init = async () => {
      try {
        await initBitable();
        setInitialized(true);

        onFieldSelectionChange((attachmentFiles) => {
          console.log('[App] Received files:', attachmentFiles.map(f => f.name));
          setFiles(attachmentFiles);
        });
      } catch (err) {
        console.error('Failed to initialize Bitable SDK:', err);
        setError(
          err instanceof Error ? err.message : '初始化失败，请确保在飞书多维表格中运行'
        );
      }
    };

    init();
  }, []);

  if (error) {
    return (
      <div className="flex flex-col min-h-screen p-4 bg-gray-100 font-sans">
        <div className="flex flex-col items-center justify-center min-h-[300px] text-center gap-2">
          <div className="text-5xl">⚠️</div>
          <h3 className="text-lg font-semibold text-gray-800">初始化失败</h3>
          <p className="text-sm text-gray-500 max-w-[300px]">{error}</p>
        </div>
      </div>
    );
  }

  if (!initialized) {
    return (
      <div className="flex flex-col min-h-screen p-4 bg-gray-100 font-sans">
        <div className="flex flex-col items-center justify-center min-h-[300px] gap-4">
          <div className="w-8 h-8 border-3 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
          <p className="text-sm text-gray-500">正在初始化...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen p-4 bg-gray-100 font-sans">
      <header className="mb-4">
        <p className="text-sm text-gray-500">选择附件字段中的 JSX/TSX 文件进行实时预览</p>
      </header>

      <main className="flex-1 flex flex-col">
        <ReactPreview files={files} />
      </main>
    </div>
  );
};

export default App;
