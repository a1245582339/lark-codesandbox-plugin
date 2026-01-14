# 前端组件预览工具

一个支持 React、Vue 3、Svelte 的前端组件在线预览工具，可作为飞书多维表格插件使用，也可独立部署使用。

## 功能特性

- **多框架支持**：React (.jsx/.tsx)、Vue 3 (.vue)、Svelte (.svelte)
- **在线预览**：使用 WebContainers 在浏览器中运行完整的 Node.js 环境
- **代码编辑**：内置 Monaco Editor，支持实时编辑和语法高亮
- **自动依赖安装**：自动识别代码中的 import 语句并安装第三方依赖
- **Tailwind CSS**：默认集成 Tailwind CSS 支持
- **项目下载**：一键打包下载完整项目，可本地继续开发
- **URL 分享**：支持通过 URL 分享预览页面给他人

### 独立模式特性

- 文件历史记录：自动缓存上传过的文件，方便切换查看
- 默认示例：首次访问自动加载示例文件

### 飞书多维表格模式

- 监听用户选择的附件字段
- 自动识别并预览支持的组件文件

## 技术栈

- React 18
- TypeScript
- Rsbuild (构建工具)
- @lark-base-open/js-sdk (飞书多维表格 SDK)
- @webcontainer/api (浏览器内 Node.js 运行时)
- Monaco Editor (代码编辑器)
- Tailwind CSS
- JSZip (项目打包下载)

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

### 独立模式

1. 访问部署后的页面
2. 上传 `.jsx`、`.tsx`、`.vue` 或 `.svelte` 文件
3. 在编辑器中查看和修改代码
4. 点击「在新窗口预览」运行组件
5. 可选择「下载项目」获取完整可运行的项目

### 飞书多维表格模式

1. 在飞书多维表格中安装此插件
2. 创建一个附件字段
3. 上传组件文件到附件字段
4. 选中该附件单元格
5. 插件侧边栏会自动显示代码内容
6. 点击「在新窗口预览」查看渲染效果

## 示例组件

### React (.tsx)

```tsx
import { useState } from 'react';

export default function Counter() {
  const [count, setCount] = useState(0);

  return (
    <div className="p-8 text-center">
      <h1 className="text-2xl font-bold mb-4">React Counter</h1>
      <p className="text-4xl mb-4">{count}</p>
      <button
        onClick={() => setCount(c => c + 1)}
        className="px-4 py-2 bg-blue-500 text-white rounded"
      >
        +1
      </button>
    </div>
  );
}
```

### Vue 3 (.vue)

```vue
<template>
  <div class="p-8 text-center">
    <h1 class="text-2xl font-bold mb-4">Vue Counter</h1>
    <p class="text-4xl mb-4">{{ count }}</p>
    <button
      @click="count++"
      class="px-4 py-2 bg-green-500 text-white rounded"
    >
      +1
    </button>
  </div>
</template>

<script setup>
import { ref } from 'vue';
const count = ref(0);
</script>
```

### Svelte (.svelte)

```svelte
<script>
  let count = 0;
</script>

<div class="p-8 text-center">
  <h1 class="text-2xl font-bold mb-4">Svelte Counter</h1>
  <p class="text-4xl mb-4">{count}</p>
  <button
    on:click={() => count++}
    class="px-4 py-2 bg-orange-500 text-white rounded"
  >
    +1
  </button>
</div>
```

## 注意事项

- WebContainers 需要浏览器支持 SharedArrayBuffer
- 需要配置正确的 HTTP headers (COOP/COEP)
- 首次加载需要等待环境初始化（约 30 秒 - 1 分钟）
- 目前仅支持单文件组件，不支持文件间引用
- 组件文件应该默认导出组件

## 项目结构

```
src/
├── App.tsx                    # 主应用组件
├── App.css                    # 样式文件
├── index.tsx                  # 应用入口
├── adapters/                  # 框架适配器
│   ├── index.ts               # 适配器入口
│   ├── types.ts               # 类型定义
│   ├── react.ts               # React 适配器
│   ├── vue.ts                 # Vue 适配器
│   └── svelte.ts              # Svelte 适配器
├── components/
│   └── ComponentPreview.tsx   # 组件预览主界面
├── preview/
│   ├── main.tsx               # 预览窗口入口
│   ├── PreviewApp.tsx         # 预览应用组件
│   └── pnpmCache.ts           # pnpm 缓存管理
└── services/
    └── bitable.ts             # 飞书 SDK 服务
public/
└── example/                   # 示例文件
    ├── 生死簿后台管理系统.tsx.template
    ├── tinder.vue.template
    └── 死了么.svelte.template
```

## License

MIT
