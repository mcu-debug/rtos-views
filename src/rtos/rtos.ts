import * as vscode from 'vscode';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as RTOSCommon from './rtos-common';
import { RTOSFreeRTOS } from './rtos-freertos';
import { RTOSUCOS2 } from './rtos-ucosii';
import { RTOSEmbOS } from './rtos-embos';
import { RTOSChibiOS } from './rtos-chibios';
import { RTOSZEPHYR } from './rtos-zephyr';

import {
    IDebugTracker,
    IDebuggerTrackerSubscribeArg,
    IDebuggerTrackerEvent,
    IDebuggerSubscription,
    OtherDebugEvents,
    DebugSessionStatus,
    DebugTracker,
} from 'debug-tracker-vscode';

// eslint-disable-next-line @typescript-eslint/naming-convention
export const TrackedDebuggers = [
    'cortex-debug',
    'cppdbg', // Microsoft debugger
    'cspy', // IAR debugger
];

let trackerApi: IDebugTracker;
let trackerApiClientInfo: IDebuggerSubscription;

const RTOS_TYPES = {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    FreeRTOS: RTOSFreeRTOS,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'uC/OS-II': RTOSUCOS2,
    embOS: RTOSEmbOS,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    ChibiOS: RTOSChibiOS,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    Zephyr: RTOSZEPHYR,
};

const defaultHtmlInfo: RTOSCommon.HtmlInfo = { html: '', css: '' };

export class RTOSSession {
    public lastFrameId: number | undefined;
    public htmlContent: RTOSCommon.HtmlInfo = defaultHtmlInfo;
    public rtos: RTOSCommon.RTOSBase | undefined; // The final RTOS
    private allRTOSes: RTOSCommon.RTOSBase[] = [];
    public triedAndFailed = false;

    constructor(public session: vscode.DebugSession) {
        this.lastFrameId = undefined;
        for (const rtosType of Object.values(RTOS_TYPES)) {
            this.allRTOSes.push(new rtosType(session));
        }
    }

    // This is the work horse. Do not call it if the panel is in disabled state.
    public async onStopped(frameId: number): Promise<void> {
        return new Promise<void>((resolve) => {
            this.lastFrameId = frameId;
            const doRefresh = () => {
                if (this.rtos) {
                    this.htmlContent.html =
                        '<p>RTOS Views: Failed to get RTOS information. Please report an issue if RTOS is actually running</p>\n';
                    this.htmlContent.css = '';
                    this.rtos.onStopped(frameId).then(() => {
                        this.htmlContent = this.rtos?.getHTML() || defaultHtmlInfo;
                        resolve();
                    });
                } else {
                    this.triedAndFailed = true;
                    this.htmlContent.html = '';
                    this.htmlContent.css = '';
                    resolve();
                }
            };

            if (this.rtos === undefined && this.allRTOSes.length > 0) {
                // Let them all work in parallel. Since this will generate a ton of gdb traffic and traffic from other sources
                // like variable, watch windows, things can fail. But our own backend queues things up so failures are unlikely
                // With some other backend (if for instance we support cppdbg), not sure what happens. Worst case, try one OS
                // at a time.
                const promises = [];
                for (const rtos of this.allRTOSes) {
                    promises.push(rtos.tryDetect(frameId));
                }

                Promise.all(promises).then((results) => {
                    for (const rtos of results) {
                        if (rtos.status === 'failed') {
                            const ix = this.allRTOSes.findIndex((v) => v === rtos);
                            this.allRTOSes.splice(ix, 1);
                            if (this.allRTOSes.length === 0) {
                                doRefresh();
                                break;
                            }
                        } else if (rtos.status === 'initialized') {
                            this.allRTOSes = [];
                            this.rtos = rtos;
                            doRefresh();
                            break;
                        }
                    }
                    if (this.allRTOSes.length > 0) {
                        // Some RTOSes have not finished detection
                        this.htmlContent.html = '<p>RTOS Views: RTOS detection in progress...</p>\n';
                        this.htmlContent.css = '';
                        resolve();
                    }
                });
            } else {
                doRefresh();
            }
        });
    }

    public onContinued(): void {
        this.lastFrameId = undefined;
        if (this.rtos) {
            this.rtos.onContinued();
        }
    }

