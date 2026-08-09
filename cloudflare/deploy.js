#!/usr/bin/env node

/**
 * DogNav Cloudflare 部署 — 兼容入口
 *
 * 唯一实现已移至仓库根目录 deploy.js（npm run deploy / deploy:cf 均指向它）。
 * 保留本文件仅为兼容 `node cloudflare/deploy.js` 的旧用法，不含业务逻辑。
 */

const { main } = require('../deploy.js');

main().catch(err => {
    console.error('\n✗ 部署失败:', err.message);
    process.exit(1);
});
