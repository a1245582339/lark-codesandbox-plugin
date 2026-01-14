import type { FileSystemTree } from '@webcontainer/api';
import type { FrameworkAdapter } from './types';

export const reactAdapter: FrameworkAdapter = {
  name: 'React',
  type: 'react',
  extensions: ['.jsx', '.tsx'],
  baseDeps: ['react', 'react-dom', 'react/jsx-runtime', 'tailwindcss', 'postcss', 'autoprefixer'],
  defaultDeps: ['react', 'react-dom', 'tailwindcss'],

  createFiles(code: string, fileName: string, extraDeps: string[]): FileSystemTree {
    const isTypeScript = fileName.endsWith('.tsx');
    const componentName = fileName.replace(/\.(jsx|tsx)$/, '');

    const dependencies: Record<string, string> = {
      react: '^18.2.0',
      'react-dom': '^18.2.0',
    };

    extraDeps.forEach((dep) => {
      dependencies[dep] = 'latest';
    });

    const devDependencies: Record<string, string> = {
      '@rsbuild/core': '^1.0.0',
      '@rsbuild/plugin-react': '^1.0.0',
      '@rspack/binding-wasm32-wasi': '^1.0.0',
      tailwindcss: '^3.4.0',
      postcss: '^8.4.0',
      autoprefixer: '^10.4.0',
      ...(isTypeScript
        ? {
            typescript: '^5.3.0',
            '@types/react': '^18.2.0',
            '@types/react-dom': '^18.2.0',
          }
        : {}),
    };

    const packageJson = {
      name: 'react-preview',
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
import { pluginReact } from '@rsbuild/plugin-react';

export default defineConfig({
  plugins: [pluginReact()],
});`;

    const tailwindConfig = `/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
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

    const mainFile = `import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import ${componentName} from './${fileName}';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <${componentName} />
  </React.StrictMode>
);`;

    const npmrc = `store-dir=.local/share/pnpm/store`;

    return {
      'package.json': { file: { contents: JSON.stringify(packageJson, null, 2) } },
      '.npmrc': { file: { contents: npmrc } },
      'rsbuild.config.mjs': { file: { contents: rsbuildConfig } },
      'tailwind.config.js': { file: { contents: tailwindConfig } },
      'postcss.config.mjs': { file: { contents: postcssConfig } },
      src: {
        directory: {
          'index.tsx': { file: { contents: mainFile } },
          'index.css': { file: { contents: indexCss } },
          [fileName]: { file: { contents: code } },
        },
      },
    } as FileSystemTree;
  },

  getEditorLanguage(fileName: string): string {
    return fileName.endsWith('.tsx') ? 'typescript' : 'javascript';
  },
};
