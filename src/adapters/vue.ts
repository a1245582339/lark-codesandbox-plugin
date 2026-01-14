import type { FileSystemTree } from '@webcontainer/api';
import type { FrameworkAdapter } from './types';

export const vueAdapter: FrameworkAdapter = {
  name: 'Vue 3',
  type: 'vue',
  extensions: ['.vue'],
  baseDeps: ['vue', 'tailwindcss', 'postcss', 'autoprefixer'],
  defaultDeps: ['vue', 'tailwindcss'],

  createFiles(code: string, fileName: string, extraDeps: string[]): FileSystemTree {
    const componentName = fileName.replace(/\.vue$/, '');

    const dependencies: Record<string, string> = {
      vue: '^3.4.0',
    };

    extraDeps.forEach((dep) => {
      dependencies[dep] = 'latest';
    });

    const devDependencies: Record<string, string> = {
      '@rsbuild/core': '^1.0.0',
      '@rsbuild/plugin-vue': '^1.0.0',
      '@rspack/binding-wasm32-wasi': '^1.0.0',
      tailwindcss: '^3.4.0',
      postcss: '^8.4.0',
      autoprefixer: '^10.4.0',
    };

    const packageJson = {
      name: 'vue-preview',
      type: 'module',
      scripts: {
        dev: 'rsbuild dev',
        build: 'rsbuild build',
        preview: 'rsbuild preview',
      },
      dependencies,
      devDependencies,
    };

    const rsbuildConfig = `import { defineConfig } from '@rsbuild/core';
import { pluginVue } from '@rsbuild/plugin-vue';

export default defineConfig({
  plugins: [pluginVue()],
});`;

    const tailwindConfig = `/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{js,ts,vue}'],
  theme: {
    extend: {},
  },
  plugins: [],
};`;

    const postcssConfig = `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};`;

    const indexCss = `@tailwind base;
@tailwind components;
@tailwind utilities;`;

    const mainFile = `import { createApp } from 'vue';
import './index.css';
import ${componentName} from './${fileName}';

createApp(${componentName}).mount('#root');`;

    const npmrc = `store-dir=.local/share/pnpm/store`;

    return {
      'package.json': { file: { contents: JSON.stringify(packageJson, null, 2) } },
      '.npmrc': { file: { contents: npmrc } },
      'rsbuild.config.mjs': { file: { contents: rsbuildConfig } },
      'tailwind.config.js': { file: { contents: tailwindConfig } },
      'postcss.config.mjs': { file: { contents: postcssConfig } },
      src: {
        directory: {
          'index.js': { file: { contents: mainFile } },
          'index.css': { file: { contents: indexCss } },
          [fileName]: { file: { contents: code } },
        },
      },
    } as FileSystemTree;
  },

  getEditorLanguage(_fileName: string): string {
    return 'html'; // Vue SFC 在 Monaco 中使用 html 语言
  },
};
