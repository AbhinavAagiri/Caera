/**
 * CAERA shared contract.
 *
 * These modules intentionally export types only. Both the Vite client and the
 * Express node import them with `import type`, so nothing needs to resolve at
 * runtime and the local API contract stays a single source of truth.
 */

export type * from './agent.js';
export type * from './ai.js';
export type * from './api.js';
export type * from './activity.js';
export type * from './computer.js';
export type * from './connectors.js';
export type * from './conversations.js';
export type * from './knowledge.js';
export type * from './memory.js';
export type * from './permissions.js';
export type * from './system.js';
export type * from './voice.js';
