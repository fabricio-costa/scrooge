import tseslint from 'typescript-eslint';

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['test/*.test.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    ignores: ['dist/', 'node_modules/', '*.js', '!eslint.config.js'],
  },
);
