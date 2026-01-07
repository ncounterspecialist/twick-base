import resolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import postcss from 'rollup-plugin-postcss';

export default [
  {
    input: './src/editor/index.ts',
    output: {
      format: 'es',
      sourcemap: true,
      dir: './editor',
    },
    external: [/^@twick/, /^@?preact/, './index.css'],
    plugins: [
      typescript({
        tsconfig: './src/editor/tsconfig.json',
        compilerOptions: {
          outDir: './editor',
          composite: false,
          jsx: 'react-jsx',
        },
        include: ['src/editor/**/*.ts', 'src/editor/**/*.tsx'],
      }),
      resolve({
        extensions: ['.ts', '.tsx', '.js', '.jsx'],
      }),
      postcss({
        modules: true,
        extract: true,
      }),
    ],
  },
];
