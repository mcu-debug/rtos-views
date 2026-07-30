import * as vscode from 'vscode';
import { RTOSTracker } from './rtos/rtos';

export interface RTOSViewsAPI {
    /** Register an additional debug adapter type to be tracked by RTOS Views. */
    addDebugType(debugType: string): void;
}

export function activate(context: vscode.ExtensionContext): RTOSViewsAPI {
    context.subscriptions.push(
        vscode.commands.registerCommand('mcu-debug.rtos-views.helloWorld', () => {
            vscode.window.showInformationMessage('Hello from rtos-views!');
        })
    );
    const rtosTracker = new RTOSTracker(context);
    return {
        addDebugType: (debugType: string) => rtosTracker.addDebugType(debugType),
    };
}

export function deactivate() { } // eslint-disable-line @typescript-eslint/no-empty-function
