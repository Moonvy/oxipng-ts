var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// node_modules/sugar-high/lib/shared.js
var TokenTypes = (
  /** @type {const} */
  "identifier keyword string class property entity jsxliterals sign comment break space".split(" ")
);
var [
  T_IDENTIFIER,
  T_KEYWORD,
  T_STRING,
  T_CLASS,
  T_PROPERTY,
  T_ENTITY,
  T_JSX_LITERALS,
  T_SIGN,
  T_COMMENT,
  T_BREAK,
  T_SPACE
] = TokenTypes.map((_, index) => index);
var SugarHigh = (
  /** @type {const} */
  {
    TokenTypes,
    TokenMap: new Map(TokenTypes.map((type, index) => [type, index]))
  }
);
function assemble(value, tokens) {
  const lines = [];
  let lineIndex = 0;
  const lineTokens = [];
  let lastWasBreak = false;
  function flushLine(tokens2) {
    lines.push({
      index: lineIndex++,
      value: tokens2.map(([, tokenValue]) => tokenValue).join(""),
      tokens: tokens2.map(([type, tokenValue]) => ({
        type: TokenTypes[type],
        value: tokenValue
      })),
      annotations: []
    });
  }
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    const [type, value2] = token;
    if (type !== T_BREAK) {
      if (value2.includes("\n")) {
        const values = value2.split("\n");
        for (let part = 0; part < values.length; part++) {
          lineTokens.push([type, values[part]]);
          if (part < values.length - 1) {
            flushLine(lineTokens);
            lineTokens.length = 0;
          }
        }
      } else {
        lineTokens.push(token);
      }
      lastWasBreak = false;
    } else {
      if (lastWasBreak) flushLine([]);
      else {
        flushLine(lineTokens);
        lineTokens.length = 0;
      }
      if (index === tokens.length - 1) flushLine([]);
      lastWasBreak = true;
    }
  }
  if (lineTokens.length) flushLine(lineTokens);
  return { value, lines };
}
function createLine(parsedLine, markLine) {
  const line = {
    index: parsedLine.index,
    value: parsedLine.value,
    tokens: parsedLine.tokens,
    annotations: parsedLine.annotations,
    className: `sh__line${parsedLine.annotations.map((annotation) => ` sh__line--${annotation}`).join("")}`,
    style: {},
    properties: {}
  };
  markLine?.(line);
  return line;
}
function createToken({ type, value }, cx, mark) {
  const extraClassName = cx?.[type];
  const token = {
    type,
    value,
    className: `sh__token--${type}${extraClassName ? ` ${extraClassName}` : ""}`,
    style: { color: `var(--sh-${type})` },
    properties: {}
  };
  mark?.(token);
  return token;
}
function render(parsed, options) {
  const cx = options?.cx;
  const mark = options?.mark;
  const markLine = options?.markLine;
  if (!cx && !mark && !markLine) {
    return parsed.lines.map((line) => {
      const className = `sh__line${line.annotations.map((annotation) => ` sh__line--${annotation}`).join("")}`;
      const children = line.tokens.map(({ type, value }) => `<span class="sh__token--${type}" style="color:var(--sh-${type})">${encode(value)}</span>`).join("");
      return `<span class="${encode(className)}">${children}</span>`;
    }).join("\n");
  }
  return parsed.lines.map((parsedLine) => {
    const line = createLine(parsedLine, markLine);
    const children = parsedLine.tokens.map((parsedToken) => {
      const token = createToken(parsedToken, cx, mark);
      return `<span ${attributes({
        ...token.properties,
        className: token.className,
        style: token.style
      })}>${encode(token.value)}</span>`;
    }).join("");
    return `<span ${attributes({
      ...line.properties,
      className: line.className,
      style: line.style
    })}>${children}</span>`;
  }).join("\n");
}
var entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
var encode = (value) => value.replace(/[&<>"']/g, (character) => entities[character]);
function attributes(values) {
  const style = Object.entries(values.style || {}).map(([key, value]) => `${key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}:${value}`).join(";");
  const properties = Object.entries(values).filter(([key, value]) => /^[\w:-]+$/.test(key) && key !== "className" && key !== "style" && value !== false && value != null).map(([key, value]) => value === true ? key : `${key}="${encode(String(value))}"`).join(" ");
  return `class="${encode(values.className || "")}"${style ? ` style="${encode(style)}"` : ""}${properties ? ` ${properties}` : ""}`;
}

// node_modules/sugar-high/lib/core.js
var signs = new Set("+-*/%=!&|^~?:.,;()[]{}<>#@\\".split(""));
var noComment = () => 0;
var isWord = (value) => value === "_" || value === "$" || /[\p{L}\p{N}]/u.test(value);
function isQuotedKey(code, index) {
  while (index < code.length && /\s/.test(code[index])) index++;
  return code[index] === ":";
}
function tokenize(code, options) {
  if (typeof options?.tokenize === "function") return options.tokenize(code, options);
  const keywords2 = options?.keywords || /* @__PURE__ */ new Set();
  const typeKeywords = options?.typeKeywords || /* @__PURE__ */ new Set();
  const onCommentStart2 = options?.onCommentStart || noComment;
  const onCommentEnd2 = options?.onCommentEnd || noComment;
  const normalize = options?.caseInsensitive ? (value) => value.toLowerCase() : (value) => value;
  const tokens = [];
  let lastSignificant = "";
  function append(type, value) {
    if (!value) return;
    tokens.push([type, value]);
    if (type !== T_SPACE && type !== T_BREAK) lastSignificant = value;
  }
  for (let i = 0; i < code.length; ) {
    const curr = code[i];
    const next = code[i + 1];
    const commentType = onCommentStart2(curr, next, i, code);
    if (commentType) {
      const start = i++;
      while (i < code.length) {
        if (onCommentEnd2(code[i - 1], code[i], i, code, start) == commentType) {
          i++;
          break;
        }
        i++;
      }
      append(T_COMMENT, code.slice(start, i));
      continue;
    }
    const literalLength = options?.onLiteral?.(curr, i, code);
    if (literalLength) {
      append(T_STRING, code.slice(i, i + literalLength));
      i += literalLength;
      continue;
    }
    if (typeof options?.onQuote === "function" && curr === "'") {
      const length = options.onQuote(curr, i, code);
      if (typeof length === "number" && length >= 1) {
        append(T_IDENTIFIER, code.slice(i, i + length));
        i += length;
        continue;
      }
    }
    if (curr === '"' || curr === "'" || options?.templateStrings && curr === "`") {
      const quote = curr;
      const start = i++;
      while (i < code.length) {
        if (code[i] === "\\") {
          i++;
        } else if (code[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      const value = code.slice(start, i);
      append(options?.quotedKeys && isQuotedKey(code, i) ? T_PROPERTY : T_STRING, value);
      continue;
    }
    if (curr === "\n") {
      append(T_BREAK, curr);
      i++;
      continue;
    }
    if (/[^\S\r\n]/.test(curr)) {
      const start = i++;
      while (i < code.length && /[^\S\r\n]/.test(code[i])) i++;
      append(T_SPACE, code.slice(start, i));
      continue;
    }
    if (isWord(curr)) {
      const start = i++;
      while (i < code.length && isWord(code[i])) i++;
      if (/^\d/.test(curr) && code[i] === "." && /\d/.test(code[i + 1] || "")) {
        i++;
        while (i < code.length && isWord(code[i])) i++;
      }
      const value = code.slice(start, i);
      const normalized = normalize(value);
      const type = typeKeywords.has(normalized) ? T_CLASS : keywords2.has(normalized) ? T_KEYWORD : lastSignificant === "." ? T_PROPERTY : /^\d/.test(value) || value === "null" || /^\p{Lu}/u.test(value) ? T_CLASS : T_IDENTIFIER;
      append(type, value);
      continue;
    }
    if (signs.has(curr)) {
      append(T_SIGN, curr);
      i++;
      continue;
    }
    append(T_STRING, curr);
    i++;
  }
  return tokens;
}
function parse(code, options) {
  const parsed = assemble(code, tokenize(code, options));
  if (options?.annotateLine) {
    for (const line of parsed.lines) options.annotateLine(line);
  }
  return parsed;
}

// node_modules/sugar-high/lib/lang/shell.js
var shell_exports = {};
__export(shell_exports, {
  keywords: () => keywords,
  onCommentEnd: () => onCommentEnd,
  onCommentStart: () => onCommentStart
});

// node_modules/sugar-high/lib/presets/hash-comment-base.js
var onCommentStart = (currentChar) => currentChar === "#" ? 1 : 0;
var onCommentEnd = (_prevChar, currChar) => currChar === "\n" ? 1 : 0;

// node_modules/sugar-high/lib/lang/shell.js
var keywords = /* @__PURE__ */ new Set([
  "case",
  "coproc",
  "do",
  "done",
  "elif",
  "else",
  "esac",
  "export",
  "fi",
  "for",
  "function",
  "if",
  "in",
  "local",
  "readonly",
  "return",
  "select",
  "then",
  "time",
  "until",
  "while"
]);

// node_modules/sugar-high/lib/lang/typescript.js
var typescript_exports = {};
__export(typescript_exports, {
  tokenize: () => tokenize3
});

// node_modules/sugar-high/lib/presets/javascript-runtime.js
var JSXBrackets = /* @__PURE__ */ new Set(["<", ">", "{", "}", "[", "]"]);
var Keywords_Js = /* @__PURE__ */ new Set([
  "for",
  "do",
  "while",
  "if",
  "else",
  "return",
  "function",
  "var",
  "let",
  "const",
  "true",
  "false",
  "undefined",
  "this",
  "new",
  "delete",
  "typeof",
  "in",
  "instanceof",
  "void",
  "break",
  "continue",
  "switch",
  "case",
  "default",
  "throw",
  "try",
  "catch",
  "finally",
  "debugger",
  "with",
  "yield",
  "async",
  "await",
  "class",
  "extends",
  "super",
  "import",
  "export",
  "from",
  "static"
]);
var Keywords_Ts = /* @__PURE__ */ new Set([
  ...Keywords_Js,
  "type",
  "interface",
  "enum",
  "implements",
  "readonly",
  "abstract",
  "declare",
  "namespace",
  "module",
  "private",
  "protected",
  "public",
  "override",
  "keyof",
  "infer",
  "is",
  "asserts",
  "satisfies",
  "as",
  "unknown",
  "never",
  "any",
  "number",
  "string",
  "boolean",
  "bigint",
  "symbol",
  "object"
]);
var Signs = /* @__PURE__ */ new Set([
  "+",
  "-",
  "*",
  "/",
  "%",
  "=",
  "!",
  "&",
  "|",
  "^",
  "~",
  "!",
  "?",
  ":",
  ".",
  ",",
  ";",
  `'`,
  '"',
  ".",
  "(",
  ")",
  "[",
  "]",
  "#",
  "@",
  "\\",
  ...JSXBrackets
]);
var DefaultOptions = {
  keywords: Keywords_Js,
  onCommentStart: isCommentStart_Js,
  onCommentEnd: isCommentEnd_Js,
  jsx: true,
  regex: true,
  templateStrings: true
};
function resolveHighlightOptions(options) {
  return {
    ...DefaultOptions,
    ...options
  };
}
function isLikelyTypeScript(code) {
  let tsScore = 0;
  if (/\binterface\s+[A-Za-z_$][\w$]*/.test(code)) tsScore += 2;
  if (/\btype\s+[A-Za-z_$][\w$]*\s*=/.test(code)) tsScore += 2;
  if (/\benum\s+[A-Za-z_$][\w$]*/.test(code)) tsScore += 2;
  if (/\b(?:implements|readonly|declare|namespace|satisfies|infer|keyof|asserts)\b/.test(code)) tsScore += 2;
  if (/:\s*[A-Za-z_$][\w$]*(?:<[^>\n]+>)?(?:\[\])?(?=\s*[,)=;{])/m.test(code)) tsScore += 1;
  if (/\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*:\s*/.test(code)) tsScore += 1;
  if (/\)\s*:\s*[A-Za-z_$][\w$]*(?:<[^>\n]+>)?(?:\[\])?\s*(?:=>|\{)/.test(code)) tsScore += 1;
  return tsScore >= 2;
}
function isTypeParameterListStart(code, startIndex) {
  if (code[startIndex] !== "<") return false;
  let depth = 0;
  let sawIdentifierStart = false;
  for (let i = startIndex; i < code.length; i++) {
    const ch = code[i];
    if (ch === "<") {
      depth++;
      continue;
    }
    if (ch === ">") {
      depth--;
      if (depth === 0) {
        let next = i + 1;
        while (next < code.length && /\s/.test(code[next])) next++;
        if (!(sawIdentifierStart && code[next] === "(")) return false;
        const tail = code.slice(next, next + 320);
        return /\)\s*(?::[\s\S]{0,120}?)?=>/.test(tail);
      }
      continue;
    }
    if (depth === 0) continue;
    if (/[$A-Za-z_]/.test(ch)) {
      sawIdentifierStart = true;
      continue;
    }
    if (/[\s,\.\=\?\:\|\&\[\]]/.test(ch)) continue;
    return false;
  }
  return false;
}
function isSpaces(str) {
  return /^[^\S\r\n]+$/g.test(str);
}
function isSign(ch) {
  return Signs.has(ch);
}
function isWord2(chr) {
  return /^[\w$\u0080-\uffff]+$/.test(chr || "");
}
function isCls(str) {
  return /^[0-9A-Z\p{Lu}]/u.test(str) || str === "null";
}
function isAlpha(chr) {
  return /^[a-zA-Z]$/.test(chr);
}
function isIdentifierChar(chr) {
  return /^[$_A-Za-z\u0080-\uffff]$/.test(chr || "");
}
function isIdentifier(str) {
  return isIdentifierChar(str[0]) && isWord2(str);
}
function isStrTemplateChr(chr) {
  return chr === "`";
}
function isSingleQuotes(chr) {
  return chr === '"' || chr === "'";
}
function isCommentStart_Js(curr, next) {
  const str = curr + next;
  if (str === "/*") return 2;
  return str === "//" ? 1 : 0;
}
function isCommentEnd_Js(prev, curr) {
  return prev + curr === "*/" ? 2 : curr === "\n" ? 1 : 0;
}
function isRegexStart(str) {
  return str[0] === "/" && !isCommentStart_Js(str[0], str[1]);
}
function isPropertyKey(code, quoteEnd) {
  let i = quoteEnd + 1;
  while (i < code.length && /\s/.test(code[i])) i++;
  return code[i] === ":";
}
function tokenize2(code, options) {
  const mergedOptions = resolveHighlightOptions(options);
  const hasCustomKeywords = mergedOptions.keywords !== DefaultOptions.keywords;
  const isTs = typeof mergedOptions.typescript === "boolean" ? mergedOptions.typescript : isLikelyTypeScript(code);
  const resolvedKeywords = hasCustomKeywords ? mergedOptions.keywords : isTs ? Keywords_Ts : Keywords_Js;
  const {
    onCommentStart: onCommentStart2,
    onCommentEnd: onCommentEnd2
  } = mergedOptions;
  const resolvedTypeKeywords = mergedOptions.typeKeywords instanceof Set ? mergedOptions.typeKeywords : null;
  const supportsJsx = mergedOptions.jsx !== false;
  const supportsRegex = mergedOptions.regex !== false;
  const supportsTemplateStrings = mergedOptions.templateStrings !== false;
  const normalizeKeyword = mergedOptions.caseInsensitive ? (token) => token.toLowerCase() : (token) => token;
  const isTemplateQuote = (chr) => supportsTemplateStrings && isStrTemplateChr(chr);
  let current = "";
  let type = -1;
  let last = [-1, ""];
  let beforeLast = [-2, ""];
  const tokens = [];
  let __jsxEnter = false;
  let __jsxTag = 0;
  let __jsxExprDepth = 0;
  let __jsxTagExpr = 0;
  let __jsxStack = 0;
  const __jsxChild = () => __jsxEnter && !__jsxExprDepth && !__jsxTag;
  const inJsxTag = () => __jsxTag;
  const inJsxLiterals = () => __jsxChild() && __jsxStack;
  let __strQuote = null;
  let __strTokenStart = 0;
  let __regexQuoteStart = false;
  let __strTemplateExprStack = 0;
  let __strTemplateQuoteStack = 0;
  const inStringQuotes = () => __strQuote !== null;
  const inRegexQuotes = () => __regexQuoteStart;
  const inStrTemplateLiterals = () => __strTemplateQuoteStack > __strTemplateExprStack;
  const inStrTemplateExpr = () => __strTemplateQuoteStack > 0 && __strTemplateQuoteStack === __strTemplateExprStack;
  const inStringContent = () => inStringQuotes() || inStrTemplateLiterals();
  function classify(token) {
    const isLineBreak = token === "\n";
    if (inJsxTag()) {
      if (inStringQuotes()) {
        return T_STRING;
      }
      const [, lastToken] = last;
      if (isIdentifier(token)) {
        if (lastToken === "<" || lastToken === "</")
          return T_ENTITY;
        if (!__jsxTagExpr && /^\s+$/.test(tokens[tokens.length - 1]?.[1] || ""))
          return T_PROPERTY;
      }
    }
    const isJsxLiterals = inJsxLiterals();
    if (isJsxLiterals) return T_JSX_LITERALS;
    if (inStringQuotes() || inStrTemplateLiterals()) {
      return T_STRING;
    } else if (resolvedTypeKeywords && resolvedTypeKeywords.has(normalizeKeyword(token))) {
      return last[1] === "." ? T_IDENTIFIER : T_CLASS;
    } else if (resolvedKeywords.has(normalizeKeyword(token))) {
      return last[1] === "." ? T_IDENTIFIER : T_KEYWORD;
    } else if (isLineBreak) {
      return T_BREAK;
    } else if (isSpaces(token)) {
      return T_SPACE;
    } else if (token.split("").every(isSign)) {
      return T_SIGN;
    } else if (isCls(token)) {
      return inJsxTag() && !__jsxTagExpr ? T_IDENTIFIER : T_CLASS;
    } else {
      if (isIdentifier(token)) {
        const isLastPropDot = last[1] === "." && isIdentifier(beforeLast[1]);
        if (!inStringContent() && !isLastPropDot) return T_IDENTIFIER;
        if (isLastPropDot) return T_PROPERTY;
      }
      return T_STRING;
    }
  }
  const append = (type_, token_) => {
    if (token_) {
      current = token_;
    }
    if (current) {
      type = typeof type_ === "number" ? type_ : classify(current);
      const pair = [type, current];
      if (type !== T_SPACE && type !== T_BREAK) {
        beforeLast = last;
        last = pair;
      }
      if (inJsxTag() && type === T_SIGN) {
        if (current === "{") __jsxTagExpr++;
        if (current === "}") __jsxTagExpr--;
      }
      tokens.push(pair);
    }
    current = "";
  };
  for (let i = 0; i < code.length; i++) {
    const curr = code[i];
    const prev = code[i - 1];
    const next = code[i + 1];
    const p_c = prev + curr;
    const c_n = curr + next;
    if (typeof mergedOptions.onQuote === "function" && curr === "'" && !inStringQuotes() && !inJsxLiterals() && !inStrTemplateLiterals()) {
      const rawLen = mergedOptions.onQuote(curr, i, code);
      if (typeof rawLen === "number" && rawLen >= 1 && !Number.isNaN(rawLen)) {
        const len = Math.min(rawLen, code.length - i);
        const end = i + len;
        append();
        current = code.slice(i, end);
        append(T_IDENTIFIER);
        i = end - 1;
        continue;
      }
    }
    if (isSingleQuotes(curr) && !inJsxLiterals() && !inStrTemplateLiterals()) {
      append();
      let isStringClose = false;
      if (__strQuote && curr === __strQuote) {
        __strQuote = null;
        isStringClose = true;
      } else if (!__strQuote) {
        __strQuote = curr;
        __strTokenStart = tokens.length;
      }
      append(T_STRING, curr);
      if (mergedOptions.quotedKeys && isStringClose && isPropertyKey(code, i)) {
        for (let tokenIndex = __strTokenStart; tokenIndex < tokens.length; tokenIndex++) {
          tokens[tokenIndex][0] = T_PROPERTY;
        }
      }
      continue;
    }
    if (isTemplateQuote(curr)) {
      append();
      __strTemplateQuoteStack += inStrTemplateLiterals() ? -1 : 1;
      append(T_STRING, curr);
      continue;
    }
    if (inStrTemplateLiterals()) {
      if (c_n === "${") {
        __strTemplateExprStack++;
        append(T_STRING);
        append(T_SIGN, c_n);
        i++;
        continue;
      }
    }
    if (inStrTemplateExpr() && curr === "}") {
      append();
      __strTemplateExprStack--;
      append(T_SIGN, curr);
      continue;
    }
    if (__jsxChild()) {
      if (curr === "{") {
        append();
        append(T_SIGN, curr);
        __jsxExprDepth = 1;
        continue;
      }
    }
    if (__jsxEnter) {
      if (!__jsxTag && curr === "<") {
        append();
        if (next === "/") {
          __jsxTag = 2;
          current = c_n;
          i++;
        } else {
          __jsxTag = 1;
          current = curr;
        }
        append(T_SIGN);
        continue;
      }
      if (__jsxTag) {
        if (curr === ">" && !"/=".includes(prev)) {
          append();
          if (__jsxTag === 1) {
            __jsxTag = 0;
            __jsxStack++;
          } else {
            __jsxTag = 0;
            __jsxEnter = false;
          }
          append(T_SIGN, curr);
          continue;
        }
        if (c_n === "/>" || c_n === "</") {
          if (current !== "<" && current !== "/") {
            append();
          }
          if (c_n === "/>") {
            __jsxTag = 0;
          } else {
            __jsxStack--;
          }
          if (!__jsxStack)
            __jsxEnter = false;
          current = c_n;
          i++;
          append(T_SIGN);
          continue;
        }
        if (curr === "<") {
          append();
          current = curr;
          append(T_SIGN);
          continue;
        }
        if (curr === "-" && current && !inStringContent() && !inJsxLiterals()) {
          let end = i + 1;
          while (end < code.length && /[$\w-]/.test(code[end])) end++;
          append(T_PROPERTY, current + code.slice(i, end));
          i = end - 1;
          continue;
        }
        if (next === "=" && !inStringContent()) {
          if (!isSpaces(curr)) {
            if (isSpaces(current)) {
              append();
            }
            const prop = current + curr;
            if (isIdentifier(prop)) {
              append(T_PROPERTY, prop);
              continue;
            }
          }
        }
      }
    }
    if (supportsJsx && !__jsxTag && (curr === "<" && isIdentifierChar(next) || c_n === "</")) {
      let prevNonSpace = i - 1;
      while (prevNonSpace >= 0 && /\s/.test(code[prevNonSpace])) prevNonSpace--;
      const prevChar = prevNonSpace >= 0 ? code[prevNonSpace] : "";
      const [lastType, lastTok] = last;
      let typeArgFromPending = false;
      let jsxFromPending = false;
      if (current && !isSpaces(current)) {
        const w = current;
        if (isCls(w) || w === "true" || w === "false") {
          typeArgFromPending = true;
        } else if (resolvedKeywords.has(w) && isIdentifier(w)) {
          jsxFromPending = true;
        } else if (isIdentifier(w)) {
          typeArgFromPending = true;
        }
      }
      const isTsTypeArgStart = curr === "<" && /[$\w\]\)]/.test(prevChar) && (typeArgFromPending || !jsxFromPending && (lastType === T_IDENTIFIER || lastType === T_CLASS || lastType === T_SIGN && (lastTok === ")" || lastTok === "]")));
      const isTsGenericStart = curr === "<" && isTypeParameterListStart(code, i);
      if (!isTsTypeArgStart && !isTsGenericStart) {
        __jsxTag = next === "/" ? 2 : 1;
      }
      if (curr === "<" && (next === "/" || isAlpha(next))) {
        if (!isTsTypeArgStart && !isTsGenericStart && !inStringContent() && !inJsxLiterals() && !inRegexQuotes()) {
          __jsxEnter = true;
        }
      }
    }
    const isQuotationChar = isSingleQuotes(curr) || isTemplateQuote(curr);
    const isStringTemplateLiterals = inStrTemplateLiterals();
    const isRegexChar = supportsRegex && !__jsxEnter && isRegexStart(c_n);
    const isJsxLiterals = inJsxLiterals();
    if (isQuotationChar || isStringTemplateLiterals || isSingleQuotes(__strQuote)) {
      current += curr;
      if (curr === "\\") current += code[++i] || "";
    } else if (isRegexChar) {
      append();
      const [lastType, lastToken] = last;
      if (isRegexChar && lastType !== -1 && !(lastType === T_SIGN && ")" !== lastToken || lastType === T_COMMENT)) {
        current = curr;
        append();
        continue;
      }
      __regexQuoteStart = true;
      const start = i++;
      let foundClose = false;
      let inCharClass = false;
      for (; i < code.length && code[i] !== "\n"; i++) {
        const ch = code[i];
        if (ch === "\\") {
          if (code[i + 1] === "\n") break;
          i++;
          continue;
        }
        if (ch === "[") inCharClass = true;
        if (ch === "]") inCharClass = false;
        if (ch === "/" && !inCharClass) {
          foundClose = true;
          while (/^[a-z]$/.test(code[i + 1])) {
            i++;
          }
          break;
        }
      }
      __regexQuoteStart = false;
      if (start !== i && foundClose) {
        current = code.slice(start, i + 1);
        append(T_STRING);
      } else {
        current = curr;
        append();
        i = start;
      }
    } else if (onCommentStart2(curr, next, i, code)) {
      append();
      const start = i;
      const startCommentType = onCommentStart2(curr, next, i, code);
      if (startCommentType) {
        for (; i < code.length; i++) {
          const endCommentType = onCommentEnd2(code[i - 1], code[i], i, code);
          if (endCommentType == startCommentType) break;
        }
      }
      current = code.slice(start, i + 1);
      append(T_COMMENT);
    } else if (curr === " " || curr === "\n") {
      if (curr === " " && (isSpaces(current) || !current || isJsxLiterals)) {
        let end = i + 1;
        while (code[end] === " ") end++;
        current += code.slice(i, end);
        i = end - 1;
        if (code[end] === "<") {
          append();
        }
      } else {
        append();
        current = curr;
        append();
      }
    } else {
      if (__jsxExprDepth && curr === "}") {
        append();
        current = curr;
        append();
        __jsxExprDepth--;
      } else if (
        // it's jsx literals and is not a jsx bracket
        isJsxLiterals && !JSXBrackets.has(curr) || // it's template literal content (including quotes)
        inStrTemplateLiterals() || // same type char as previous one in current token
        (isWord2(curr) === isWord2(current[current.length - 1]) || __jsxChild()) && !Signs.has(curr)
      ) {
        current += curr;
      } else {
        if (p_c === "</") {
          current = p_c;
        }
        append();
        if (p_c !== "</") {
          current = curr;
        }
        if (c_n === "</" || c_n === "/>") {
          current = c_n;
          append();
          i++;
        } else if (JSXBrackets.has(curr)) append();
      }
      if (__jsxExprDepth && curr === "{") __jsxExprDepth++;
    }
  }
  append();
  return tokens;
}

// node_modules/sugar-high/lib/lang/typescript.js
var tokenize3 = (code, options) => tokenize2(code, {
  ...options,
  typescript: true
});

// site/app.js
var $ = (id) => document.getElementById(id);
var els = {
  dropzone: $("dropzone"),
  fileInput: $("fileInput"),
  status: $("status"),
  results: $("results"),
  level: $("level"),
  interlace: $("interlace"),
  alpha: $("alpha"),
  strip: $("strip"),
  statOriginal: $("statOriginal"),
  statOptimized: $("statOptimized"),
  statSaved: $("statSaved"),
  statTime: $("statTime"),
  barFill: $("barFill"),
  compare: $("compare"),
  imgOriginal: $("imgOriginal"),
  imgOptimized: $("imgOptimized"),
  compareRange: $("compareRange"),
  download: $("download"),
  reset: $("reset")
};
var currentRequest = 0;
var activeWorker = null;
var activeWorkerCancel = null;
var codeSources = /* @__PURE__ */ new WeakMap();
var codeLanguages = { shell: shell_exports, typescript: typescript_exports };
for (const code of document.querySelectorAll(".code-card code[data-lang]")) {
  const source = code.textContent;
  codeSources.set(code, source);
  const language = codeLanguages[code.dataset.lang];
  if (!language) continue;
  const previewSource = source.split("\n").filter((line) => line.trim().length > 0).join("\n");
  const highlighted = render(parse(previewSource, language));
  code.innerHTML = highlighted.replace(/\n(?=<span class="sh__line)/g, "");
  code.classList.add("sh");
}
function cancelActiveCompression() {
  activeWorkerCancel?.();
}
function optimizeInWorker(buffer, params) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./compression.worker.js", import.meta.url), { type: "module" });
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      if (activeWorker === worker) activeWorker = null;
      if (activeWorkerCancel === cancel) activeWorkerCancel = null;
      callback(value);
    };
    const cancel = () => finish(resolve, null);
    activeWorker = worker;
    activeWorkerCancel = cancel;
    worker.onmessage = ({ data }) => {
      if (data?.type === "result") finish(resolve, data);
      else if (data?.type === "error") finish(reject, new Error(data.message || "\u538B\u7F29\u5931\u8D25"));
    };
    worker.onerror = (event) => {
      event.preventDefault();
      finish(reject, new Error(event.message || "\u538B\u7F29\u5DE5\u4F5C\u7EBF\u7A0B\u51FA\u9519"));
    };
    worker.onmessageerror = () => finish(reject, new Error("\u65E0\u6CD5\u8BFB\u53D6\u5DE5\u4F5C\u7EBF\u7A0B\u7684\u538B\u7F29\u7ED3\u679C"));
    try {
      worker.postMessage({ type: "optimize", buffer, params }, [buffer]);
    } catch (error) {
      finish(reject, error);
    }
  });
}
function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  const units = ["KiB", "MiB", "GiB"];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  const digits = value < 10 ? 2 : value < 100 ? 1 : 0;
  return `${value.toFixed(digits)} ${units[i]}`;
}
function setStatus(html) {
  els.status.innerHTML = html;
  els.status.style.display = "";
  els.results.hidden = true;
}
function clearObjectUrls() {
  if (els.imgOriginal.src) URL.revokeObjectURL(els.imgOriginal.src);
  if (els.imgOptimized.src) URL.revokeObjectURL(els.imgOptimized.src);
  if (els.download.getAttribute("href")) URL.revokeObjectURL(els.download.href);
  els.download.removeAttribute("href");
  els.imgOptimized.onload = null;
}
function showError(message, detail = "") {
  setStatus('<p class="error"></p><p class="muted"></p>');
  els.status.children[0].textContent = message;
  els.status.children[1].textContent = detail;
}
function readParams() {
  return {
    level: els.level.value,
    interlace: els.interlace.value,
    alpha: els.alpha.checked,
    strip: els.strip.checked
  };
}
async function handleFile(file, requestId = ++currentRequest) {
  if (!file) return;
  if (requestId !== currentRequest) return;
  cancelActiveCompression();
  const isPng = /\.(png|apng)$/i.test(file.name) || file.type === "image/png" || file.type === "image/apng";
  if (!isPng && file.type !== "") {
    showError("\u8BF7\u9009\u62E9 PNG \u6216 APNG \u56FE\u7247\u3002", `\u5F53\u524D\u6587\u4EF6\u7C7B\u578B\uFF1A${file.type || "\u672A\u77E5"}`);
    return;
  }
  const params = readParams();
  clearObjectUrls();
  const originalUrl = URL.createObjectURL(file);
  els.imgOriginal.src = originalUrl;
  els.imgOptimized.removeAttribute("src");
  setStatus('<div class="spinner"></div><p>\u6B63\u5728\u672C\u5730\u4F18\u5316\u2026</p><button class="btn ghost cancel-compression" data-cancel-compression type="button">\u53D6\u6D88\u538B\u7F29</button>');
  try {
    const arrayBuffer = await file.arrayBuffer();
    if (requestId !== currentRequest) return;
    const result = await optimizeInWorker(arrayBuffer, params);
    if (requestId !== currentRequest) return;
    if (!result) return;
    const { output, timeMs, size } = result;
    const optimizedBlob = new Blob([output], { type: "image/png" });
    const optimizedUrl = URL.createObjectURL(optimizedBlob);
    els.imgOptimized.src = optimizedUrl;
    els.imgOptimized.onload = () => {
      els.compareRange.value = 50;
      els.compare.style.setProperty("--pos", "50%");
    };
    renderResult(file, size, timeMs, optimizedBlob);
  } catch (err) {
    if (requestId !== currentRequest) return;
    showError("\u8FD9\u5F20\u56FE\u7247\u6682\u65F6\u65E0\u6CD5\u4F18\u5316\u3002", err instanceof Error ? err.message : String(err));
  }
}
async function loadSample(name) {
  const requestId = ++currentRequest;
  cancelActiveCompression();
  try {
    const res = await fetch(`./samples/${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error("\u672A\u627E\u5230\u6837\u672C\u56FE\u7247");
    const blob = await res.blob();
    await handleFile(new File([blob], name, { type: "image/png" }), requestId);
  } catch (err) {
    if (requestId !== currentRequest) return;
    showError("\u6682\u65F6\u65E0\u6CD5\u52A0\u8F7D\u6837\u672C\u3002", err instanceof Error ? err.message : String(err));
  }
}
function renderResult(file, optimizedSize, timeMs, optimizedBlob) {
  const originalSize = file.size;
  const saved = originalSize - optimizedSize;
  const percent = originalSize > 0 ? saved / originalSize * 100 : 0;
  els.statOriginal.textContent = formatBytes(originalSize);
  els.statOptimized.textContent = formatBytes(optimizedSize);
  els.statTime.textContent = timeMs < 1e3 ? `${Math.round(timeMs)} ms` : `${(timeMs / 1e3).toFixed(2)} s`;
  if (saved <= 0) {
    els.statSaved.textContent = "\u65E0\u9700\u8FDB\u4E00\u6B65\u538B\u7F29";
    els.barFill.style.width = "0%";
  } else {
    els.statSaved.textContent = `${formatBytes(saved)} \xB7 ${percent.toFixed(1)}%`;
    els.barFill.style.width = `${Math.max(2, Math.min(100, percent))}%`;
  }
  const base = (file.name || "image.png").replace(/\.(png|apng)$/i, "");
  els.download.href = URL.createObjectURL(optimizedBlob);
  els.download.download = `${base}.optimized.png`;
  els.status.style.display = "none";
  els.results.hidden = false;
}
els.dropzone.addEventListener("click", () => els.fileInput.click());
els.dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    els.fileInput.click();
  }
});
els.fileInput.addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  if (file) handleFile(file);
  els.fileInput.value = "";
});
["dragenter", "dragover"].forEach(
  (type) => els.dropzone.addEventListener(type, (e) => {
    e.preventDefault();
    els.dropzone.classList.add("drag");
  })
);
["dragleave", "drop"].forEach(
  (type) => els.dropzone.addEventListener(type, (e) => {
    e.preventDefault();
    els.dropzone.classList.remove("drag");
  })
);
els.dropzone.addEventListener("drop", (e) => {
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) handleFile(file);
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  if (els.dropzone.contains(e.target)) return;
  e.preventDefault();
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) {
    handleFile(file);
    document.getElementById("demo").scrollIntoView({ behavior: "smooth" });
  }
});
document.addEventListener("paste", (e) => {
  const items = e.clipboardData && e.clipboardData.files;
  if (items && items[0]) handleFile(items[0]);
});
document.querySelectorAll("[data-sample]").forEach(
  (btn) => btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      await loadSample(btn.dataset.sample);
    } finally {
      btn.disabled = false;
    }
  })
);
els.compareRange.addEventListener("input", () => {
  els.compare.style.setProperty("--pos", `${els.compareRange.value}%`);
});
els.reset.addEventListener("click", () => {
  currentRequest++;
  cancelActiveCompression();
  clearObjectUrls();
  els.imgOriginal.removeAttribute("src");
  els.imgOptimized.removeAttribute("src");
  setStatus('<p class="placeholder">\u9009\u4E00\u5F20\u56FE\u7247\uFF0C\u7EE7\u7EED\u8F7B\u88C5\u4E0A\u8DEF\u3002</p>');
  els.fileInput.click();
});
els.status.addEventListener("click", (event) => {
  if (!event.target.closest("[data-cancel-compression]")) return;
  currentRequest++;
  cancelActiveCompression();
  clearObjectUrls();
  els.imgOriginal.removeAttribute("src");
  els.imgOptimized.removeAttribute("src");
  setStatus('<p class="placeholder">\u5DF2\u53D6\u6D88\u538B\u7F29\u3002</p><p class="muted">\u53EF\u4EE5\u91CD\u65B0\u9009\u62E9\u56FE\u7247\u7EE7\u7EED\u3002</p>');
});
document.querySelectorAll(".copy").forEach(
  (btn) => btn.addEventListener("click", async () => {
    const target = document.getElementById(`code-${btn.dataset.copy}`);
    try {
      await navigator.clipboard.writeText(codeSources.get(target) ?? target.textContent);
      const original = btn.textContent;
      btn.textContent = "\u5DF2\u590D\u5236";
      setTimeout(() => btn.textContent = original, 1200);
    } catch {
    }
  })
);
var requestedSample = new URLSearchParams(location.search).get("sample");
if (requestedSample) {
  const name = requestedSample.split("/").pop();
  loadSample(name);
}
