/**
 * 构建脚本 - 生成 .xpi 安装包
 * 使用方法: npm run build 或 npm run zip
 */

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const PLUGIN_NAME = 'deepread';
const VERSION = require('./package.json').version;
const OUTPUT_FILE = `${PLUGIN_NAME}-v${VERSION}.xpi`;

// 需要包含的文件和目录
const FILES_TO_INCLUDE = [
    'manifest.json',
    'bootstrap.js',
    'deepread.js',
    'prefs.js',
    'pref.xhtml',
    'providers/',
    'locale/',
    'images/'
];

// 需要排除的文件和目录
const FILES_TO_EXCLUDE = [
    'node_modules',
    '.git',
    '.gitignore',
    'build.js',
    'package.json',
    'package-lock.json',
    '*.xpi',
    '.DS_Store',
    'Thumbs.db'
];

function shouldExclude(filePath) {
    const relativePath = path.relative(process.cwd(), filePath);
    return FILES_TO_EXCLUDE.some(pattern => {
        if (pattern.includes('*')) {
            const regex = new RegExp(pattern.replace(/\*/g, '.*'));
            return regex.test(relativePath);
        }
        return relativePath.includes(pattern);
    });
}

function addDirectory(archive, dirPath, basePath = '') {
    const files = fs.readdirSync(dirPath);

    files.forEach(file => {
        const fullPath = path.join(dirPath, file);
        const relativePath = path.join(basePath, file);

        if (shouldExclude(fullPath)) {
            return;
        }

        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            addDirectory(archive, fullPath, relativePath);
        } else {
            archive.file(fullPath, { name: relativePath });
        }
    });
}

function buildXPI() {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(OUTPUT_FILE);
        const archive = archiver('zip', {
            zlib: { level: 9 }
        });

        output.on('close', () => {
            console.log(`✅ 构建完成: ${OUTPUT_FILE}`);
            console.log(`   文件大小: ${(archive.pointer() / 1024).toFixed(2)} KB`);
            resolve();
        });

        archive.on('error', (err) => {
            reject(err);
        });

        archive.pipe(output);

        // 添加文件
        FILES_TO_INCLUDE.forEach(item => {
            const itemPath = path.join(process.cwd(), item);

            if (!fs.existsSync(itemPath)) {
                console.warn(`⚠️  警告: 文件/目录不存在: ${item}`);
                return;
            }

            const stat = fs.statSync(itemPath);

            if (stat.isDirectory()) {
                addDirectory(archive, itemPath, item);
            } else {
                archive.file(itemPath, { name: item });
            }
        });

        archive.finalize();
    });
}

// 执行构建
buildXPI().catch(err => {
    console.error('❌ 构建失败:', err);
    process.exit(1);
});

