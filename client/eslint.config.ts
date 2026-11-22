import path from "node:path";
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import json from "@eslint/json";
import markdown from "@eslint/markdown";
import css from "@eslint/css";
import cssicorn from "eslint-cssicorn";
import sonarjs from "eslint-plugin-sonarjs";
import unicorn from "eslint-plugin-unicorn";
import angular from "angular-eslint";
import betterTailwindcss from "eslint-plugin-better-tailwindcss";
import { getDefaultSelectors } from "eslint-plugin-better-tailwindcss/api/defaults";
import { MatcherType, SelectorKind } from "eslint-plugin-better-tailwindcss/api/types";
import { tailwind4 } from "tailwind-csstree";
import { defineConfig, globalIgnores } from "eslint/config";
import type { ESLint, Linter, Rule } from "eslint";

const jsFiles = ["**/*.{js,mjs,cjs,ts,mts,cts}"];
const tsFiles = ["**/*.{ts,mts,cts}"];
const adminFiles = [
  "src/app/admin/**/*.{js,mjs,cjs,ts,mts,cts,html}",
  "src/app/pages/admin/**/*.{js,mjs,cjs,ts,mts,cts,html}",
  "src/app/pages/admin.page.*",
  "src/app/pages/admin.page.*/*.html",
  "libs/ui/**/*.{js,mjs,cjs,ts,mts,cts,html}",
];
const adminIgnores = [
  "src/app/admin/**",
  "src/app/pages/admin/**",
  "src/app/pages/admin.page.*",
  "src/app/pages/admin.page.*/**",
  "libs/ui/**",
  "index.html",
];

const tailwindSelectors = [
  ...getDefaultSelectors(),
  {
    kind: SelectorKind.Callee,
    match: [{ type: MatcherType.String }],
    name: "^hlm$",
  },
  {
    kind: SelectorKind.Attribute,
    match: [{ type: MatcherType.String }],
    name: "^[a-zA-Z0-9]+Class$",
  },
];

const tailwindRules: Linter.RulesRecord = {
  "better-tailwindcss/enforce-canonical-classes": "error",
  "better-tailwindcss/no-conflicting-classes": "error",
  "better-tailwindcss/no-deprecated-classes": "error",
  "better-tailwindcss/no-duplicate-classes": "error",
  "better-tailwindcss/no-unnecessary-whitespace": "error",
};

