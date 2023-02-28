import * as vscode from 'vscode';
import { RTOSTracker } from './rtos/rtos';

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('mcu-debug.rtos-views.helloWorld', () => {
            vscode.window.showInformationMessage('Hello from rtos-views!');
        })
    );
    const rtosTracker = new RTOSTracker(context); // eslint-disable-line @typescript-eslint/no-unused-vars
}

export function deactivate() { } // eslint-disable-line @typescript-eslint/no-empty-function
