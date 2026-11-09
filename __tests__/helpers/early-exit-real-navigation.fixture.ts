import type React from 'react';

const path = jest.requireActual('node:path') as {
  dirname(value: string): string;
  resolve(...parts: string[]): string;
};
const babel = jest.requireActual('@babel/core') as {
  transformFileSync(
    file: string,
    options: object,
  ): { code?: string | null } | null;
};
const vm = jest.requireActual('node:vm') as {
  runInNewContext(code: string, context: Record<string, unknown>): void;
};
const { createRequire } = jest.requireActual('node:module') as {
  createRequire(filename: string): { resolve(id: string): string };
};
type FocusEffect = () => void | (() => void);
type Event = 'focus' | 'blur';
export interface TestNavigation {
  isFocused(): boolean;
  addListener(event: Event, listener: () => void): () => void;
  navigate: jest.Mock;
  goBack: jest.Mock;
}

// Execute the installed core modules, not a copied/simplified focus hook.
// Local transformation avoids broad changes to the application's Jest/Babel config.
const sourceRequire = createRequire(path.resolve('package.json'));
const core = path.dirname(
  sourceRequire.resolve('@react-navigation/core/package.json'),
);
const modules = [
  'useFocusEffect',
  'useNavigation',
  'NavigationContext',
  'NavigationContainerRefContext',
];
const cache = new Map<string, { exports: Record<string, unknown> }>();
function load(name: string): Record<string, unknown> {
  const prior = cache.get(name);
  if (prior) return prior.exports;
  if (!modules.includes(name))
    throw new Error(`Unexpected navigation fixture module: ${name}`);
  const compiled = babel.transformFileSync(
    path.resolve(core, 'src', `${name}.tsx`),
    {
      configFile: false,
      babelrc: false,
      presets: ['module:@react-native/babel-preset'],
      plugins: ['@babel/plugin-transform-modules-commonjs'],
    },
  );
  if (!compiled?.code)
    throw new Error(`Navigation source did not compile: ${name}`);
  const module = { exports: {} };
  cache.set(name, module);
  vm.runInNewContext(compiled.code, {
    module,
    exports: module.exports,
    require: (id: string) => {
      if (id === 'react') return jest.requireActual('react');
      if (id.startsWith('./')) return load(id.slice(2));
      throw new Error(`Unexpected runtime navigation dependency: ${id}`);
    },
    process: { env: { NODE_ENV: 'test' } },
    console,
  });
  return module.exports;
}
export const NavigationContext = load('NavigationContext')
  .NavigationContext as React.Context<TestNavigation | undefined>;
export const useFocusEffect = load('useFocusEffect').useFocusEffect as (
  effect: FocusEffect,
) => void;
export const useNavigation = load('useNavigation')
  .useNavigation as () => TestNavigation;

/** Control only navigation events/context; the actual hook owns cleanup semantics. */
export function createFocusNavigation() {
  let focused = true;
  const listeners = {
    focus: new Set<() => void>(),
    blur: new Set<() => void>(),
  };
  const navigation: TestNavigation = {
    isFocused: () => focused,
    addListener: (event, listener) => {
      listeners[event].add(listener);
      return () => {
        listeners[event].delete(listener);
      };
    },
    navigate: jest.fn(),
    goBack: jest.fn(),
  };
  return {
    navigation,
    blur: () => {
      focused = false;
      for (const listener of [...listeners.blur]) listener();
    },
    focus: () => {
      focused = true;
      for (const listener of [...listeners.focus]) listener();
    },
  };
}