    public onExited(): void {
        if (this.rtos) {
            this.rtos.onExited();
        }
        this.lastFrameId = undefined;
        this.rtos = undefined;
    }

    public updateUIElementState(debugSessionId: string, elementId: string, state: string): Promise<void> {
        if (this.rtos) {
            this.rtos.updateUIElementState(debugSessionId, elementId, state);
        }
        return new Promise<void>((r) => r());
    }

    public refresh(): Promise<void> {
        if (this.lastFrameId !== undefined) {
            return this.onStopped(this.lastFrameId);
        }
        return new Promise<void>((r) => r());
    }
}

interface DebugEventHandler {
    onStarted(session: vscode.DebugSession): void;
    onTerminated(session: vscode.DebugSession): void;
    onStopped(session: vscode.DebugSession, frameId: number | undefined): void;
    onContinued(session: vscode.DebugSession): void;
}

class MyDebugTracker {
    constructor(public context: vscode.ExtensionContext, protected handler: DebugEventHandler) {
        context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(this.settingsChanged.bind(this)));
        this.updateTrackedDebuggersFromSettings(false);
        this.subscribeToTracker();
    }

    public isActive() {
        return !!trackerApiClientInfo;
    }

    private subscribeToTracker(): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            DebugTracker.getTrackerExtension('rtos-views').then((ret) => {
                if (ret instanceof Error) {
                    vscode.window.showErrorMessage(ret.message);
                    resolve(false);
                } else {
                    trackerApi = ret;
                    const arg: IDebuggerTrackerSubscribeArg = {
                        version: 1,
                        body: {
                            debuggers: TrackedDebuggers,
                            handler: this.debugTrackerEventHandler.bind(this),
                            wantCurrentStatus: true,
                            notifyAllEvents: false,
                            // Make sure you set debugLevel to zero for production
                            debugLevel: 0,
                        },
                    };
                    const result = trackerApi.subscribe(arg);
                    if (typeof result === 'string') {
                        vscode.window.showErrorMessage(
                            `Subscription failed with extension 'debug-tracker-vscode' : ${result}`
                        );
                        resolve(false);
                    } else {
                        trackerApiClientInfo = result;
                        resolve(true);
                    }
                }
            });
        });
    }

    private settingsChanged(e: vscode.ConfigurationChangeEvent) {
        if (e.affectsConfiguration('mcu-debug.rtos-views.trackDebuggers')) {
            this.updateTrackedDebuggersFromSettings(true);
        }
    }

    private updateTrackedDebuggersFromSettings(prompt: boolean) {
        const config = vscode.workspace.getConfiguration('mcu-debug.rtos-views', null);
        const prop = config.get('trackDebuggers', []);
        if (prop && Array.isArray(prop)) {
            for (let ix = 0; ix < prop.length; ix++) {
                if (!TrackedDebuggers.includes(prop[ix])) {
                    TrackedDebuggers.push(prop[ix]);
                    // TODO: add debugger to the subscription dynamically. For now, we just notify user
                    if (prompt) {
                        vscode.window.showInformationMessage(
                            'Settings changed for tracked debuggers. You have to Reload this window for this to take effect'
                        );
                        prompt = false;
                    }
                }
            }
        }
    }

    static allSessions: { [sessionId: string]: vscode.DebugSession } = {};
    async debugTrackerEventHandler(event: IDebuggerTrackerEvent) {
        let session = event.session;
        if (DebugSessionStatus.Initializing !== event.event) {
            session = MyDebugTracker.allSessions[event.sessionId];
            if (!session) {
                // THis should not happen
                console.error('rtos-views: Could not find session ' + event.sessionId);
                return;
            }
        } else if (!session) {
            console.error('Initializing but no session info?');
            return;
        }
        switch (event.event) {
            case DebugSessionStatus.Initializing: {
                // Note that we can get initialized but never actually start the session due to errors
                // so, we wait until we actually get a Started event
                MyDebugTracker.allSessions[session.id] = session;
                break;
            }
            case DebugSessionStatus.Started: {
                this.handler.onStarted(session);
                break;
            }
            case OtherDebugEvents.FirstStackTrace: {
                // TODO Technically, we don't need the frameId any more but it won't hurt to wait a bit
                // until most of VSCode updates itself before we start queries
                const frameId =
                    (event.stackTrace &&
                        event.stackTrace.body.stackFrames &&
                        event.stackTrace.body.stackFrames[0].id) ||
                    undefined;
                this.handler.onStopped(session, frameId);
                break;
            }
            case DebugSessionStatus.Running: {
                this.handler.onContinued(session);
                break;
            }
            case OtherDebugEvents.Capabilities: {
                // Maybe we do something here
                break;
            }
            case DebugSessionStatus.Terminated: {
                delete MyDebugTracker.allSessions[event.sessionId];
                this.handler.onTerminated(session);
                break;
            }
        }
    }
}

