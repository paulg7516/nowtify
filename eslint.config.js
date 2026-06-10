/**
 * ESLint flat-config for Nowtify.
 *
 * Rules chosen to catch the exact bug classes that have hit production:
 *  - no-undef: caught by static analysis ("watchList is not defined" bug,
 *    v0.4.5 regression that wiped every engine tick silently).
 *  - no-unused-vars: surfaces dead refs left behind after refactors so they
 *    get cleaned up instead of rotting in the codebase.
 *  - no-redeclare: prevents accidental shadowing across IIFE-ish renderer
 *    files.
 *  - prefer-const: encourages immutability so a variable's lifetime is
 *    obvious from its declaration.
 *
 * Two environments:
 *  - main + preload: Node + Electron (require, process, Buffer, etc.)
 *  - renderer: browser-side (window, document, fetch, etc.) + the API
 *    bridge exposed via contextBridge (e.g. window.settingsApi).
 */

module.exports = [
  {
    // Main-process and preload scripts (Node + Electron)
    files: ['src/main/**/*.js', 'src/preload/**/*.js', 'scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        // Node
        require: 'readonly',
        module: 'readonly',
        exports: 'writable',
        __dirname: 'readonly',
        __filename: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        console: 'readonly',
        setInterval: 'readonly',
        setTimeout: 'readonly',
        clearInterval: 'readonly',
        clearTimeout: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        fetch: 'readonly',
        Notification: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-redeclare': 'error',
      'prefer-const': 'warn',
      'no-var': 'warn',
      'no-shadow-restricted-names': 'error',
    },
  },
  {
    // Renderer scripts (browser environment)
    files: ['src/renderer/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        console: 'readonly',
        setInterval: 'readonly',
        setTimeout: 'readonly',
        clearInterval: 'readonly',
        clearTimeout: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-redeclare': 'error',
      'prefer-const': 'warn',
      'no-var': 'warn',
    },
  },
  {
    // Test files
    files: ['test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'readonly',
        exports: 'writable',
        __dirname: 'readonly',
        process: 'readonly',
        console: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': 'warn',
    },
  },
  {
    ignores: ['node_modules/', 'dist/', 'build/icon-source.svg'],
  },
];
