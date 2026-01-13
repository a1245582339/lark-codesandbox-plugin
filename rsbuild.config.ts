import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { pluginBasicSsl } from '@rsbuild/plugin-basic-ssl';
import { codeInspectorPlugin } from 'code-inspector-plugin';

// Docs: https://rsbuild.rs/config/
export default defineConfig({
  plugins: [pluginReact(), pluginBasicSsl()],
  source: {
    entry: {
      index: './src/index.tsx',
      preview: './src/preview/main.tsx',
    },
  },
  dev: {
    assetPrefix: './',
  },
  server: {
    host: '0.0.0.0',
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  },
  output: {
    assetPrefix: './',
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
