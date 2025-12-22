/** @type {import('eslint').Linter.Config} */
module.exports = {
  extends: ['./base.cjs', 'plugin:astro/recommended'],
  overrides: [
    {
      files: ['*.astro'],
      parser: 'astro-eslint-parser',
      parserOptions: {
        parser: '@typescript-eslint/parser',
        extraFileExtensions: ['.astro'],
      },
      rules: {
        // Astro-specific rules can be added here
      },
    },
  ],
};
