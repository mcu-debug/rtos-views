const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');
const minify = !watch || process.argv.includes('--minify');
const prod = process.env.NODE_ENV === 'production';

function onRebuildReport(pkg, error, result) {
    const ts = new Date().toLocaleString();
    if (error) {
        console.log(`${ts}: ${pkg}: watch build failed:` /*, error*/);
    } else {
        console.log(`${ts}: ${pkg}: watch build succeeded:`, result);
    }
}

// Build the editor provider
esbuild
    .build({
        entryPoints: ['src/extension.ts'],
        tsconfig: './tsconfig.json',
        bundle: true,
        external: ['vscode'],
        sourcemap: watch,
        minify: prod,
        watch: watch && {
            onRebuild(error, result) {
                onRebuildReport('Extension', error, result);
            }
        },
        platform: 'node',
        outfile: 'dist/extension.js'
    })
    .catch(() => process.exit(1));

esbuild
    .build({
        entryPoints: ['resources/rtos.js'],
        tsconfig: './tsconfig.json',
        bundle: true,
        external: ['vscode'],
        sourcemap: watch ? 'inline' : false,
        minify: prod,
        watch: watch && {
            onRebuild(error, result) {
                onRebuildReport('RTOS View', error, result);
            }
        },
        platform: 'browser',
        outfile: 'dist/rtos-view.js'
    })
    .catch(() => process.exit(1));
