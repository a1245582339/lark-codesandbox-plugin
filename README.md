# 飞书多维表格 React 组件预览插件

这是一个飞书多维表格侧边栏插件，可以将附件字段中的 JSX/TSX 文件渲染为 React 页面。

## 功能特性

- 监听用户选择的附件字段
- 自动识别 `.jsx` 和 `.tsx` 文件
- 使用 WebContainers 在浏览器中运行 Node.js 环境
- 自动安装 React 依赖并启动开发服务器
- 实时预览 React 组件

## 技术栈

- React 18
- TypeScript
- Rsbuild (构建工具)
- @lark-base-open/js-sdk (飞书多维表格 SDK)
- @webcontainer/api (浏览器内 Node.js 运行时)
- Tailwind CSS

## 开发

安装依赖：

```bash
pnpm install
```

启动开发服务器：

```bash
pnpm run dev
```

构建生产版本：

```bash
pnpm run build
```

## 使用说明

1. 在飞书多维表格中安装此插件
2. 创建一个附件字段
3. 上传 `.jsx` 或 `.tsx` 文件到附件字段
4. 选中该附件单元格
5. 插件侧边栏会自动：
   - 下载附件内容
   - 启动 WebContainer
   - 安装必要的 npm 依赖
   - 运行 `npm run dev`
   - 显示 React 组件预览

## 示例组件

上传的 JSX/TSX 文件应该是一个默认导出的 React 组件，例如：

```tsx
// MyComponent.tsx
import React, { useState } from 'react';

export default function MyComponent() {
  const [count, setCount] = useState(0);

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>Hello from React!</h1>
      <p>Count: {count}</p>
      <button onClick={() => setCount(c => c + 1)}>
        Increment
      </button>
    </div>
  );
}
```

## 注意事项

- WebContainers 需要浏览器支持 SharedArrayBuffer，需要特定的 HTTP headers
- 首次加载可能需要一些时间来下载和安装依赖
- 组件文件应该默认导出一个 React 组件

## 项目结构

```
src/
├── App.tsx              # 主应用组件
├── App.css              # 样式文件
├── index.tsx            # 应用入口
├── components/
│   └── ReactPreview.tsx # 预览组件
└── services/
    ├── bitable.ts       # 飞书 SDK 服务
    └── webcontainer.ts  # WebContainers 服务
```
