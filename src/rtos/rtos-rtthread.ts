/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from 'vscode';
import { DebugProtocol } from '@vscode/debugprotocol';
import * as RTOSCommon from './rtos-common';

type ThreadState =
    | 'INITIALIZED'
    | 'CLOSED'
    | 'READY'
    | 'RUNNING'
    | 'SUSPENDED'
    | 'SUSPENDED (KILLABLE)'
    | 'SUSPENDED (UNINTERRUPTIBLE)'
    | 'UNKNOWN';

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
        headerRow1: 'Priority',
        headerRow2: 'Current / Init',
        colType: RTOSCommon.ColTypeEnum.colTypeNumeric,
    },
    tick: {
        width: 1,
        headerRow1: 'Time Slice',
        headerRow2: 'Remain / Init',
        colType: RTOSCommon.ColTypeEnum.colTypeNumeric,
    },
    error: {
        width: 1,
        headerRow1: '',
        headerRow2: 'Error',
        colType: RTOSCommon.ColTypeEnum.colTypeNumeric,
        colGapAfter: 1,
    },
    stack: {
        width: 4,
        headerRow1: 'Stack',
        headerRow2: 'Current Usage',
        colType: RTOSCommon.ColTypeEnum.colTypePercentage,
    },
    stackPeak: {
        width: 4,
        headerRow1: 'Stack',
        headerRow2: 'Peak Usage',
        colType: RTOSCommon.ColTypeEnum.colTypePercentage,
    },
};

const ThreadTableItemNames = Object.keys(ThreadTableItems);

/**
 * RT-Thread thread view.
 *
 * Threads are discovered through the kernel object container instead of a
 * firmware-side helper table. Member offsets are resolved by the debugger,
 * so the provider follows the exact layout described by the ELF debug info.
 */
export class RTOSRTThread extends RTOSCommon.RTOSBase {
    private static readonly MAX_THREADS = 256;
    private static readonly MAX_STACK_READ = 16 * 1024 * 1024;

    private containerSymbol = '';
    private hasSchedulerContext = true;
    private listHead: RTOSCommon.RTOSVarHelperMaybe;
    private objectListOffset: RTOSCommon.RTOSVarHelperMaybe;
    private currentThread: RTOSCommon.RTOSVarHelperMaybe;
    private threads: RTOSCommon.RTOSThreadInfo[] = [];
    private timeInfo = '';

    constructor(public session: vscode.DebugSession) {
        super(session, 'RT-Thread');
    }

    public async tryDetect(useFrameId: number): Promise<RTOSCommon.RTOSBase> {
        this.progStatus = 'stopped';
        try {
            if (this.status !== 'none') {
                return this;
            }

            const modernListHead = await this.getVarIfEmpty(
                undefined,
                useFrameId,
                '&_object_container[0].object_list',
                true,
            );
            if (modernListHead) {
                this.containerSymbol = '_object_container';
                this.listHead = modernListHead;
            } else {
                const legacyListHead = await this.getVarIfEmpty(
                    undefined,
                    useFrameId,
                    '&rt_object_container[0].object_list',
                    true,
                );
                if (!legacyListHead) {
                    throw new Error('RT-Thread object container was not found');
                }
                this.containerSymbol = 'rt_object_container';
                this.listHead = legacyListHead;
            }

            this.objectListOffset = await this.getVarIfEmpty(
                this.objectListOffset,
                useFrameId,
                '(unsigned long)&((struct rt_thread *)0)->parent.list',
                false,
            );

            const schedulerContext = await this.getVarIfEmpty(
                undefined,
                useFrameId,
                '&((struct rt_thread *)0)->sched_thread_ctx.stat',
                true,
            );
            this.hasSchedulerContext = schedulerContext !== null;

            this.currentThread = await this.getVarIfEmpty(
                this.currentThread,
                useFrameId,
                '_cpu.current_thread',
                true,
            );
            if (!this.currentThread) {
                this.currentThread = await this.getVarIfEmpty(
                    this.currentThread,
                    useFrameId,
                    '_cpus[0].current_thread',
                    true,
                );
            }
            if (!this.currentThread) {
                this.currentThread = await this.getVarIfEmpty(
                    this.currentThread,
                    useFrameId,
                    'rt_current_thread',
                    true,
                );
            }

            this.status = 'initialized';
        } catch (e) {
            if (e instanceof RTOSCommon.ShouldRetry) {
                console.error(e.message);
            } else {
                this.status = 'failed';
                this.failedWhy = e;
                console.error('RTOSRTThread.tryDetect() failed: ', e);
            }
        }
        return this;
    }

