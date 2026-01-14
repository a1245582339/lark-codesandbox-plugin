import type { FileSystemTree } from '@webcontainer/api';

// 支持的框架类型
export type FrameworkType = 'react' | 'vue' | 'svelte';

// 框架适配器接口
export interface FrameworkAdapter {
  // 框架名称
  name: string;
  // 框架类型
  type: FrameworkType;
  // 支持的文件后缀
  extensions: string[];
  // 基础依赖（不需要从代码中检测）
  baseDeps: string[];
  // 默认显示的依赖
  defaultDeps: string[];
  // 生成项目文件
  createFiles(code: string, fileName: string, extraDeps: string[]): FileSystemTree;
  // 获取 Monaco 编辑器语言
  getEditorLanguage(fileName: string): string;
}

// 创建文件的结果
export interface CreateFilesResult {
  files: FileSystemTree;
}

// 框架检测结果
export interface FrameworkDetectionResult {
  type: FrameworkType;
  adapter: FrameworkAdapter;
}
