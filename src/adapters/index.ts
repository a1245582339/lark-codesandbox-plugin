import type { FrameworkAdapter, FrameworkType, FrameworkDetectionResult } from './types';
import { reactAdapter } from './react';
import { vueAdapter } from './vue';
import { svelteAdapter } from './svelte';

export type { FrameworkAdapter, FrameworkType, FrameworkDetectionResult } from './types';

// 所有适配器
const adapters: FrameworkAdapter[] = [reactAdapter, vueAdapter, svelteAdapter];

// 支持的所有文件后缀
export const SUPPORTED_EXTENSIONS = adapters.flatMap((a) => a.extensions);

/**
 * 根据文件名检测框架类型
 */
export function detectFramework(fileName: string): FrameworkDetectionResult | null {
  const lowerName = fileName.toLowerCase();

  for (const adapter of adapters) {
    if (adapter.extensions.some((ext) => lowerName.endsWith(ext))) {
      return {
        type: adapter.type,
        adapter,
      };
    }
  }

  return null;
}

/**
 * 根据框架类型获取适配器
 */
export function getAdapter(type: FrameworkType): FrameworkAdapter {
  const adapter = adapters.find((a) => a.type === type);
  if (!adapter) {
    throw new Error(`Unknown framework type: ${type}`);
  }
  return adapter;
}

/**
 * 获取所有适配器
 */
export function getAllAdapters(): FrameworkAdapter[] {
  return adapters;
}

/**
 * 检查文件名是否是支持的组件文件
 */
export function isSupportedFile(fileName: string): boolean {
  const lowerName = fileName.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
}

/**
 * 从导入路径中提取包名
 */
function extractPackageName(importPath: string): string | null {
  // 跳过相对路径
  if (importPath.startsWith('.') || importPath.startsWith('/')) {
    return null;
  }

  // @scope/package 格式
  if (importPath.startsWith('@')) {
    const parts = importPath.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  }

  // package 或 package/sub/path 格式
  return importPath.split('/')[0];
}

/**
 * 分析代码中的依赖
 */
export function analyzeDependencies(code: string, baseDeps: string[]): string[] {
  const deps = new Set<string>();

  // 更健壮的 import 匹配：匹配 from 'xxx' 或 from "xxx" 部分
  // 支持: import x from 'pkg'
  //       import { x } from 'pkg'
  //       import * as x from 'pkg'
  //       import 'pkg'
  //       import type { x } from 'pkg'
  const importFromRegex = /\bfrom\s+['"]([^'"]+)['"]/g;
  const importDirectRegex = /\bimport\s+['"]([^'"]+)['"]/g;

  let match;

  // 匹配 from 'package' 形式
  while ((match = importFromRegex.exec(code)) !== null) {
    const pkg = extractPackageName(match[1]);
    if (pkg) deps.add(pkg);
  }

  // 匹配 import 'package' 形式（副作用导入）
  while ((match = importDirectRegex.exec(code)) !== null) {
    const pkg = extractPackageName(match[1]);
    if (pkg) deps.add(pkg);
  }

  // 匹配 require('package')
  const requireRegex = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = requireRegex.exec(code)) !== null) {
    const pkg = extractPackageName(match[1]);
    if (pkg) deps.add(pkg);
  }

  return Array.from(deps).filter((dep) => !baseDeps.includes(dep));
}
