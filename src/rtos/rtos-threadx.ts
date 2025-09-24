/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from 'vscode';
import * as RTOSCommon from './rtos-common';

type ThreadState =
    | 'TX_READY'
    | 'TX_COMPLETED'
    | 'TX_TERMINATED'
    | 'TX_SUSPENDED'
    | 'TX_SLEEP'
    | 'TX_QUEUE_SUSP'
    | 'TX_SEMAPHORE_SUSP'
    | 'TX_EVENT_FLAG'
    | 'TX_BLOCK_MEMORY'
    | 'TX_BYTE_MEMORY'
    | 'TX_IO_DRIVER'
    | 'TX_FILE'
    | 'TX_TCP_IP'
    | 'TX_MUTEX_SUSP'
    | 'TX_PRIORITY_CHANGE'
    | 'Unknown';

const ThreadTableItems: { [key: string]: RTOSCommon.DisplayColumnItem } = {
    name: {
        width: 2,
        headerRow1: 'Thread',
        headerRow2: 'Name',
    },
    address: {
        width: 2,
        headerRow1: '',
        headerRow2: 'Address',
    },
    state: {
        width: 2,
        headerRow1: '',
        headerRow2: 'State',
    },
    priority: {
        width: 1,
        headerRow1: '',
        headerRow2: 'Priority',
        colType: RTOSCommon.ColTypeEnum.colTypeNumeric,
        colGapAfter: 1,
    },
    stack: {
        width: 4,
        headerRow1: 'Stack',
        headerRow2: 'Usage',
        colType: RTOSCommon.ColTypeEnum.colTypePercentage,
    },
};

const ThreadTableItemNames: string[] = Object.keys(ThreadTableItems);

export class RTOSThreadX extends RTOSCommon.RTOSBase {
    private threadCreatedCount: RTOSCommon.RTOSVarHelperMaybe;

    private threads: RTOSCommon.RTOSThreadInfo[] = [];

    constructor(public session: vscode.DebugSession) {
        super(session, 'ThreadX');
    }

    public async tryDetect(useFrameId: number): Promise<RTOSCommon.RTOSBase> {
        this.progStatus = 'stopped';
        try {
            if (this.status === 'none') {
                this.threadCreatedCount = await this.getVarIfEmpty(
                    this.threadCreatedCount,
                    useFrameId,
                    '_tx_thread_created_count',
                    false
                );

                this.status = 'initialized';
            }
            return this;
        } catch (e) {
            if (e instanceof RTOSCommon.ShouldRetry) {
                console.error(e.message);
            } else {
                this.status = 'failed';
                this.failedWhy = e;
            }
            return this;
        }
    }

    public refresh(frameId: number): Promise<void> {
        return new Promise<void>((resolve) => {
            if (this.progStatus !== 'stopped') {
                resolve();
                return;
            }

            this.threadCreatedCount?.getValue(frameId).then(
                async (str) => {
                    try {
                        const numThreads = parseInt(str ?? '') || 0;
                        await this.getThreadInfo(numThreads, frameId);
                        resolve();
                    } catch (e) {
                        resolve();
                        console.error('RTOSThreadX.refresh() failed: ', e);
                    }
                },
                (reason) => {
                    resolve();
                    console.error('RTOSThreadX.refresh() failed: ', reason);
                }
            );
        });
    }

    public getHTML(): RTOSCommon.HtmlInfo {
        const htmlContent: RTOSCommon.HtmlInfo = { html: '', css: '' };

        const htmlThreads = this.getHTMLThreads(ThreadTableItemNames, ThreadTableItems, this.threads, '');

        htmlContent.html = htmlThreads.html;
        htmlContent.css = htmlThreads.css;

        return htmlContent;
    }

    private async getThreadInfo(numThreads: number, frameId: number): Promise<void> {
        const threads: RTOSCommon.RTOSThreadInfo[] = [];

        const current = (await this.getExprVal('_tx_thread_current_ptr', frameId)) ?? undefined;
        let address = (await this.getExprVal('_tx_thread_created_ptr', frameId)) ?? '';

        let thread: RTOSCommon.RTOSStrToValueMap | undefined = await this.getExprValChildrenObj(
            '_tx_thread_created_ptr',
            frameId
        );

        for (let i = 0; i < numThreads && thread !== undefined; i++) {
            const name = this.stringFromCharPointer(thread['tx_thread_name']?.val);
            const state = this.threadState(parseInt(thread['tx_thread_state']?.val));
            const priority = thread['tx_thread_priority']?.val ?? '?';

            const stackInfo = this.getStackInfo(thread);
            let stackUsedText: string | undefined = '?';
            let stackUsedPercent: number | undefined = undefined;
            if (stackInfo.stackUsed !== undefined && stackInfo.stackSize !== undefined) {
                stackUsedText = `${stackInfo.stackUsed} / ${stackInfo.stackSize}`;
                stackUsedPercent = Math.round((stackInfo.stackUsed / stackInfo.stackSize) * 100);
            }

            const addressHexString = RTOSCommon.hexFormat(parseInt(address));
            const running = address === current;

            threads.push({
                display: {
                    name: { text: name },
                    address: { text: addressHexString },
                    state: { text: state },
                    priority: { text: priority },
                    stack: { text: stackUsedText, value: stackUsedPercent },
                },
                stackInfo,
                running,
            });

            const next = thread['tx_thread_created_next'];
            address = next?.val ?? '';
            thread = (await this.getVarChildrenObj(next?.ref ?? NaN, 'next thread')) ?? undefined;
        }

        this.threads = threads;
    }

    private getStackInfo(thread: RTOSCommon.RTOSStrToValueMap): RTOSCommon.RTOSStackInfo {
        const stackStart = parseInt(thread['tx_thread_stack_start']?.val ?? '') || 0;
        const stackEnd = parseInt(thread['tx_thread_stack_end']?.val ?? '') || undefined;
        const stackCurrent = parseInt(thread['tx_thread_stack_ptr']?.val ?? '') || undefined;
        const stackSize = parseInt(thread['tx_thread_stack_size']?.val ?? '') || undefined;

        let stackUsed: number | undefined = undefined;
        if (stackCurrent !== undefined && stackEnd !== undefined) {
            stackUsed = stackEnd - stackCurrent + 1;
        }

        return { stackStart, stackEnd, stackUsed, stackSize };
    }

    private threadState(state: number): ThreadState {
        switch (state) {
            case 0:
                return 'TX_READY';
            case 1:
                return 'TX_COMPLETED';
            case 2:
                return 'TX_TERMINATED';
            case 3:
                return 'TX_SUSPENDED';
            case 4:
                return 'TX_SLEEP';
            case 5:
                return 'TX_QUEUE_SUSP';
            case 6:
                return 'TX_SEMAPHORE_SUSP';
            case 7:
                return 'TX_EVENT_FLAG';
            case 8:
                return 'TX_BLOCK_MEMORY';
            case 9:
                return 'TX_BYTE_MEMORY';
            case 10:
                return 'TX_IO_DRIVER';
            case 11:
                return 'TX_FILE';
            case 12:
                return 'TX_TCP_IP';
            case 13:
                return 'TX_MUTEX_SUSP';
            case 14:
                return 'TX_PRIORITY_CHANGE';

            default:
                return 'Unknown';
        }
    }

    private stringFromCharPointer(name: string | undefined): string {
        if (name === undefined) {
            return '?';
        }
        const pattern = /^.*"(.*)"$/;
        return pattern.exec(name)?.at(1) ?? '?';
    }
}