export class RTOSTracker implements DebugEventHandler {
    private sessionMap: Map<string, RTOSSession> = new Map<string, RTOSSession>();
    private provider: RTOSViewProvider;
    private theTracker: MyDebugTracker;
    public enabled: boolean;
    public visible: boolean = false;

    constructor(private context: vscode.ExtensionContext) {
        this.provider = new RTOSViewProvider(context.extensionUri, this);
        this.theTracker = new MyDebugTracker(context, this);
        const config = vscode.workspace.getConfiguration('mcu-debug.rtos-views', null);

        this.enabled = config.get('showRTOS', true);
        RTOSCommon.RTOSBase.disableStackPeaks = config.get('disableStackPeaks', true);
        vscode.commands.executeCommand('setContext', 'mcu-debug.rtos-views:showRTOS', this.enabled);
        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider(RTOSViewProvider.viewType, this.provider),
            vscode.workspace.onDidChangeConfiguration(this.settingsChanged.bind(this)),
            vscode.commands.registerCommand('mcu-debug.rtos-views.toggleRTOSPanel', this.toggleRTOSPanel.bind(this)),
            vscode.commands.registerCommand('mcu-debug.rtos-views.refresh', this.update.bind(this))
        );
    }

    private settingsChanged(e: vscode.ConfigurationChangeEvent) {
        if (e.affectsConfiguration('mcu-debug.rtos-views.showRTOS')) {
            const config = vscode.workspace.getConfiguration('mcu-debug.rtos-views', null);
            this.enabled = config.get('showRTOS', true);
            vscode.commands.executeCommand('setContext', 'mcu-debug.rtos-views:showRTOS', this.enabled);
            if (this.enabled) {
                this.provider.showAndFocus();
            }
            this.update();
        }
        if (e.affectsConfiguration('mcu-debug.rtos-views.disableStackPeaks')) {
            const config = vscode.workspace.getConfiguration('mcu-debug.rtos-views', null);
            RTOSCommon.RTOSBase.disableStackPeaks = config.get('disableStackPeaks', false);
        }
    }

    public onStopped(session: vscode.DebugSession, frameId: number | undefined) {
        if (!frameId) {
            return;
        }
        for (const rtosSession of this.sessionMap.values()) {
            if (rtosSession.session.id === session.id) {
                rtosSession.lastFrameId = frameId;
                if (this.enabled && this.visible) {
                    rtosSession.onStopped(frameId).then(() => {
                        this.provider.updateHtml();
                    });
                }
            }
        }
    }

    public onContinued(session: vscode.DebugSession) {
        for (const rtosSession of this.sessionMap.values()) {
            if (rtosSession.session.id === session.id) {
                rtosSession.onContinued();
            }
        }
    }

    public onStarted(session: vscode.DebugSession) {
        this.sessionMap.set(session.id, new RTOSSession(session));
    }

    public onTerminated(session: vscode.DebugSession) {
        const s = this.sessionMap.get(session.id);
        if (s) {
            s.onExited();
            this.sessionMap.delete(session.id);
        }
    }

    // Only updates the RTOS state. Only debug sessions that are currently stopped will be updated
    public async updateRTOSInfo(): Promise<any> {
        const promises = [];
        if (this.enabled && this.visible) {
            for (const rtosSession of this.sessionMap.values()) {
                promises.push(rtosSession.refresh());
            }
        }
        return Promise.all(promises);
    }

    public async updateUIElementStateChange(debugSessionId: string, elementId: string, state: string): Promise<any> {
        const promises = [];
        if (this.enabled && this.visible) {
            for (const rtosSession of this.sessionMap.values()) {
                promises.push(rtosSession.updateUIElementState(debugSessionId, elementId, state));
            }
        }
        return Promise.all(promises);
    }

    public toggleRTOSPanel() {
        this.enabled = !this.enabled;
        this.updateRTOSPanelStatus(this.enabled);
    }

    private updateRTOSPanelStatus(v: boolean) {
        this.enabled = v;
        const config = vscode.workspace.getConfiguration('mcu-debug.rtos-views', null);
        config.update('showRTOS', this.enabled);
        vscode.commands.executeCommand('setContext', 'mcu-debug.rtos-views:showRTOS', this.enabled);
        if (this.enabled) {
            this.provider.showAndFocus();
        }
        this.update();
    }

    public notifyPanelDisposed() {
        this.visible = false;
    }

    public async visibilityChanged(v: boolean) {
        if (v !== this.visible) {
            this.visible = v;
            if (this.visible) {
                const msg = 'RTOS Views: Some sessions are busy. RTOS panel will be updated when session is paused';
                for (const rtosSession of this.sessionMap.values()) {
                    if (rtosSession.lastFrameId === undefined) {
                        if (msg) {
                            vscode.window.showInformationMessage(msg);
                            break;
                        }
                    }
                }
            }
            try {
                await this.update();
            } catch { }
        }
    }

    // Updates RTOS state and the Panel HTML
    private busyHtml: RTOSCommon.HtmlInfo | undefined;
    public update(): Promise<void> {
        return new Promise<void>((resolve) => {
            if (!this.enabled || !this.visible || !this.sessionMap.size) {
                resolve();
            }
            this.busyHtml = { html: /*html*/ '<h4>RTOS Views: Busy updating...</h4>\n', css: '' };
            this.provider.updateHtml();
            this.updateRTOSInfo().then(
                () => {
                    this.busyHtml = undefined;
                    this.provider.updateHtml();
                    resolve();
                },
                (_e) => {
                    this.busyHtml = undefined;
                    this.provider.updateHtml();
                    resolve();
                }
            );
        });
    }

    private lastGoodHtmlContent: RTOSCommon.HtmlInfo | undefined;
    public getHtml(): RTOSCommon.HtmlInfo {
        const ret: RTOSCommon.HtmlInfo = { html: '', css: '' };

        if (this.busyHtml) {
            return this.busyHtml;
        } else if (this.sessionMap.size === 0) {
            if (this.lastGoodHtmlContent) {
                return this.lastGoodHtmlContent;
            } else {
                ret.html = '<p>RTOS Views: No active/compatible debug sessions running.</p>\n';
                return ret;
            }
        } else if (!this.visible || !this.enabled) {
            ret.html = '<p>RTOS Views: Contents are not visible, so no html generated</p>\n';
            return ret;
        }

        for (const rtosSession of this.sessionMap.values()) {
            const name = `RTOS Views: Session Name: "${rtosSession.session.name}"`;
            if (!rtosSession.rtos) {
                const nameAndStatus = name + ' -- No RTOS detected';
                ret.html += /*html*/ `<h4>${nameAndStatus}</h4>\n`;
                if (rtosSession.triedAndFailed) {
                    const supported = Object.keys(RTOS_TYPES).join(', ');
                    ret.html +=
                        `<p>RTOS Views: Failed to match any supported RTOS. Supported RTOSes are (${supported}). ` +
                        'Please report issues and/or contribute code/knowledge to add your RTOS</p>\n';
                } else {
                    ret.html +=
                        /*html*/ '<p>RTOS Views: Try refreshing this panel. RTOS detection may be still in progress</p>\n';
                }
            } else {
                const nameAndStatus =
                    name +
                    ', ' +
                    rtosSession.rtos.name +
                    ' detected.' +
                    (!rtosSession.htmlContent ? ' (No data available yet)' : '');
                ret.html += /*html*/ `<h4>${nameAndStatus}</h4>\n` + rtosSession.htmlContent.html;
                ret.css = rtosSession.htmlContent.css;
            }
        }
        this.lastGoodHtmlContent = ret;
        return ret;
    }
}

class RTOSViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'rtos-views.rtos';
    private webviewView: vscode.WebviewView | undefined;

    constructor(private readonly extensionUri: vscode.Uri, private parent: RTOSTracker) { }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this.webviewView = webviewView;
        this.parent.visible = this.webviewView.visible;

        webviewView.webview.options = {
            // Allow scripts in the webview
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };
        this.webviewView.description = 'View RTOS internals';

        this.webviewView.onDidDispose((_e) => {
            this.webviewView = undefined;
            this.parent.notifyPanelDisposed();
        });

        this.webviewView.onDidChangeVisibility((_e) => {
            if (this.webviewView) {
                this.parent.visibilityChanged(this.webviewView.visible);
            }
        });

        this.updateHtml();

        webviewView.webview.onDidReceiveMessage((msg) => {
            switch (msg?.type) {
                case 'refresh': {
                    this.parent.update();
                    break;
                }
                case 'change': {
                    this.parent.updateUIElementStateChange(msg.debugSessionId, msg.elementId, msg.body);
                    break;
                }
            }
        });
    }

    public showAndFocus() {
        // The following does not require the webview to exist. It will be created if needed
        vscode.commands.executeCommand('rtos-views.rtos.focus');
        //
        // Following will toggle our panel. Why it is named like that, I don't know. It makes no mention of XRTOS
        // vscode.commands.executeCommand('workbench.view.extension.rtos-views');
    }

    public updateHtml() {
        if (this.webviewView) {
            this.webviewView.webview.html = this.getHtmlForWebview();
            // console.log(this.webviewView.webview.html);
        }
    }

    private getHtmlForWebview(): string {
        const webview = this.webviewView?.webview;
        if (!webview) {
            return '';
        }
        if (!this.parent.enabled) {
            return /*html*/ `
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <title>RTOS Threads</title>
                </head>
                <body>
                    <p>Currently disabled. Enable setting "mcu-debug.rtos-views.showRTOS" or use Command "RTOS Views: Toggle RTOS Panel" to see any RTOS info</p>
                </body>
                </html>`;
        }
        const toolkitUri = getUri(webview, this.extensionUri, [
            'node_modules',
            '@vscode',
            'webview-ui-toolkit',
            'dist',
            'toolkit.js',
        ]);
        // Get the local path to main script run in the webview, then convert it to a uri we can use in the webview.
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'rtos-view.js'));
        const rtosStyle = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'resources', 'rtos.css'));

        const htmlInfo = this.parent.getHtml();
        // Use a nonce to only allow a specific script to be run.
        const nonce = getNonce();
        const ret = /*html*/ `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <!--
                    Use a content security policy to only allow loading images from https or from our extension directory,
                    and only allow scripts that have a specific nonce.
                -->
                <meta http-equiv="Content-Security-Policy" content="default-src 'none';
                style-src 'nonce-${nonce}' ${webview.cspSource}; script-src 'nonce-${nonce}';">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${rtosStyle}" rel="stylesheet">
                <style nonce="${nonce}">
                ${htmlInfo.css}
                </style>
                <title>RTOS Threads</title>
            </head>
            <body>
                ${htmlInfo.html}
                <script type="module" nonce="${nonce}" src="${toolkitUri}"></script>
                <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
        writeHtmlToTmpDir(ret);
        return ret;
    }
}

function writeHtmlToTmpDir(str: string) {
    try {
        // eslint-disable-next-line no-constant-condition
        if (false) {
            const fname = path.join(os.tmpdir(), 'rtos.html');
            console.log(`Write HTML to file ${fname}`);
            fs.writeFileSync(fname, str);
        }
    } catch (e) {
        console.log(e ? e.toString() : 'unknown exception?');
    }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function appendMsgToTmpDir(str: string) {
    try {
        // eslint-disable-next-line no-constant-condition
        if (false) {
            const fname = path.join(os.tmpdir(), 'rtos-msgs.txt');
            console.log(`Write ${str} to file ${fname}`);
            if (!str.endsWith('\n')) {
                str = str + '\n';
            }
            fs.appendFileSync(fname, str);
        }
    } catch (e) {
        console.log(e ? e.toString() : 'unknown exception?');
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

export function getUri(webview: vscode.Webview, extensionUri: vscode.Uri, pathList: string[]) {
    return webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, ...pathList));
}
