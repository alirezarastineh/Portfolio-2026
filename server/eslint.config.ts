import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import json from "@eslint/json";
import markdown from "@eslint/markdown";
import sonarjs from "eslint-plugin-sonarjs";
import unicorn from "eslint-plugin-unicorn";
import { defineConfig, globalIgnores } from "eslint/config";
import type { ESLint, Linter, Rule } from "eslint";

const jsFiles = ["**/*.{js,mjs,cjs,ts,mts,cts}"];
const tsFiles = ["**/*.{ts,mts,cts}"];

const sonarUnicornRules: Linter.RulesRecord = {
  "unicorn/catch-error-name": "error",
  "unicorn/consistent-date-clone": "error",
  "unicorn/consistent-empty-array-spread": "error",
  "unicorn/consistent-function-scoping": "error",
  "unicorn/dom-node-dataset": "error",
  "unicorn/error-message": "error",
  "unicorn/new-for-builtins": "error",
  "unicorn/no-abusive-eslint-disable": "error",
  "unicorn/no-accessor-recursion": "error",
  "unicorn/no-anonymous-default-export": "error",
  "unicorn/no-array-callback-reference": "error",
  "unicorn/no-array-method-this-argument": "error",
  "unicorn/no-await-expression-member": "error",
  "unicorn/no-for-loop": "error",
  "unicorn/no-instanceof-builtins": "error",
  "unicorn/no-invalid-fetch-options": "error",
  "unicorn/no-lonely-if": "error",
  "unicorn/no-named-default": "error",
  "unicorn/no-negated-condition": "error",
  "unicorn/no-negation-in-equality-check": "error",
  "unicorn/no-object-as-default-parameter": "error",
  "unicorn/no-single-promise-in-promise-methods": "error",
  "unicorn/no-thenable": "error",
  "unicorn/no-this-assignment": "error",
  "unicorn/no-typeof-undefined": "error",
  "unicorn/no-unnecessary-polyfills": "error",
  "unicorn/no-unreadable-iife": "error",
  "unicorn/no-useless-fallback-in-spread": "error",
  "unicorn/no-useless-length-check": "error",
  "unicorn/no-useless-promise-resolve-reject": "error",
  "unicorn/no-useless-spread": "error",
  "unicorn/no-zero-fractions": "error",
  "unicorn/numeric-separators-style": "error",
  "unicorn/prefer-array-find": "error",
  "unicorn/prefer-array-flat": "error",
  "unicorn/prefer-array-flat-map": "error",
  "unicorn/prefer-array-index-of": "error",
  "unicorn/prefer-array-some": "error",
  "unicorn/prefer-at": "error",
  "unicorn/prefer-blob-reading-methods": "error",
  "unicorn/prefer-class-fields": "error",
  "unicorn/prefer-code-point": "error",
  "unicorn/prefer-date-now": "error",
  "unicorn/prefer-default-parameters": "error",
  "unicorn/prefer-dom-node-remove": "error",
  "unicorn/prefer-export-from": "error",
  "unicorn/prefer-global-this": "error",
  "unicorn/prefer-includes": "error",
  "unicorn/prefer-math-min-max": "error",
  "unicorn/prefer-math-trunc": "error",
  "unicorn/prefer-modern-dom-apis": "error",
  "unicorn/prefer-modern-math-apis": "error",
  "unicorn/prefer-native-coercion-functions": "error",
  "unicorn/prefer-negative-index": "error",
  "unicorn/prefer-node-protocol": "error",
  "unicorn/prefer-number-properties": "error",
  "unicorn/prefer-prototype-methods": "error",
  "unicorn/prefer-regexp-test": "error",
  "unicorn/prefer-set-has": "error",
  "unicorn/prefer-set-size": "error",
  "unicorn/prefer-single-call": "error",
  "unicorn/prefer-string-raw": "error",
  "unicorn/prefer-string-replace-all": "error",
  "unicorn/prefer-string-starts-ends-with": "error",
  "unicorn/prefer-string-trim-start-end": "error",
  "unicorn/prefer-structured-clone": "error",
  "unicorn/prefer-type-error": "error",
  "unicorn/require-module-specifiers": "error",
};

const sonarCoreRules: Linter.RulesRecord = {
  "accessor-pairs": "error",
  curly: "error",
  "default-case-last": "error",
  eqeqeq: "error",
  "new-cap": ["error", { newIsCap: true, capIsNew: false, properties: false }],
  "no-alert": "error",
  "no-await-in-loop": "error",
  "no-caller": "error",
  "no-constructor-return": "error",
  "no-eval": "error",
  "no-extend-native": "error",
  "no-extra-bind": "error",
  "no-lone-blocks": "error",
  "no-lonely-if": "error",
  "no-multi-str": "error",
  "no-new-func": "error",
  "no-octal-escape": "error",
  "no-promise-executor-return": "error",
  "no-proto": "error",
  "no-self-compare": "error",
  "no-sequences": "error",
  "no-template-curly-in-string": "error",
  "no-throw-literal": "error",
  "no-undef-init": "error",
  "no-unmodified-loop-condition": "error",
  "no-unneeded-ternary": "error",
  "no-unreachable-loop": "error",
  "no-unsafe-finally": "error",
  "no-unused-private-class-members": "error",
  "no-useless-call": "error",
  "no-useless-concat": "error",
  "no-useless-rename": "error",
  "object-shorthand": "error",
  "prefer-object-has-own": "error",
  "prefer-object-spread": "error",
  "prefer-regex-literals": "error",
  "prefer-spread": "error",
  "prefer-template": "error",
  radix: "error",
};

