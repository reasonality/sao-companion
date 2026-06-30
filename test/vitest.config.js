// vitest 配置：为 E2E 测试提供 jsdom 环境 + ST 依赖别名
// E2E 测试 import index.js，而 index.js 顶层 import SillyTavern 运行时模块，
// 这些模块在 Node 测试环境不存在。通过 alias 将它们指向 mock 文件。
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

export default defineConfig({
    test: {
        environment: 'jsdom',
        include: ['**/*.{test,spec}.?(c|m)[jt]s?(x)'],
        server: {
            deps: {
                // 允许 index.js（在 test/ 之外）被 vitest 处理
                inline: [projectRoot],
            },
        },
    },
    resolve: {
        alias: {
            // index.js 的 ST 依赖映射到 mock 文件
            // 路径相对于 sao-companion/ 目录（index.js 所在）
            '../../../../script.js': resolve(__dirname, 'mocks/script.js'),
            '../../../extensions.js': resolve(__dirname, 'mocks/extensions.js'),
            '../../../events.js': resolve(__dirname, 'mocks/events.js'),
            '../../../../lib.js': resolve(__dirname, 'mocks/lib.js'),
            '../../../../../lib.js': resolve(__dirname, 'mocks/lib.js'),
            '../../../power-user.js': resolve(__dirname, 'mocks/power-user.js'),
        },
    },
});
