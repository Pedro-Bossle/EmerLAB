import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      // `_nome` = descartado de propósito (desestruturação, parâmetros posicionais).
      'no-unused-vars': [
        'error',
        { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // Regras do React Compiler (eslint-plugin-react-hooks 7): apontam padrões de desempenho,
      // não erros de execução. Ficam como aviso até cada tela ser revista (relatório F-05).
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      // Só afeta o hot reload em desenvolvimento.
      'react-refresh/only-export-components': 'warn',
    },
  },
  {
    files: ['api/**/*.js', 'scripts/**/*.mjs', 'vite.config.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // Código que só roda no Node (APIs da Vercel / scripts). O caminho do navegador retorna
    // antes do import() dinâmico destes módulos.
    files: [
      'src/lib/api/**/*.{js,jsx}',
      'src/lib/clicksign/clicksignProxyHandler.js',
      'src/lib/credenciamento/geminiDescanso.js',
      'src/lib/credenciamento/nominatimUpstream.js',
      'src/lib/credenciamento/overpassUpstream.js',
      'src/lib/credenciamento/prospectosColeta.js',
    ],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
])