interface TsTypeLike {
  getNonNullableType(): TsTypeLike;
  getProperty(name: string): unknown;
  getCallSignatures(): TsSignatureLike[];
  isUnion?: () => boolean;
  types?: TsTypeLike[];
}

interface TsSignatureLike {
  parameters: unknown[];
}

interface TsTypeCheckerLike {
  isArrayType(type: TsTypeLike): boolean;
  isTupleType(type: TsTypeLike): boolean;
  isTypeAssignableTo(source: TsTypeLike, target: TsTypeLike): boolean;
  getTypeAtLocation(node: unknown): TsTypeLike;
  getTypeOfSymbolAtLocation(symbol: unknown, node: unknown): TsTypeLike;
}

interface TsParserServicesLike {
  program?: { getTypeChecker(): TsTypeCheckerLike } | null;
  esTreeNodeToTSNodeMap?: { get(node: unknown): unknown } | null;
}

const isArrayOrTupleType = (type: TsTypeLike, checker: TsTypeCheckerLike): boolean => {
  if (checker.isArrayType(type) || checker.isTupleType(type)) {
    return true;
  }
  if (type.isUnion?.() && type.types && type.types.length > 0) {
    return type.types.every((member) => isArrayOrTupleType(member, checker));
  }
  return false;
};

const extractReturnExpression = (fn: Rule.Node) => {
  if (
    (fn.type !== "ArrowFunctionExpression" && fn.type !== "FunctionExpression") ||
    fn.async ||
    fn.generator ||
    fn.params.length !== 1
  ) {
    return null;
  }
  const param = fn.params[0];
  if (param.type !== "Identifier") {
    return null;
  }
  if (fn.body.type !== "BlockStatement") {
    return { fn, param, expr: fn.body };
  }
  const stmt = fn.body.body[0];
  if (fn.body.body.length !== 1 || stmt?.type !== "ReturnStatement" || !stmt.argument) {
    return null;
  }
  return { fn, param, expr: stmt.argument };
};

const isStaticNaN = (node: Rule.Node): boolean => node.type === "Identifier" && node.name === "NaN";

const matchParamEquality = (
  extracted: NonNullable<ReturnType<typeof extractReturnExpression>>,
  context: Rule.RuleContext,
) => {
  const { fn, param, expr } = extracted;
  if (expr.type !== "BinaryExpression" || expr.operator !== "===") {
    return null;
  }
  let paramIdent: typeof param | null = null;
  let searchExpr: Rule.Node | null = null;
  if (expr.left.type === "Identifier" && expr.left.name === param.name) {
    paramIdent = expr.left;
    searchExpr = expr.right as Rule.Node;
  } else if (expr.right.type === "Identifier" && expr.right.name === param.name) {
    paramIdent = expr.right;
    searchExpr = expr.left as Rule.Node;
  }
  if (!paramIdent || !searchExpr || isStaticNaN(searchExpr)) {
    return null;
  }
  const scope = context.sourceCode.getScope(fn);
  const paramVar = scope.variables.find((variable) => variable.name === param.name);
  const hasExtraParamRef = paramVar?.references.some(
    (ref) => ref.identifier !== paramIdent && ref.identifier !== param,
  );
  if (!paramVar || hasExtraParamRef) {
    return null;
  }
  if (
    fn.type === "FunctionExpression" &&
    (context.sourceCode
      .getTokens(fn)
      .some((token) => token.type === "Keyword" && token.value === "this") ||
      scope.through.some((ref) => ref.identifier.name === "arguments"))
  ) {
    return null;
  }
  return searchExpr;
};

const isSkippedByUnicornIncludes = (
  callNode: Rule.Node,
  receiverNode: Rule.Node,
  searchExpr: Rule.Node,
  context: Rule.RuleContext,
): boolean => {
  const services = context.sourceCode.parserServices as TsParserServicesLike | undefined;
  if (!services?.program || !services.esTreeNodeToTSNodeMap) {
    return false;
  }
  const checker = services.program.getTypeChecker();
  const receiverType = checker
    .getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(receiverNode))
    .getNonNullableType();
  if (!isArrayOrTupleType(receiverType, checker)) {
    return false;
  }
  const includesSymbol = receiverType.getProperty("includes");
  if (!includesSymbol) {
    return true;
  }
  const tsCall = services.esTreeNodeToTSNodeMap.get(callNode);
  const paramSymbol = checker
    .getTypeOfSymbolAtLocation(includesSymbol, tsCall)
    .getCallSignatures()
    .at(0)
    ?.parameters.at(0);
  if (!paramSymbol) {
    return true;
  }
  const searchType = checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(searchExpr));
  const paramType = checker.getTypeOfSymbolAtLocation(paramSymbol, tsCall);
  return !checker.isTypeAssignableTo(searchType, paramType);
};

