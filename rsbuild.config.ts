import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { codeInspectorPlugin } from 'code-inspector-plugin';

// Docs: https://rsbuild.rs/config/
export default defineConfig({
  plugins: [pluginReact()],
  source: {
    entry: {
      index: './src/index.tsx',
      preview: './src/preview/main.tsx',
    },
  },
  server: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  },
  html: {
    title: 'React 组件预览 - 飞书多维表格插件',
    tags: [
      {
        tag: 'script',
        attrs: { src: '/coi-serviceworker.js' },
        head: true,
        append: false,
      },
    ],
    template({ entryName }) {
      if (entryName === 'preview') {
        return './src/preview/index.html';
      }
      return './src/index.html';
    },
  },
  tools: {
    rspack: {
      plugins: [
        codeInspectorPlugin({
          bundler: 'rspack',
          ip: true,
          hideDomPathAttr: true,
        }),
        
      ],
    },
  },
});
