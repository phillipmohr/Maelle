// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(
  // Global ignores (an object with only `ignores` applies to everything).
  { ignores: ['shared/types/database.ts', 'supabase/**', '.claude/**', 'docs/**', '.data/**'] },
  {
    rules: {
      // Multi-word component names are not helpful for a design system (Button, Panel, Mono).
      'vue/multi-word-component-names': 'off',
      // Optional props typed with TypeScript default to undefined on purpose.
      'vue/require-default-prop': 'off',
      // Prettier writes `<input />`; keep eslint and prettier agreeing.
      'vue/html-self-closing': [
        'warn',
        { html: { void: 'always', normal: 'always', component: 'always' } },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
)