// unicorn/prefer-includes skips `.some(x => x === value)` when `value`'s type is wider than the array's element type (SonarQube S7765 still flags it).
const preferIncludesOverSomeRule: Rule.RuleModule = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Require .includes() instead of .some() for existence checks (Sonar S7765).",
    },
    schema: [],
    messages: {
      preferIncludes:
        "Use `.includes()` instead of `.some()` when checking value existence (sonarqube typescript:S7765).",
    },
  },
  create(context) {
    return {
      CallExpression(callNode) {
        if (
          callNode.optional ||
          callNode.arguments.length !== 1 ||
          callNode.callee.type !== "MemberExpression" ||
          callNode.callee.computed ||
          callNode.callee.property.type !== "Identifier" ||
          callNode.callee.property.name !== "some"
        ) {
          return;
        }
        const callback = callNode.arguments[0] as Rule.Node;
        const extracted = extractReturnExpression(callback);
        if (!extracted) {
          return;
        }
        const searchExpr = matchParamEquality(extracted, context);
        if (!searchExpr) {
          return;
        }
        if (
          isSkippedByUnicornIncludes(
            callNode,
            callNode.callee.object as Rule.Node,
            searchExpr,
            context,
          )
        ) {
          context.report({
            node: callNode.callee.property,
            messageId: "preferIncludes",
          });
        }
      },
    };
  },
};

const sonarCompatPlugin: ESLint.Plugin = {
  rules: {
    "prefer-includes": preferIncludesOverSomeRule,
  },
};

const scopeToFiles = (config: Linter.Config, files: string[]): Linter.Config => {
  if (config.ignores && Object.keys(config).length <= 2 && !config.rules && !config.plugins) {
    return config;
  }
  return {
    ...config,
    files: config.files ?? files,
  };
};

export default defineConfig([
  // Build output, test artifacts, and drizzle-kit's generated migration metadata.
  globalIgnores(["dist/", "coverage/", ".vitest/", "node_modules/", "drizzle/meta/"]),
  {
    files: jsFiles,
    plugins: { js },
    extends: ["js/recommended"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  scopeToFiles(sonarjs.configs.recommended, jsFiles),
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...(config as Linter.Config),
    files: tsFiles,
  })),
  ...tseslint.configs.stylisticTypeChecked.map((config) => ({
    ...(config as Linter.Config),
    files: tsFiles,
  })),
  {
    files: jsFiles,
    plugins: { unicorn },
    rules: {
      ...sonarCoreRules,
      ...sonarUnicornRules,
    },
  },
  {
    files: tsFiles,
    plugins: { "sonar-compat": sonarCompatPlugin },
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.json", "./tsconfig.spec.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "sonar-compat/prefer-includes": "error",
      "@typescript-eslint/consistent-type-definitions": "off",
      "@typescript-eslint/default-param-last": "error",
      "@typescript-eslint/dot-notation": [
        "error",
        {
          allowPrivateClassPropertyAccess: true,
          allowProtectedClassPropertyAccess: true,
          allowIndexSignaturePropertyAccess: true,
        },
      ],
      "@typescript-eslint/no-confusing-non-null-assertion": "error",
      "@typescript-eslint/no-dupe-class-members": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-extraneous-class": "error",
      "@typescript-eslint/no-mixed-enums": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-redeclare": "error",
      "@typescript-eslint/no-shadow": "error",
      "@typescript-eslint/no-unnecessary-type-arguments": "error",
      "@typescript-eslint/no-unused-expressions": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-useless-constructor": "error",
      "@typescript-eslint/non-nullable-type-assertion-style": "off",
      "@typescript-eslint/prefer-enum-initializers": "error",
      "@typescript-eslint/prefer-literal-enum-member": "error",
      "@typescript-eslint/prefer-readonly": "error",
      "@typescript-eslint/prefer-return-this-type": "error",
      "@typescript-eslint/return-await": ["error", "in-try-catch"],
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        { considerDefaultExhaustiveForUnions: true },
      ],
    },
  },
  { files: ["**/*.json"], plugins: { json }, language: "json/json", extends: ["json/recommended"] },
  {
    // TypeScript reads these as JSON-with-comments.
    files: ["**/*.jsonc", "**/tsconfig*.json"],
    plugins: { json },
    language: "json/jsonc",
    extends: ["json/recommended"],
  },
  {
    files: ["**/*.json5"],
    plugins: { json },
    language: "json/json5",
    extends: ["json/recommended"],
  },
  {
    files: ["**/*.md"],
    plugins: { markdown },
    language: "markdown/gfm",
    extends: ["markdown/recommended"],
  },
]);
