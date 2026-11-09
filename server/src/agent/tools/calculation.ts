import { AgentError } from '../errorHandling';
import type { AgentTool } from '../types';

type Operator = '+' | '-' | '*' | '/' | '%' | '^' | '(' | ')';

type Token =
  | { type: 'number'; value: number }
  | { type: 'operator'; value: Operator };

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < expression.length) {
    const char = expression[index] ?? '';
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (/[0-9.]/.test(char)) {
      let raw = '';
      let dots = 0;
      while (index < expression.length) {
        const next = expression[index] ?? '';
        if (next === '.') {
          dots += 1;
          if (dots > 1) {
            throw invalid('The expression contains a malformed decimal number.');
          }
        } else if (!/[0-9]/.test(next)) {
          break;
        }
        raw += next;
        index += 1;
      }
      const value = Number(raw);
      if (!Number.isFinite(value)) throw invalid('The expression contains an invalid number.');
      tokens.push({ type: 'number', value });
      continue;
    }

    if ('+-*/%^()'.includes(char)) {
      tokens.push({ type: 'operator', value: char as Operator });
      index += 1;
      continue;
    }

    throw invalid('Only numbers, parentheses and the operators + - * / % ^ are allowed.');
  }

  return tokens;
}

function invalid(message: string): AgentError {
  return new AgentError('AGENT_TOOL_ARGUMENTS_INVALID', message, {
    status: 400,
    hint: 'Use a plain arithmetic expression such as (18 * 4) + 7.2.',
  });
}

function parse(expression: string): number {
  const tokens = tokenize(expression);
  let cursor = 0;

  const peek = (): Token | undefined => tokens[cursor];
  const consume = (): Token => {
    const token = tokens[cursor];
    if (!token) throw invalid('The expression ends before it is complete.');
    cursor += 1;
    return token;
  };
  const isOperator = (value: string): boolean => {
    const token = peek();
    return token?.type === 'operator' && token.value === value;
  };

  const primary = (): number => {
    const token = consume();
    if (token.type === 'number') return token.value;
    if (token.type === 'operator' && token.value === '(') {
      const value = sum();
      if (!isOperator(')')) throw invalid('A closing parenthesis is missing.');
      consume();
      return value;
    }
    throw invalid('Expected a number or an opening parenthesis.');
  };

  const power = (): number => {
    const base = primary();
    if (!isOperator('^')) return base;
    consume();
    const exponent = unary();
    const value = base ** exponent;
    if (!Number.isFinite(value) || Math.abs(value) > 1e12) {
      throw invalid('The result is outside the supported numeric range.');
    }
    return value;
  };

  const unary = (): number => {
    if (isOperator('+')) {
      consume();
      return unary();
    }
    if (isOperator('-')) {
      consume();
      return -unary();
    }
    return power();
  };

  const product = (): number => {
    let value = unary();
    while (isOperator('*') || isOperator('/') || isOperator('%')) {
      const operator = consume();
      if (operator.type !== 'operator') break;
      const right = unary();
      if ((operator.value === '/' || operator.value === '%') && right === 0) {
        throw invalid('Division by zero is not allowed.');
      }
      if (operator.value === '*') value *= right;
      if (operator.value === '/') value /= right;
      if (operator.value === '%') value %= right;
    }
    return value;
  };

  const sum = (): number => {
    let value = product();
    while (isOperator('+') || isOperator('-')) {
      const operator = consume();
      if (operator.type !== 'operator') break;
      const right = product();
      value = operator.value === '+' ? value + right : value - right;
    }
    return value;
  };

  if (tokens.length === 0) throw invalid('Enter an arithmetic expression.');
  const value = sum();
  if (cursor !== tokens.length) throw invalid('The expression contains unexpected characters.');
  if (!Number.isFinite(value) || Math.abs(value) > 1e12) {
    throw invalid('The result is outside the supported numeric range.');
  }
  return value;
}

export const calculationTool: AgentTool = {
  name: 'calculation.evaluate',
  label: 'Calculate an expression',
  description:
    'Evaluate a plain arithmetic expression with numbers, parentheses and + - * / % ^. It is a parser, not a code evaluator; variables and functions are rejected.',
  source: 'calculation',
  sourceLabel: 'Built-in calculation',
  permission: 'read',
  risk: 'low',
  requiresConfirmation: false,
  timeoutMs: 2_000,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      expression: {
        type: 'string',
        description: 'Arithmetic expression, for example (18 * 4) + 7.2.',
        maxLength: 200,
      },
    },
    required: ['expression'],
  },
  async execute(args) {
    const expression = String(args.expression ?? '').trim();
    if (!expression) {
      throw invalid('Enter an arithmetic expression.');
    }
    const result = parse(expression);
    return {
      summary: `Calculated ${expression} = ${result}`,
      data: { expression, result },
    };
  },
};