    public async refresh(frameId: number): Promise<void> {
        if (this.progStatus !== 'stopped' || !this.listHead || !this.objectListOffset || !this.containerSymbol) {
            return;
        }

        try {
            const headAddress = this.parseNumber(await this.listHead.getValue(frameId));
            const listOffset = this.parseNumber(await this.objectListOffset.getValue(frameId));
            const container = `${this.containerSymbol}[0]`;
            let nodeAddress = this.parseNumber(await this.getExprVal(`${container}.object_list.next`, frameId));
            const currentAddress = this.currentThread
                ? this.parseNumber(await this.currentThread.getValue(frameId))
                : undefined;

            if (headAddress === undefined || listOffset === undefined || nodeAddress === undefined) {
                throw new Error('Unable to read the RT-Thread object list');
            }

            const found: RTOSCommon.RTOSThreadInfo[] = [];
            const visited = new Set<number>();
            while (
                nodeAddress !== headAddress &&
                nodeAddress !== 0 &&
                !visited.has(nodeAddress) &&
                found.length < RTOSRTThread.MAX_THREADS
            ) {
                visited.add(nodeAddress);
                const threadAddress = nodeAddress - listOffset;
                found.push(await this.readThread(threadAddress, currentAddress, frameId));

                nodeAddress = this.parseNumber(
                    await this.getExprVal(
                        `((struct rt_thread *)${RTOSCommon.hexFormat(threadAddress)})->parent.list.next`,
                        frameId,
                    ),
                );
                if (nodeAddress === undefined) {
                    throw new Error('Unable to read the next RT-Thread object list node');
                }
            }

            this.threads = found;
            this.timeInfo = new Date().toLocaleTimeString();
        } catch (e) {
            console.error('RTOSRTThread.refresh() failed: ', e);
        }
    }

    public getHTML(): RTOSCommon.HtmlInfo {
        if (this.threads.length === 0) {
            return {
                html: `
                <div>
                    <div><strong>RT-Thread threads not found</strong></div>
                    <div>
                        No thread objects are currently present. The kernel may not have reached
                        <code>rtthread_startup()</code> yet.
                    </div>
                </div>`,
                css: '',
            };
        }
        return this.getHTMLThreads(ThreadTableItemNames, ThreadTableItems, this.threads, this.timeInfo);
    }

    private async readThread(
        threadAddress: number,
        currentAddress: number | undefined,
        frameId: number,
    ): Promise<RTOSCommon.RTOSThreadInfo> {
        const ptr = `((struct rt_thread *)${RTOSCommon.hexFormat(threadAddress)})`;
        const scheduler = this.hasSchedulerContext ? 'sched_thread_ctx.' : '';
        const schedulerPrivate = this.hasSchedulerContext
            ? 'sched_thread_ctx.sched_thread_priv.'
            : '';

        const [nameValue, stateValue, currentPriority, initPriority, remainingTick, initTick, errorValue] =
            await Promise.all([
                this.getExprVal(`(char *)&${ptr}->parent.name`, frameId),
                this.getExprVal(`(unsigned int)${ptr}->${scheduler}stat`, frameId),
                this.getExprVal(`(unsigned int)${ptr}->${schedulerPrivate}current_priority`, frameId),
                this.getExprVal(`(unsigned int)${ptr}->${schedulerPrivate}init_priority`, frameId),
                this.getExprVal(`(unsigned long)${ptr}->${schedulerPrivate}remaining_tick`, frameId),
                this.getExprVal(`(unsigned long)${ptr}->${schedulerPrivate}init_tick`, frameId),
                this.getExprVal(`(long)${ptr}->error`, frameId),
            ]);

        const rawState = this.parseNumber(stateValue) ?? 0xff;
        const running = currentAddress !== undefined
            ? threadAddress === currentAddress
            : (rawState & 0x07) === 0x03;
        const stackInfo = await this.readStackInfo(ptr, frameId);

        const stackUsage = this.formatStackUsage(stackInfo.stackUsed, stackInfo.stackSize);
        const stackPeak = RTOSCommon.RTOSBase.disableStackPeaks
            ? { text: '----', value: undefined }
            : this.formatStackUsage(stackInfo.stackPeak, stackInfo.stackSize);

        return {
            display: {
                name: { text: this.stringFromGdb(nameValue) },
                address: { text: RTOSCommon.hexFormat(threadAddress) },
                state: { text: this.threadState(rawState) },
                priority: { text: `${currentPriority ?? '?'} / ${initPriority ?? '?'}` },
                tick: { text: `${remainingTick ?? '?'} / ${initTick ?? '?'}` },
                error: { text: errorValue ?? '?' },
                stack: stackUsage,
                stackPeak,
            },
            stackInfo,
            running,
        };
    }

