// ═══════════════════════════════════════════
// Package Chrome Extension into .zip distribution
// ═══════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const extDir = path.join(rootDir, 'chrome-extension');
const distDir = path.join(rootDir, 'public/downloads');
const zipFile = path.join(distDir, 'dognav-chrome-extension.zip');

if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
}

if (fs.existsSync(zipFile)) {
    fs.unlinkSync(zipFile);
}

try {
    // Run zip command from within extension directory to ensure clean root in archive
    execSync(`cd "${extDir}" && zip -r "${zipFile}" . -x "*.DS_Store"`, { stdio: 'inherit' });
    const stat = fs.statSync(zipFile);
    console.log(`Successfully packaged extension: ${zipFile} (${(stat.size / 1024).toFixed(1)} KB)`);
} catch (err) {
    console.error('Failed to create extension zip:', err);
    process.exit(1);
}
