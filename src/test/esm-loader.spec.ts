// ESM loader hook tests
// TODO: at the time of writing, other ESM loader hook tests have not been moved into this file.
// Should consolidate them here.

import { context } from './testlib';
import semver = require('semver');
import {
  BIN_PATH,
  CMD_ESM_LOADER_WITHOUT_PROJECT,
  CMD_TS_NODE_WITHOUT_PROJECT_FLAG,
  contextTsNodeUnderTest,
  EXPERIMENTAL_MODULES_FLAG,
  nodeSupportsEsmHooks,
  nodeSupportsImportAssertions,
  nodeUsesNewHooksApi,
  resetNodeEnvironment,
  TEST_DIR,
} from './helpers';
import { createExec } from './exec-helpers';
import { join, resolve } from 'path';
import * as expect from 'expect';
import type { NodeLoaderHooksAPI2 } from '../';
import { pathToFileURL } from 'url';

const test = context(contextTsNodeUnderTest);

const exec = createExec({
  cwd: TEST_DIR,
});

test.suite('esm', (test) => {
  test.suite('when node supports loader hooks', (test) => {
    test.runIf(nodeSupportsEsmHooks);
    test('should compile and execute as ESM', async () => {
      const { err, stdout } = await exec(
        `${CMD_ESM_LOADER_WITHOUT_PROJECT} index.ts`,
        {
          cwd: join(TEST_DIR, './esm'),
        }
      );
      expect(err).toBe(null);
      expect(stdout).toBe('foo bar baz biff libfoo\n');
    });
    test('should use source maps', async () => {
      const { err, stdout } = await exec(
        `${CMD_ESM_LOADER_WITHOUT_PROJECT} "throw error.ts"`,
        {
          cwd: join(TEST_DIR, './esm'),
        }
      );
      expect(err).not.toBe(null);
      expect(err!.message).toMatch(
        [
          `${pathToFileURL(join(TEST_DIR, './esm/throw error.ts'))
            .toString()
            .replace(/%20/g, ' ')}:100`,
          "  bar() { throw new Error('this is a demo'); }",
          '                ^',
          'Error: this is a demo',
        ].join('\n')
      );
    });

    test.suite('supports experimental-specifier-resolution=node', (test) => {
      test('via --experimental-specifier-resolution', async () => {
        const { err, stdout } = await exec(
          `${CMD_ESM_LOADER_WITHOUT_PROJECT} --experimental-specifier-resolution=node index.ts`,
          { cwd: join(TEST_DIR, './esm-node-resolver') }
        );
        expect(err).toBe(null);
        expect(stdout).toBe('foo bar baz biff libfoo\n');
      });
      test('via --es-module-specifier-resolution alias', async () => {
        const { err, stdout } = await exec(
          `${CMD_ESM_LOADER_WITHOUT_PROJECT} ${EXPERIMENTAL_MODULES_FLAG} --es-module-specifier-resolution=node index.ts`,
          { cwd: join(TEST_DIR, './esm-node-resolver') }
        );
        expect(err).toBe(null);
        expect(stdout).toBe('foo bar baz biff libfoo\n');
      });
      test('via NODE_OPTIONS', async () => {
        const { err, stdout } = await exec(
          `${CMD_ESM_LOADER_WITHOUT_PROJECT} index.ts`,
          {
            cwd: join(TEST_DIR, './esm-node-resolver'),
            env: {
              ...process.env,
              NODE_OPTIONS: `${EXPERIMENTAL_MODULES_FLAG} --experimental-specifier-resolution=node`,
            },
          }
        );
        expect(err).toBe(null);
        expect(stdout).toBe('foo bar baz biff libfoo\n');
      });
    });

    test('throws ERR_REQUIRE_ESM when attempting to require() an ESM script when ESM loader is enabled', async () => {
      const { err, stderr } = await exec(
        `${CMD_ESM_LOADER_WITHOUT_PROJECT} ./index.js`,
        {
          cwd: join(TEST_DIR, './esm-err-require-esm'),
        }
      );
      expect(err).not.toBe(null);
      expect(stderr).toMatch(
        'Error [ERR_REQUIRE_ESM]: Must use import to load ES Module:'
      );
    });

    test('defers to fallback loaders when URL should not be handled by ts-node', async () => {
      const { err, stdout, stderr } = await exec(
        `${CMD_ESM_LOADER_WITHOUT_PROJECT} index.mjs`,
        {
          cwd: join(TEST_DIR, './esm-import-http-url'),
        }
      );
      expect(err).not.toBe(null);
      // expect error from node's default resolver
      expect(stderr).toMatch(
        /Error \[ERR_UNSUPPORTED_ESM_URL_SCHEME\]:.*(?:\n.*){0,2}\n *at defaultResolve/
      );
    });

    test('should bypass import cache when changing search params', async () => {
      const { err, stdout } = await exec(
        `${CMD_ESM_LOADER_WITHOUT_PROJECT} index.ts`,
        {
          cwd: join(TEST_DIR, './esm-import-cache'),
        }
      );
      expect(err).toBe(null);
      expect(stdout).toBe('log1\nlog2\nlog2\n');
    });

    test('should support transpile only mode via dedicated loader entrypoint', async () => {
      const { err, stdout } = await exec(
        `${CMD_ESM_LOADER_WITHOUT_PROJECT}/transpile-only index.ts`,
        {
          cwd: join(TEST_DIR, './esm-transpile-only'),
        }
      );
      expect(err).toBe(null);
      expect(stdout).toBe('');
    });
    test('should throw type errors without transpile-only enabled', async () => {
      const { err, stdout } = await exec(
        `${CMD_ESM_LOADER_WITHOUT_PROJECT} index.ts`,
        {
          cwd: join(TEST_DIR, './esm-transpile-only'),
        }
      );
      if (err === null) {
        throw new Error('Command was expected to fail, but it succeeded.');
      }

      expect(err.message).toMatch('Unable to compile TypeScript');
      expect(err.message).toMatch(
        new RegExp(
          "TS2345: Argument of type '(?:number|1101)' is not assignable to parameter of type 'string'\\."
        )
      );
      expect(err.message).toMatch(
        new RegExp(
          "TS2322: Type '(?:\"hello world\"|string)' is not assignable to type 'number'\\."
        )
      );
      expect(stdout).toBe('');
    });

    test.suite('moduleTypes', (test) => {
      suite('with vanilla ts transpilation', 'tsconfig.json');
      suite('with third-party-transpiler', 'tsconfig-swc.json');
      function suite(name: string, tsconfig: string) {
        test.suite(name, (test) => {
          test('supports CJS webpack.config.ts in an otherwise ESM project', async (t) => {
            // A notable case where you can use ts-node's CommonJS loader, not the ESM loader, in an ESM project:
            // when loading a webpack.config.ts or similar config
            const { err, stdout } = await exec(
              `${CMD_TS_NODE_WITHOUT_PROJECT_FLAG} --project ./module-types/override-to-cjs/${tsconfig} ./module-types/override-to-cjs/test-webpack-config.cjs`
            );
            expect(err).toBe(null);
            expect(stdout).toBe(``);
          });
          test('should allow importing CJS in an otherwise ESM project', async (t) => {
            await run('override-to-cjs', tsconfig, 'cjs');
            if (semver.gte(process.version, '14.13.1'))
              await run('override-to-cjs', tsconfig, 'mjs');
          });
          test('should allow importing ESM in an otherwise CJS project', async (t) => {
            await run('override-to-esm', tsconfig, 'cjs');
            // Node 14.13.0 has a bug(?) where it checks for ESM-only syntax *before* we transform the code.
            if (semver.gte(process.version, '14.13.1'))
              await run('override-to-esm', tsconfig, 'mjs');
          });
        });
      }
      async function run(project: string, config: string, ext: string) {
        const { err, stderr, stdout } = await exec(
          `${CMD_ESM_LOADER_WITHOUT_PROJECT} ./module-types/${project}/test.${ext}`,
          {
            env: {
              ...process.env,
              TS_NODE_PROJECT: `./module-types/${project}/${config}`,
            },
          }
        );
        expect(err).toBe(null);
        expect(stdout).toBe(`Failures: 0\n`);
      }
    });

    test.suite('createEsmHooks()', (test) => {
      test('should create proper hooks with provided instance', async () => {
        const { err } = await exec(
          `node ${EXPERIMENTAL_MODULES_FLAG} --loader ./loader.mjs index.ts`,
          {
            cwd: join(TEST_DIR, './esm-custom-loader'),
          }
        );

        if (err === null) {
          throw new Error('Command was expected to fail, but it succeeded.');
        }

        expect(err.message).toMatch(/TS6133:\s+'unusedVar'/);
      });
    });

    test.suite('unit test hooks', (_test) => {
      const test = _test.context(async (t) => {
        const service = t.context.tsNodeUnderTest.create({
          cwd: TEST_DIR,
        });
        t.teardown(() => {
          resetNodeEnvironment();
        });
        return {
          service,
          hooks: t.context.tsNodeUnderTest.createEsmHooks(service),
        };
      });

      test.suite('data URIs', (test) => {
        test.runIf(nodeUsesNewHooksApi);

        test('Correctly determines format of data URIs', async (t) => {
          const { hooks } = t.context;
          const url = 'data:text/javascript,console.log("hello world");';
          const result = await (hooks as NodeLoaderHooksAPI2).load(
            url,
            { format: undefined },
            async (url, context, _ignored) => {
              return { format: context.format!, source: '' };
            }
          );
          expect(result.format).toBe('module');
        });
      });
    });

    test.suite('supports import assertions', (test) => {
      test.runIf(nodeSupportsImportAssertions);

      test.suite('node >=17.5.0', (test) => {
        test.runIf(semver.gte(process.version, '17.5.0'));

        test('Can import JSON modules with appropriate assertion', async (t) => {
          const { err, stdout } = await exec(
            `${CMD_ESM_LOADER_WITHOUT_PROJECT} ./importJson.ts`,
            {
              cwd: resolve(TEST_DIR, 'esm-import-assertions'),
            }
          );
          expect(err).toBe(null);
          expect(stdout.trim()).toBe(
            'A fuchsia car has 2 seats and the doors are open.\nDone!'
          );
        });
      });

      test.suite('node <17.5.0', (test) => {
        test.runIf(semver.lt(process.version, '17.5.0'));

        test('Can import JSON using the appropriate flag and assertion', async (t) => {
          const { err, stdout } = await exec(
            `${CMD_ESM_LOADER_WITHOUT_PROJECT} --experimental-json-modules ./importJson.ts`,
            {
              cwd: resolve(TEST_DIR, 'esm-import-assertions'),
            }
          );
          expect(err).toBe(null);
          expect(stdout.trim()).toBe(
            'A fuchsia car has 2 seats and the doors are open.\nDone!'
          );
        });
      });
    });

    test.suite(
      'Entrypoint resolution falls back to CommonJS resolver and format',
      (test) => {
        test('extensionless entrypoint', async (t) => {
          const { err, stdout } = await exec(
            `${CMD_ESM_LOADER_WITHOUT_PROJECT} ./esm-loader-entrypoint-cjs-fallback/extensionless-entrypoint`
          );
          expect(err).toBe(null);
          expect(stdout.trim()).toBe('Hello world!');
        });
        test('relies upon CommonJS resolution', async (t) => {
          const { err, stdout } = await exec(
            `${CMD_ESM_LOADER_WITHOUT_PROJECT} ./esm-loader-entrypoint-cjs-fallback/relies-upon-cjs-resolution`
          );
          expect(err).toBe(null);
          expect(stdout.trim()).toBe('Hello world!');
        });
        test('fails as expected when entrypoint does not exist at all', async (t) => {
          const { err, stderr } = await exec(
            `${CMD_ESM_LOADER_WITHOUT_PROJECT} ./esm-loader-entrypoint-cjs-fallback/does-not-exist`
          );
          expect(err).toBeDefined();
          expect(stderr).toContain(`Cannot find module `);
        });
      }
    );
  });

  test.suite('node >= 12.x.x', (test) => {
    test.runIf(semver.gte(process.version, '12.0.0'));
    test('throws ERR_REQUIRE_ESM when attempting to require() an ESM script when ESM loader is *not* enabled and node version is >= 12', async () => {
      // Node versions >= 12 support package.json "type" field and so will throw an error when attempting to load ESM as CJS
      const { err, stderr } = await exec(`${BIN_PATH} ./index.js`, {
        cwd: join(TEST_DIR, './esm-err-require-esm'),
      });
      expect(err).not.toBe(null);
      expect(stderr).toMatch(
        'Error [ERR_REQUIRE_ESM]: Must use import to load ES Module:'
      );
    });
  });
  test.suite('node < 12.x.x', (test) => {
    test.runIf(semver.lt(process.version, '12.0.0'));
    test('Loads as CommonJS when attempting to require() an ESM script when ESM loader is *not* enabled and node version is < 12', async () => {
      // Node versions less than 12 do not support package.json "type" field and so will load ESM as CommonJS
      const { err, stdout } = await exec(`${BIN_PATH} ./index.js`, {
        cwd: join(TEST_DIR, './esm-err-require-esm'),
      });
      expect(err).toBe(null);
      expect(stdout).toMatch('CommonJS');
    });
  });
});