    private async readStackInfo(ptr: string, frameId: number): Promise<RTOSCommon.RTOSStackInfo> {
        const [stackAddressValue, stackSizeValue, stackPointerValue] = await Promise.all([
            this.getExprVal(`(unsigned long)${ptr}->stack_addr`, frameId),
            this.getExprVal(`(unsigned long)${ptr}->stack_size`, frameId),
            this.getExprVal(`(unsigned long)${ptr}->sp`, frameId),
        ]);

        const stackStart = this.parseNumber(stackAddressValue) ?? 0;
        const stackSize = this.parseNumber(stackSizeValue);
        const stackTop = this.parseNumber(stackPointerValue);
        const stackInfo: RTOSCommon.RTOSStackInfo = { stackStart, stackTop, stackSize };

        if (stackSize === undefined || stackSize <= 0) {
            return stackInfo;
        }

        stackInfo.stackEnd = stackStart + stackSize;
        if (stackTop !== undefined) {
            stackInfo.stackUsed = Math.max(0, Math.min(stackSize, stackInfo.stackEnd - stackTop));
            stackInfo.stackFree = stackSize - stackInfo.stackUsed;
        }

        if (!RTOSCommon.RTOSBase.disableStackPeaks && stackSize <= RTOSRTThread.MAX_STACK_READ) {
            try {
                const memArg: DebugProtocol.ReadMemoryArguments = {
                    memoryReference: RTOSCommon.hexFormat(stackStart),
                    count: stackSize,
                };
                const stackData = await this.session.customRequest('readMemory', memArg);
                const buf = Buffer.from(stackData.data, 'base64');
                if (buf.length !== stackSize || (stackData.unreadableBytes ?? 0) !== 0) {
                    return stackInfo;
                }
                stackInfo.bytes = new Uint8Array(buf);

                let unusedBytes = 0;
                while (unusedBytes < stackInfo.bytes.length && stackInfo.bytes[unusedBytes] === 0x23) {
                    unusedBytes++;
                }
                stackInfo.stackPeak = stackSize - unusedBytes;
            } catch (e) {
                console.log('RTOSRTThread: stack peak read failed', e);
            }
        }

        return stackInfo;
    }

    private formatStackUsage(used: number | undefined, size: number | undefined): RTOSCommon.DisplayRowItem {
        if (used === undefined || size === undefined || size <= 0) {
            return { text: '?', value: undefined };
        }
        const percent = Math.max(0, Math.min(100, Math.round((used / size) * 100)));
        return { text: `${percent} % (${used} / ${size})`, value: percent };
    }

    private threadState(rawState: number): ThreadState {
        switch (rawState & 0x07) {
            case 0x00:
                return 'INITIALIZED';
            case 0x01:
                return 'CLOSED';
            case 0x02:
                return 'READY';
            case 0x03:
                return 'RUNNING';
            case 0x04:
                return 'SUSPENDED';
            case 0x06:
                return 'SUSPENDED (KILLABLE)';
            case 0x07:
                return 'SUSPENDED (UNINTERRUPTIBLE)';
            default:
                return 'UNKNOWN';
        }
    }

    private parseNumber(value: string | undefined): number | undefined {
        if (!value) {
            return undefined;
        }
        const hex = value.match(/-?0x[0-9a-f]+/i)?.[0];
        if (hex) {
            return Number.parseInt(hex, 16);
        }
        const decimal = value.match(/-?\d+/)?.[0];
        return decimal === undefined ? undefined : Number.parseInt(decimal, 10);
    }

    private stringFromGdb(value: string | undefined): string {
        if (!value) {
            return '?';
        }
        return value.match(/"((?:\\.|[^"\\])*)"/)?.[1] ?? '?';
    }
}
