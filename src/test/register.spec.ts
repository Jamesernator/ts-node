import { once } from 'lodash';
import {
  contextTsNodeUnderTest,
  PROJECT,
  resetNodeEnvironment,
  TEST_DIR,
  tsNodeTypes,
} from './helpers';
import { context } from './testlib';
import { expect } from 'chai';
import * as exp from 'expect';
import { join, resolve } from 'path';
import proxyquire = require('proxyquire');

const SOURCE_MAP_REGEXP =
  /\/\/# sourceMappingURL=data:application\/json;charset=utf\-8;base64,[\w\+]+=*$/;

const createOptions: tsNodeTypes.CreateOptions = {
  project: PROJECT,
  compilerOptions: {
    jsx: 'preserve',
  },
};

const test = context(contextTsNodeUnderTest).context(
  once(async (t) => {
    return {
      moduleTestPath: resolve(__dirname, '../../tests/module.ts'),
      service: t.context.tsNodeUnderTest.create(createOptions),
    };
  })
);
test.beforeEach(async (t) => {
  // Un-install all hook and remove our test module from cache
  resetNodeEnvironment();
  delete require.cache[t.context.moduleTestPath];
  // Paranoid check that we are truly uninstalled
  exp(() => require(t.context.moduleTestPath)).toThrow(
    "Unexpected token 'export'"
  );
});
test.runSerially();

test('create() does not register()', async (t) => {
  // nyc sets its own `require.extensions` hooks; to truly detect if we're
  // installed we must attempt to load a TS file
  t.context.tsNodeUnderTest.create(createOptions);
  // This error indicates node attempted to run the code as .js
  exp(() => require(t.context.moduleTestPath)).toThrow(
    "Unexpected token 'export'"
  );
});

test('register(options) is shorthand for register(create(options))', (t) => {
  t.context.tsNodeUnderTest.register(createOptions);
  require(t.context.moduleTestPath);
});

test('register(service) registers a previously-created service', (t) => {
  t.context.tsNodeUnderTest.register(t.context.service);
  require(t.context.moduleTestPath);
});

test.suite('register(create(options))', (test) => {
  test.beforeEach(async (t) => {
    // Re-enable project for every test.
    t.context.service.enabled(true);
    t.context.tsNodeUnderTest.register(t.context.service);
    t.context.service.installSourceMapSupport();
  });

  test('should be able to require typescript', ({
    context: { moduleTestPath },
  }) => {
    const m = require(moduleTestPath);

    expect(m.example('foo')).to.equal('FOO');
  });

  test('should support dynamically disabling', ({
    context: { service, moduleTestPath },
  }) => {
    delete require.cache[moduleTestPath];

    expect(service.enabled(false)).to.equal(false);
    expect(() => require(moduleTestPath)).to.throw(/Unexpected token/);

    delete require.cache[moduleTestPath];

    expect(service.enabled()).to.equal(false);
    expect(() => require(moduleTestPath)).to.throw(/Unexpected token/);

    delete require.cache[moduleTestPath];

    expect(service.enabled(true)).to.equal(true);
    expect(() => require(moduleTestPath)).to.not.throw();

    delete require.cache[moduleTestPath];

    expect(service.enabled()).to.equal(true);
    expect(() => require(moduleTestPath)).to.not.throw();
  });

  test('should compile through js and ts', () => {
    const m = require('../../tests/complex');

    expect(m.example()).to.equal('example');
  });

  test('should work with proxyquire', () => {
    const m = proxyquire('../../tests/complex', {
      './example': 'hello',
    });

    expect(m.example()).to.equal('hello');
  });

  test('should work with `require.cache`', () => {
    const { example1, example2 } = require('../../tests/require-cache');

    expect(example1).to.not.equal(example2);
  });

  test('should use source maps', async () => {
    try {
      require('../../tests/throw error');
    } catch (error: any) {
      exp(error.stack).toMatch(
        [
          'Error: this is a demo',
          `    at Foo.bar (${join(TEST_DIR, './throw error.ts')}:100:17)`,
        ].join('\n')
      );
    }
  });

  test.suite('JSX preserve', (test) => {
    let compiled: string;

    test.beforeAll(async () => {
      const old = require.extensions['.tsx']!;
      require.extensions['.tsx'] = (m: any, fileName) => {
        const _compile = m._compile;

        m._compile = function (code: string, fileName: string) {
          compiled = code;
          return _compile.call(this, code, fileName);
        };

        return old(m, fileName);
      };
    });

    test('should use source maps', async (t) => {
      try {
        require('../../tests/with-jsx.tsx');
      } catch (error: any) {
        expect(error.stack).to.contain('SyntaxError: Unexpected token');
      }

      expect(compiled).to.match(SOURCE_MAP_REGEXP);
    });
  });
});

test('should support compiler scopes w/multiple registered compiler services at once', (t) => {
  const { moduleTestPath, tsNodeUnderTest } = t.context;
  const calls: string[] = [];

  const compilers = [
    tsNodeUnderTest.register({
      projectSearchDir: join(TEST_DIR, 'scope/a'),
      scopeDir: join(TEST_DIR, 'scope/a'),
      scope: true,
    }),
    tsNodeUnderTest.register({
      projectSearchDir: join(TEST_DIR, 'scope/a'),
      scopeDir: join(TEST_DIR, 'scope/b'),
      scope: true,
    }),
  ];

  compilers.forEach((c) => {
    const old = c.compile;
    c.compile = (code, fileName, lineOffset) => {
      calls.push(fileName);

      return old(code, fileName, lineOffset);
    };
  });

  try {
    expect(require('../../tests/scope/a').ext).to.equal('.ts');
    expect(require('../../tests/scope/b').ext).to.equal('.ts');
  } finally {
    compilers.forEach((c) => c.enabled(false));
  }

  expect(calls).to.deep.equal([
    join(TEST_DIR, 'scope/a/index.ts'),
    join(TEST_DIR, 'scope/b/index.ts'),
  ]);

  delete require.cache[moduleTestPath];

  expect(() => require(moduleTestPath)).to.throw();
});