test.suite("Catch unexpected changes to node's loader context", (test) => {
  // loader context includes import assertions, therefore this test requires support for import assertions
  test.runIf(nodeSupportsImportAssertions);

  /*
   * This does not test ts-node.
   * Rather, it is meant to alert us to potentially breaking changes in node's
   * loader API.  If node starts returning more or less properties on `context`
   * objects, we want to know, because it may indicate that our loader code
   * should be updated to accomodate the new properties, either by proxying them,
   * modifying them, or suppressing them.
   */
  test('Ensure context passed to loader by node has only expected properties', async (t) => {
    const { stdout, stderr } = await exec(
      `node --loader ./esm-loader-context/loader.mjs --experimental-json-modules ./esm-loader-context/index.mjs`
    );
    const rows = stdout.split('\n').filter((v) => v[0] === '{');
    expect(rows.length).toBe(14);
    rows.forEach((row) => {
      const json = JSON.parse(row) as {
        resolveContextKeys?: string[];
        loadContextKeys?: string;
      };
      if (json.resolveContextKeys) {
        expect(json.resolveContextKeys).toEqual([
          'conditions',
          'importAssertions',
          'parentURL',
        ]);
      } else if (json.loadContextKeys) {
        try {
          expect(json.loadContextKeys).toEqual(['format', 'importAssertions']);
        } catch (e) {
          // HACK for https://github.com/TypeStrong/ts-node/issues/1641
          if (process.version.includes('nightly')) {
            expect(json.loadContextKeys).toEqual([
              'format',
              'importAssertions',
              'parentURL',
            ]);
          } else {
            throw e;
          }
        }
      } else {
        throw new Error('Unexpected stdout in test.');
      }
    });
  });
});
