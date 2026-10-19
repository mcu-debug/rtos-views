
import { readFileSync } from 'fs';
import { execSync, spawn } from 'child_process';

let prog = '??';
let tagName = '';
let isDryRun = false;
let vsxAlso = false;
let vscePat = '';
let openVsxPat = '';

function errExit(...args) {
    console.error(`${prog}: Error:`, ...args);
    process.exit(1);
}

function ensureGitClean() {
    const gitStatus = execSync('git status --short')
        .toString()
        .trim();
    if (gitStatus) {
        errExit('Uncommitted changes exist. exiting. Cannot continue');
    }
}

function isPreRelease() {
    let obj;
    const path = './package.json';
    try {
        const txt = readFileSync(path);
        obj = JSON.parse(txt.toString());
    }
    catch (e) {
        errExit(`Could not open/read file ${path}`, e);
    }
    const version = obj.version;
    if (!version) {
        errExit(`"version" property not found in ${path}`);
    }
    const parts = version.split('.');
    const minor = parseInt(parts[1]);
    tagName = 'v' + version;
    return (minor % 2) === 1;
}

function vsceRun(pkgOnly) {
    const args = ['npx', 'vsce', (pkgOnly ? 'package' : 'publish')];
    if (isPreRelease()) {
        args.push('--pre-release');
        if (vsxAlso) {
            console.log(`${prog}: Note: Not publishing to open-vsx because this is a pre-release`);
            vsxAlso = false;
        }
    }
    if (!isDryRun && !pkgOnly) {
        ensureGitClean();
    }
    // eslint-disable-next-line @typescript-eslint/naming-convention
    runProg(args, { VSCE_PAT: vscePat }, (code) => {
        if (!pkgOnly && (code === 0)) {
            let gitCmd = ['git', 'tag', tagName];
            runProg(gitCmd, {}, (code) => {
                if (code === 0) {
                    gitCmd = ['git', 'push', 'origin', tagName];
                    runProg(gitCmd, {}, (code) => {
                        if (code !== 0) {
                            errExit(`Failed '${gitCmd}'`);
                        }
                    });
                } else {
                    errExit(`Failed '${gitCmd}'`);
                }
            });
            if (vsxAlso) {
                let vsxCmd = ['npx', 'ovsx', 'publish', '-p', openVsxPat];
                runProg(vsxCmd, {}, (code) => {
                    if (code !== 0) {
                        errExit(`Failed '${vsxCmd}'`);
                    }
                });
            }
        }
    });
}

function runProg(args, env, cb) {
    if (isDryRun) {
        args.unshift('echo');
    }
    // console.log('Executing ' + args.join(' '));
    const cmd = args.join(' ');
    const arg0 = args.shift();
    const prog = spawn(arg0, args, {
        stdio:'inherit',
        env: { ...process.env, ...env }
    });
    prog.on('error', (error) => {
        console.error(`Error running '${cmd}': ${error.message}`);
        if (cb) {
            cb(-1);
        }
    });
    prog.on('close', (code) => {
        if (!isDryRun) {
            console.log(`'${cmd}' ... exited with code ${code}`);
        }
        if (cb) {
            cb(code);
        }
    });
}

function run() {
    let isPkg = true;
    const argv = [...process.argv];
    prog = argv[1];
    argv.shift() ; argv.shift();
    while (argv.length) {
        switch (argv[0]) {
            case '-h':
            case '--help': {
                console.log(`Usage: node ${prog} [--dryrun] [--package] [--publish] [--vsx-also]`);
                console.log('\t--package is by default, true');
                process.exit(0);
                break;
            }
            case '--dryrun': {
                isDryRun = true;
                console.log(`${prog}: This is a dryrun`);
                break;
            }
            case '--package': {
                isPkg = true;
                break;
            }
            case '--publish': {
                isPkg = false;
                break;
            }
            case '--vsx-also': {
                vsxAlso = true;
                openVsxPat =  process.env.OPEN_VSX_PAT;
                if (!openVsxPat) {
                    errExit('Environment variable OPEN_VSX_PAT not found');
                }
                break;
            }
            default: {
                errExit(`Unknown argument '${argv[0]}'`);
                process.exit(1);
            }
        }
        argv.shift();
    }
    if (isPkg) {
        vsxAlso = false;
    } else {
        vscePat = process.env.VSCE_MD || '';
        if (!vscePat) {
            const msg = 'Environment variable VSCE_MD not set. It must contain the VS Code Marketplace PAT.';
            if (isDryRun) {
                console.log(`Warn: ${msg} (publish would fail here)`);
            } else {
                errExit(msg);
            }
        }
    }
    vsceRun(isPkg);
}

run();
