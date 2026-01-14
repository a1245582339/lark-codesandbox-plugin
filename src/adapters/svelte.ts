import type { FileSystemTree } from '@webcontainer/api';
import type { FrameworkAdapter } from './types';

export const svelteAdapter: FrameworkAdapter = {
  name: 'Svelte',
  type: 'svelte',
  extensions: ['.svelte'],
  baseDeps: ['svelte', 'tailwindcss', 'postcss', 'autoprefixer'],
  defaultDeps: ['svelte', 'tailwindcss'],

  createFiles(code: string, fileName: string, extraDeps: string[]): FileSystemTree {
    const componentName = fileName.replace(/\.svelte$/, '');

    const dependencies: Record<string, string> = {};

    extraDeps.forEach((dep) => {
      dependencies[dep] = 'latest';
    });

    // Svelte 使用 Rsbuild + @rsbuild/plugin-svelte
    const devDependencies: Record<string, string> = {
      '@rsbuild/core': '^1.0.0',
      '@rsbuild/plugin-svelte': '^1.0.0',
      '@rspack/binding-wasm32-wasi': '^1.0.0',
      svelte: '^4.2.0',
      tailwindcss: '^3.4.0',
      postcss: '^8.4.0',
      autoprefixer: '^10.4.0',
    };

    const packageJson = {
      name: 'svelte-preview',
      type: 'module',
      scripts: {
        dev: 'rsbuild dev',
        build: 'rsbuild build',
        preview: 'rsbuild preview',
      },
      dependencies: Object.keys(dependencies).length > 0 ? dependencies : undefined,
      devDependencies,
    };

    // 清理 undefined 字段
    if (!packageJson.dependencies) {
      delete packageJson.dependencies;
    }

    const rsbuildConfig = `import { defineConfig } from '@rsbuild/core';
import { pluginSvelte } from '@rsbuild/plugin-svelte';

export default defineConfig({
  plugins: [pluginSvelte()],
});`;

    const tailwindConfig = `/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,js,svelte}'],
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

    const mainFile = `import './index.css';
import ${componentName} from './${fileName}';

const app = new ${componentName}({
  target: document.getElementById('root'),
});

export default app;`;

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
    return 'html'; // Svelte 在 Monaco 中使用 html 语言
  },
};