const sonarUnicornRules: Linter.RulesRecord = {
  "unicorn/catch-error-name": "error",
  "unicorn/consistent-date-clone": "error",
  "unicorn/consistent-empty-array-spread": "error",
  "unicorn/consistent-function-scoping": "error",
  // Angular SSR renders with Domino, which lacks element.dataset.
  "unicorn/dom-node-dataset": "off",
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

interface CssAstNode {
  type: "Identifier";
  loc?: unknown;
  name: string;
}

interface CssUtilityClassNode {
  type: "TailwindUtilityClass";
  loc: unknown;
  name: CssAstNode;
  variant: CssAstNode | null;
}

interface CssParserContext {
  tokenType: number;
  tokenStart: number;
  tokenEnd: number;
  source: string;
  important: boolean;
  createList: () => { push: (item: unknown) => void };
  skipSC: () => void;
  next: () => void;
  isDelim: (code: number, offset?: number) => boolean;
  lookupType: (offset: number) => number;
  cmpStr: (start: number, end: number, value: string) => boolean;
  Identifier: () => CssAstNode;
  TailwindUtilityClass: () => CssUtilityClassNode;
  getLocation: (start: number, end: number) => unknown;
  error: (message: string, offset: number) => never;
}

const isUtilityClassNode = (node: CssAstNode | CssUtilityClassNode): node is CssUtilityClassNode =>
  node.type === "TailwindUtilityClass";

const cssTokenTypes = {
  eof: 0,
  ident: 1,
  number: 10,
  whitespace: 13,
  colon: 16,
  semicolon: 17,
  leftSquareBracket: 19,
  rightSquareBracket: 20,
  comment: 25,
};

const EXCLAMATION_MARK = 0x21;
const SOLIDUS = 0x2f;

const withImportantModifier = (
  utilityClass: CssAstNode | CssUtilityClassNode,
  position: "prefix" | "suffix",
): CssAstNode | CssUtilityClassNode => {
  const applyFix = (value: string) => (position === "prefix" ? `!${value}` : `${value}!`);
  if (isUtilityClassNode(utilityClass)) {
    return {
      ...utilityClass,
      name: { ...utilityClass.name, name: applyFix(utilityClass.name.name) },
    };
  }
  return {
    ...utilityClass,
    name: applyFix(utilityClass.name),
  };
};

const isApplyEndToken = (tokenType: number): boolean =>
  tokenType === cssTokenTypes.whitespace ||
  tokenType === cssTokenTypes.semicolon ||
  tokenType === cssTokenTypes.eof ||
  tokenType === cssTokenTypes.comment;

const consumeLeadingImportant = (
  parser: CssParserContext,
): { done: boolean; hasLeadingImportant: boolean } => {
  if (!parser.isDelim(EXCLAMATION_MARK)) {
    return { done: false, hasLeadingImportant: false };
  }
  parser.next();
  if (
    parser.tokenType === cssTokenTypes.ident &&
    parser.cmpStr(parser.tokenStart, parser.tokenEnd, "important")
  ) {
    parser.Identifier();
    parser.important = true;
    parser.skipSC();
    return { done: true, hasLeadingImportant: false };
  }
  if (parser.tokenType === cssTokenTypes.whitespace) {
    parser.error("Expected identifier immediately after '!' in @apply directive", 0);
  }
  return { done: false, hasLeadingImportant: true };
};

const consumeTrailingImportant = (
  parser: CssParserContext,
  utilityClass: CssAstNode | CssUtilityClassNode,
  hasLeadingImportant: boolean,
): CssAstNode | CssUtilityClassNode => {
  if (!parser.isDelim(EXCLAMATION_MARK)) {
    return utilityClass;
  }
  if (hasLeadingImportant) {
    parser.error("Important modifier can only appear once per utility in @apply directive", 0);
  }
  parser.next();
  if (
    parser.tokenType === cssTokenTypes.ident &&
    parser.cmpStr(parser.tokenStart, parser.tokenEnd, "important")
  ) {
    parser.error("Expected whitespace before !important in @apply directive", 0);
  }
  if (!isApplyEndToken(parser.tokenType)) {
    parser.error("Expected whitespace or ';' after suffixed '!' in @apply directive", 0);
  }
  return withImportantModifier(utilityClass, "suffix");
};

const shouldParseUtilityNode = (parser: CssParserContext): boolean =>
  parser.lookupType(1) === cssTokenTypes.colon ||
  parser.lookupType(1) === cssTokenTypes.leftSquareBracket ||
  parser.isDelim(SOLIDUS, 1) ||
  parser.lookupType(1) === cssTokenTypes.number;

function parseApplyPrelude(this: unknown) {
  const parser = this as CssParserContext;
  const children = parser.createList();
  parser.important = false;
  while (true) {
    parser.skipSC();
    const leading = consumeLeadingImportant(parser);
    if (leading.done) {
      break;
    }
    if (parser.tokenType !== cssTokenTypes.ident) {
      if (leading.hasLeadingImportant) {
        parser.error("Expected identifier after '!' in @apply directive", 0);
      }
      break;
    }
    let utilityClass: CssAstNode | CssUtilityClassNode = shouldParseUtilityNode(parser)
      ? parser.TailwindUtilityClass()
      : parser.Identifier();
    if (leading.hasLeadingImportant) {
      utilityClass = withImportantModifier(utilityClass, "prefix");
    }
    children.push(consumeTrailingImportant(parser, utilityClass, leading.hasLeadingImportant));
  }
  return children;
}

const readDecimalSuffix = (parser: CssParserContext): string => {
  if (
    parser.tokenType !== cssTokenTypes.number ||
    parser.tokenStart <= 0 ||
    /\s/u.test(parser.source[parser.tokenStart - 1] ?? "") ||
    parser.source[parser.tokenStart] !== "."
  ) {
    return "";
  }
  const decimalSuffix = parser.source.slice(parser.tokenStart, parser.tokenEnd);
  parser.next();
  return decimalSuffix;
};

const readBracketSuffix = (parser: CssParserContext): string => {
  if (parser.tokenType !== cssTokenTypes.leftSquareBracket) {
    return "";
  }
  const bracketStart = parser.tokenStart;
  let depth = 0;
  do {
    if (parser.tokenType === cssTokenTypes.leftSquareBracket) {
      depth++;
    } else if (parser.tokenType === cssTokenTypes.rightSquareBracket) {
      depth--;
    }
    parser.next();
  } while (depth > 0 && parser.tokenType !== cssTokenTypes.eof);
  return parser.source.slice(bracketStart, parser.tokenStart);
};

const readOpacitySuffix = (parser: CssParserContext): string => {
  if (!parser.isDelim(SOLIDUS)) {
    return "";
  }
  parser.next();
  if (parser.tokenType === cssTokenTypes.ident) {
    return `/${parser.Identifier().name}`;
  }
  if (parser.tokenType === cssTokenTypes.number) {
    const opacityValue = parser.source.slice(parser.tokenStart, parser.tokenEnd);
    parser.next();
    return `/${opacityValue}`;
  }
  return "";
};

const appendVariant = (existing: CssAstNode | null, next: CssAstNode): CssAstNode =>
  existing === null ? next : { ...existing, name: `${existing.name}:${next.name}` };

function parseTailwindUtilityClass(this: unknown): CssUtilityClassNode {
  const parser = this as CssParserContext;
  parser.skipSC();
  const start = parser.tokenStart;
  let className = parser.Identifier();
  let variant: CssAstNode | null = null;
  while (parser.tokenType === cssTokenTypes.colon) {
    parser.next();
    variant = appendVariant(variant, className);
    className = parser.Identifier();
  }
  const suffix = `${readDecimalSuffix(parser)}${readBracketSuffix(parser)}${readOpacitySuffix(parser)}`;
  if (suffix) {
    className = { ...className, name: `${className.name}${suffix}` };
  }
  parser.skipSC();
  return {
    type: "TailwindUtilityClass",
    loc: parser.getLocation(start, parser.tokenStart),
    name: className,
    variant,
  };
}

interface Tailwind4SyntaxShape {
  atrule: Record<string, { parse?: Record<string, unknown> } | undefined>;
  atrules: Record<string, unknown>;
  node: Record<string, Record<string, unknown> | undefined>;
}

// tailwind-csstree stops @apply parsing at adjacent Number tokens (px-1.5, py-0.5) and omits `@tailwind`.
const tailwind4Syntax = (prev: Parameters<typeof tailwind4>[0]): ReturnType<typeof tailwind4> => {
  const base = tailwind4(prev) as ReturnType<typeof tailwind4> & Tailwind4SyntaxShape;
  const applyRule = base.atrule["apply"] ?? {};
  const applyParse = applyRule.parse ?? {};
  const utilityClassNode = base.node["TailwindUtilityClass"] ?? {};
  return {
    ...base,
    atrule: {
      ...base.atrule,
      apply: {
        ...applyRule,
        parse: {
          ...applyParse,
          prelude: parseApplyPrelude,
        },
      },
    },
    atrules: {
      ...base.atrules,
      tailwind: {
        prelude: "<ident> [ source( [ <ident> | <string> ] ) ]?",
      },
    },
    node: {
      ...base.node,
      TailwindUtilityClass: {
        ...utilityClassNode,
        parse: parseTailwindUtilityClass,
      },
    },
  } as unknown as ReturnType<typeof tailwind4>;
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

const sonarRecommendedConfig: Linter.Config =
  (sonarjs as { configs?: Record<string, Linter.Config> }).configs?.["recommended"] ?? {};

export default defineConfig([
  // Build output and caches: linting these produced ~11k findings against
  // generated code nobody edits.
  globalIgnores([
    "dist/",
    "out-tsc/",
    "coverage/",
    ".angular/",
    ".vitest/",
    "node_modules/",
    "playwright-report/",
    "test-results/",
    ".lighthouseci/",
  ]),
  {
    files: jsFiles,
    plugins: { js },
    extends: ["js/recommended"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  scopeToFiles(sonarRecommendedConfig, jsFiles),
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...(config as Linter.Config),
    files: tsFiles,
  })),
  ...tseslint.configs.stylisticTypeChecked.map((config) => ({
    ...(config as Linter.Config),
    files: tsFiles,
  })),
  ...angular.configs.tsRecommended.map((config) => ({
    ...(config as Linter.Config),
    files: tsFiles,
  })),
  {
    files: tsFiles,
    plugins: { "sonar-compat": sonarCompatPlugin },
    processor: angular.processInlineTemplates as Linter.Processor,
    languageOptions: {
      parserOptions: {
        project: [
          "./tsconfig.app.json",
          "./tsconfig.spec.json",
          "./tsconfig.node.json",
          "./e2e/tsconfig.json",
        ],
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
      "@typescript-eslint/no-extraneous-class": ["error", { allowWithDecorator: true }],
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
  {
    // Spartan Helm components intentionally alias inputs to `class` for host styling ergonomics.
    files: ["libs/ui/**/*.ts"],
    rules: {
      "@angular-eslint/no-input-rename": "off",
    },
  },
  {
    files: jsFiles,
    plugins: { unicorn },
    rules: {
      ...sonarCoreRules,
      ...sonarUnicornRules,
    },
  },
  {
    // Scripts and Playwright specs run outside Domino SSR, where element.dataset is supported.
    files: ["e2e/**/*.{js,mjs,cjs,ts,mts,cts}", "scripts/**/*.{js,mjs,cjs,ts,mts,cts}"],
    plugins: { unicorn },
    rules: {
      "unicorn/dom-node-dataset": "error",
    },
  },
  ...angular.configs.templateRecommended.map((config) => ({
    ...(config as Linter.Config),
    files: ["**/*.html"],
    ignores: ["index.html"],
  })),
  ...angular.configs.templateAccessibility.map((config) => ({
    ...(config as Linter.Config),
    files: ["**/*.html"],
    ignores: ["index.html"],
  })),
  {
    files: ["**/*.html"],
    ignores: ["index.html"],
    rules: {
      "@angular-eslint/template/button-has-type": "error",
      "@angular-eslint/template/label-has-associated-control": [
        "error",
        {
          controlComponents: ["hlm-switch", "hlm-checkbox"],
        },
      ],
    },
  },
  {
    files: [...jsFiles, "**/*.html"],
    ignores: adminIgnores,
    plugins: { "better-tailwindcss": betterTailwindcss },
    settings: {
      "better-tailwindcss": {
        entryPoint: path.join(import.meta.dirname, "src/styles.css"),
        rootFontSize: 16,
        selectors: tailwindSelectors,
      },
    },
    rules: tailwindRules,
  },
  {
    files: adminFiles,
    plugins: { "better-tailwindcss": betterTailwindcss },
    settings: {
      "better-tailwindcss": {
        entryPoint: path.join(import.meta.dirname, "src/admin.css"),
        rootFontSize: 16,
        selectors: tailwindSelectors,
      },
    },
    rules: tailwindRules,
  },
  { files: ["**/*.json"], plugins: { json }, language: "json/json", extends: ["json/recommended"] },
  {
    // TypeScript and VS Code read these as JSON-with-comments.
    files: ["**/*.jsonc", "**/tsconfig*.json", ".vscode/*.json"],
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
  {
    files: ["**/*.css"],
    plugins: {
      css,
      cssicorn: cssicorn as unknown as ESLint.Plugin,
    },
    language: "css/css",
    languageOptions: {
      customSyntax: tailwind4Syntax,
    },
    extends: ["css/recommended"],
    rules: {
      // Font stacks live in custom properties that already end in a generic family.
      "css/font-family-fallbacks": "off",
      "css/no-invalid-at-rules": "error",
      "cssicorn/no-deprecated-features": "error",
      "cssicorn/no-duplicate-at-rule-definitions": "error",
      "cssicorn/no-duplicate-font-family-names": "error",
      "cssicorn/no-duplicate-properties": "error",
      "cssicorn/no-duplicate-selectors": "error",
      "cssicorn/no-invalid-media-features": "error",
      "cssicorn/no-invalid-property-references": "error",
      "cssicorn/no-unknown-animations": "error",
      "cssicorn/no-unknown-pseudo-selectors": "error",
      "cssicorn/require-prefers-reduced-motion": "error",
    },
  },
  {
    // Partials imported by styles.css use the theme's custom properties, which
    // are declared there; linted on their own, every var() looks unknown.
    files: ["src/styles/**/*.css"],
    rules: { "css/no-invalid-properties": "off" },
  },
  {
    // The Tailwind entry points use tokens declared in src/styles/tokens.css,
    // which they import; as with the partials, var() looks unknown to the rule.
    files: ["src/styles.css", "src/admin.css"],
    rules: { "css/no-invalid-properties": "off" },
  },
]);
