module.exports = [
  {
    ignores: [
      "node_modules/**",
      "server/**",
      "runtime/**",
      "dist/**",
      "*.min.js",
      "*.bundle.js",
    ],
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "no-unused-vars": [
        "warn",
        { args: "none", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "no-console": "off",
      quotes: ["warn", "double"],
      semi: ["warn", "always"],
      "comma-dangle": ["warn", "never"],
    },
  },
];
