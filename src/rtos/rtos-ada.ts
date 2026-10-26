/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from 'vscode';
import { DebugProtocol } from '@vscode/debugprotocol';
import * as RTOSCommon from './rtos-common';

/**
 * Task view for the GNAT bareboard Ravenscar/Jorvik runtimes ("light-tasking" and "embedded"),
 * as found in AdaCore bb-runtimes and community-bb-runtimes.
 *
 * The runtimes are normally built without debug information, so the debugger knows the
 * runtime symbols but not the runtime types. Because of that this provider:
 *
 *   - only evaluates expressions that work in both the Ada and the C language mode of GDB
 *     (`&symbol` and `&{int}address`), because the current frame is usually Ada code;
 *   - reads the thread descriptors with `readMemory` and decodes them using the layout of
 *     `System.BB.Threads.Thread_Descriptor`. When the runtime has debug information, the component
 *     offsets are taken from it; otherwise the built-in layout for 32-bit ARM Cortex-M is used
 *     (see `BuiltInDescriptorLayout`).
 *
 * All threads are linked through `System.BB.Threads.Queues.Global_List`. The thread descriptor
 * is a component of the task control block, which is a component of the task object, so the
 * symbol covering the descriptor address names the task (e.g. `workers.fast_blinker`).
 */

interface DescriptorLayout {
    savedProcessStackPointer: number;
    taskControlBlock: number;
    baseProcessor: number;
    basePriority: number;
    activePriority: number;
    topOfStack: number;
    bottomOfStack: number;
    state: number;
    globalListNext: number;
    size: number; // Number of bytes to read, enough to cover every field above
}

// Index of SP_process in System.BB.CPU_Primitives.Context_Buffer (ARMv6-M, ARMv7-M, ARMv8-M)
const SavedProcessStackPointerIndex = 8;
const WordSize = 4;

// Offsets inside System.BB.Threads.Thread_Descriptor (Cortex-M, Context_Buffer_Capacity = 10),
// used when the runtime has no debug information
const BuiltInDescriptorLayout: DescriptorLayout = {
    savedProcessStackPointer: 32, // Context (SP_process = 8) : System.Address, bit 0 = FPU context saved
    taskControlBlock: 40, // ATCB : System.Address
    baseProcessor: 44, // Base_CPU : CPU_Range (one byte)
    basePriority: 48, // Base_Priority : Integer
    activePriority: 52, // Active_Priority : Integer
    topOfStack: 56, // Top_Of_Stack : System.Address
    bottomOfStack: 60, // Bottom_Of_Stack : System.Address
    state: 84, // State : Thread_States (one byte)
    globalListNext: 88, // Global_List : Thread_Id
    size: 92,
};

// Components of Thread_Descriptor (as named in the debug information) for every layout field
const DescriptorComponentNames: { [field in Exclude<keyof DescriptorLayout, 'size'>]: string } = {
    savedProcessStackPointer: 'context',
    taskControlBlock: 'atcb',
    baseProcessor: 'base_cpu',
    basePriority: 'base_priority',
    activePriority: 'active_priority',
    topOfStack: 'top_of_stack',
    bottomOfStack: 'bottom_of_stack',
    state: 'state',
    globalListNext: 'global_list',
};

const MaximumDescriptorSize = 1024;

// System.BB.Threads.Thread_States
const ThreadStateNames = ['Runnable', 'Suspended', 'Delayed'];

const GlobalListSymbol = 'system__bb__threads__queues__global_list';
const RunningThreadTableSymbol = '__gnat_running_thread_table';

const ThreadTableItems: { [key: string]: RTOSCommon.DisplayColumnItem } = {
    name: {
        width: 4,
        headerRow1: 'Task',
        headerRow2: 'Name',
    },
    address: {
        width: 2,
        headerRow1: 'Thread',
        headerRow2: 'Descriptor',
    },
    state: {
        width: 2,
        headerRow1: '',
        headerRow2: 'State',
    },
    priority: {
        width: 1,
        headerRow1: 'Priority',
        headerRow2: 'Active / Base',
        colType: RTOSCommon.ColTypeEnum.colTypeNumeric,
    },
    processor: {
        width: 1,
        headerRow1: '',
        headerRow2: 'CPU',
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
        headerRow2: 'Peak Usage (estimate)',
        colType: RTOSCommon.ColTypeEnum.colTypePercentage,
    },
};

const ThreadTableItemNames = Object.keys(ThreadTableItems);

interface ThreadDescriptor {
    address: number;
    savedProcessStackPointer: number;
    taskControlBlock: number;
    baseProcessor: number;
    basePriority: number;
    activePriority: number;
    topOfStack: number;
    bottomOfStack: number;
    state: number;
    globalListNext: number;
}

export class RTOSAdaBareboard extends RTOSCommon.RTOSBase {
    private static readonly MaximumThreadCount = 256;
    private static readonly MaximumStackRead = 1024 * 1024;

    private globalListAddress: number | undefined;
    private layout: DescriptorLayout = BuiltInDescriptorLayout;
    private layoutSource: 'debug information' | 'built-in offsets' = 'built-in offsets';
    private runningThreadTableAddress: number | undefined;
    private taskNames = new Map<number, string>();
    private threads: RTOSCommon.RTOSThreadInfo[] = [];
    private timeInfo = '';

    constructor(public session: vscode.DebugSession) {
        super(session, 'Ada');
    }

    public async tryDetect(useFrameId: number): Promise<RTOSCommon.RTOSBase> {
        this.progStatus = 'stopped';
        try {
            if (this.status !== 'none') {
                return this;
            }

            const globalList = await this.getVarIfEmpty(undefined, useFrameId, `&${GlobalListSymbol}`, true);
            this.globalListAddress = globalList ? this.parseAddress(globalList.value) : undefined;
            if (!this.globalListAddress) {
                throw new Error('GNAT bareboard tasking runtime was not found');
            }

            const runningThreadTable = await this.getVarIfEmpty(
                undefined,
                useFrameId,
                `&${RunningThreadTableSymbol}`,
                true,
            );
            this.runningThreadTableAddress = runningThreadTable
                ? this.parseAddress(runningThreadTable.value)
                : undefined;

            await this.resolveLayout(useFrameId);

            this.status = 'initialized';
        } catch (error) {
            if (error instanceof RTOSCommon.ShouldRetry) {
                console.error(error.message);
            } else {
                this.status = 'failed';
                this.failedWhy = error;
                console.error('RTOSAdaBareboard.tryDetect() failed: ', error);
            }
        }
        return this;
    }

    public async refresh(frameId: number): Promise<void> {
        if (this.progStatus !== 'stopped' || this.globalListAddress === undefined) {
            return;
        }

        try {
            const descriptors: ThreadDescriptor[] = [];
            const visited = new Set<number>();
            let threadAddress = await this.readWord(this.globalListAddress);
            while (
                threadAddress !== 0 &&
                !visited.has(threadAddress) &&
                descriptors.length < RTOSAdaBareboard.MaximumThreadCount
            ) {
                visited.add(threadAddress);
                const descriptor = await this.readDescriptor(threadAddress);
                descriptors.push(descriptor);
                threadAddress = descriptor.globalListNext;
            }

            const runningThreadAddress = await this.findRunningThread(descriptors, frameId);
            const found: RTOSCommon.RTOSThreadInfo[] = [];
            // Global_List is a stack: the most recently created thread comes first.
            // Show threads in creation order instead.
            for (const descriptor of descriptors.reverse()) {
                found.push(await this.makeThreadInfo(descriptor, descriptor.address === runningThreadAddress, frameId));
            }

            this.threads = found;
            this.timeInfo = new Date().toLocaleTimeString();
        } catch (error) {
            console.error('RTOSAdaBareboard.refresh() failed: ', error);
        }
    }

    public getHTML(): RTOSCommon.HtmlInfo {
        if (this.threads.length === 0) {
            return {
                html: `
                <div>
                    <div><strong>Ada tasks not found</strong></div>
                    <div>
                        The tasking runtime has not been initialized yet (the program may still be in
                        the startup code or in library-level elaboration).
                    </div>
                </div>`,
                css: '',
            };
        }
        const htmlThreads = this.getHTMLThreads(ThreadTableItemNames, ThreadTableItems, this.threads, this.timeInfo);
        htmlThreads.html += `<p>Thread descriptor layout: ${this.layoutSource}</p>\n`;
        return htmlThreads;
    }

    /**
     * Take the Thread_Descriptor component offsets from the runtime debug information, if there is any.
     * `&pointer.component` works in both the Ada and the C mode of GDB (both dereference implicitly),
     * and it does not read the descriptor, so it works even while Global_List is still null.
     * Without debug information GDB reports that the symbol has an unknown type: keep the built-in layout.
     */
    private async resolveLayout(frameId: number): Promise<void> {
        let pointer: number | undefined;
        try {
            pointer = this.parseAddress(await this.evalForVarValue(frameId, GlobalListSymbol));
        } catch (error) {
            console.log('RTOSAdaBareboard: no debug information for the runtime, using built-in offsets');
            return;
        }
        if (pointer === undefined) {
            return;
        }

        const offsets: Partial<DescriptorLayout> = {};
        try {
            for (const [field, component] of Object.entries(DescriptorComponentNames)) {
                const value = await this.evalForVarValue(frameId, `&${GlobalListSymbol}.${component}`);
                const componentAddress = this.parseAddress(value);
                if (componentAddress === undefined) {
                    throw new Error(`No address for component ${component}: ${value}`);
                }
                offsets[field as keyof DescriptorLayout] = componentAddress - pointer;
            }
        } catch (error) {
            console.log('RTOSAdaBareboard: unable to use the runtime debug information, using built-in offsets', error);
            return;
        }

        offsets.savedProcessStackPointer! += SavedProcessStackPointerIndex * WordSize;
        const fieldOffsets = Object.values(offsets) as number[];
        if (fieldOffsets.some((offset) => offset < 0 || offset + WordSize > MaximumDescriptorSize)) {
            console.log(
                'RTOSAdaBareboard: implausible offsets in the debug information, using built-in offsets',
                offsets,
            );
            return;
        }
        this.layout = { ...(offsets as DescriptorLayout), size: Math.max(...fieldOffsets) + WordSize };
        this.layoutSource = 'debug information';
    }

    private async makeThreadInfo(
        descriptor: ThreadDescriptor,
        running: boolean,
        frameId: number,
    ): Promise<RTOSCommon.RTOSThreadInfo> {
        const stackInfo = await this.readStackInfo(descriptor, running, frameId);
        const stateName = running ? 'Running' : (ThreadStateNames[descriptor.state] ?? `Unknown (${descriptor.state})`);

        return {
            display: {
                name: { text: await this.taskName(descriptor, frameId) },
                address: { text: RTOSCommon.hexFormat(descriptor.address) },
                state: { text: stateName },
                priority: { text: `${descriptor.activePriority} / ${descriptor.basePriority}` },
                processor: { text: `${descriptor.baseProcessor}` },
                stack: this.formatStackUsage(stackInfo.stackUsed, stackInfo.stackSize),
                stackPeak: RTOSCommon.RTOSBase.disableStackPeaks
                    ? { text: '----', value: undefined }
                    : this.formatStackUsage(stackInfo.stackPeak, stackInfo.stackSize),
            },
            stackInfo,
            running,
        };
    }

    private async findRunningThread(descriptors: ThreadDescriptor[], frameId: number): Promise<number | undefined> {
        // The thread whose stack contains the current process stack pointer is the one executing on
        // the halted processor. This also works for multiprocessor runtimes.
        const stackPointer = await this.getStackPointerRegVal(frameId);
        if (stackPointer !== undefined) {
            const owner = descriptors.find(
                (descriptor) => descriptor.bottomOfStack <= stackPointer && stackPointer <= descriptor.topOfStack,
            );
            if (owner) {
                return owner.address;
            }
        }
        // Otherwise (e.g. stopped on the interrupt stack) ask the scheduler about the first processor
        if (this.runningThreadTableAddress) {
            return this.readWord(this.runningThreadTableAddress);
        }
        return undefined;
    }

    private async taskName(descriptor: ThreadDescriptor, frameId: number): Promise<string> {
        const cached = this.taskNames.get(descriptor.address);
        if (cached !== undefined) {
            return cached;
        }

        let name = '?';
        try {
            // `&{int}address` is accepted in both Ada and C mode, and GDB prints `<symbol+offset>`
            const value = await this.evalForVarValue(frameId, `&{int}${RTOSCommon.hexFormat(descriptor.address)}`);
            const symbol = value?.match(/<([^>+]+)(\+\d+)?>/)?.[1];
            if (symbol) {
                name = this.decodeAdaName(symbol);
            } else if (descriptor.taskControlBlock === 0) {
                name = '(environment task)';
            }
        } catch (error) {
            console.log('RTOSAdaBareboard: symbol lookup failed', error);
        }
        this.taskNames.set(descriptor.address, name);
        return name;
    }

    private decodeAdaName(symbol: string): string {
        // `pkg__child__object` -> `pkg.child.object`; GDB usually does this already in Ada mode
        const decoded = symbol.replace(/__/g, '.');
        if (decoded.startsWith('system.task_primitives.operations.idle_')) {
            return '(idle)';
        }
        if (
            decoded === 'system.tasking.environment_task' ||
            decoded.startsWith('system.task_primitives.operations.environment')
        ) {
            return '(environment task)';
        }
        return decoded;
    }

    private async readStackInfo(
        descriptor: ThreadDescriptor,
        running: boolean,
        frameId: number,
    ): Promise<RTOSCommon.RTOSStackInfo> {
        const stackStart = descriptor.bottomOfStack;
        const stackEnd = descriptor.topOfStack;
        const stackSize = stackEnd > stackStart ? stackEnd - stackStart : undefined;
        const stackTop = running ? await this.getStackPointerRegVal(frameId) : descriptor.savedProcessStackPointer;
        const stackInfo: RTOSCommon.RTOSStackInfo = { stackStart, stackEnd, stackTop, stackSize };

        if (stackSize === undefined) {
            return stackInfo;
        }
        if (stackTop !== undefined && stackTop >= stackStart && stackTop <= stackEnd) {
            stackInfo.stackUsed = stackEnd - stackTop;
            stackInfo.stackFree = stackSize - stackInfo.stackUsed;
        }

        if (!RTOSCommon.RTOSBase.disableStackPeaks && stackSize <= RTOSAdaBareboard.MaximumStackRead) {
            try {
                const bytes = await this.readMemory(stackStart, stackSize);
                stackInfo.bytes = bytes;
                // The runtime does not fill task stacks with a pattern, but they live in zeroed .bss,
                // so the untouched part of a stack is still zero. If the lowest word is not zero the
                // stack was either not zero-initialized or completely used: no estimate in that case.
                if (bytes.length >= 4 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0 && bytes[3] === 0) {
                    let untouchedBytes = 0;
                    while (untouchedBytes < bytes.length && bytes[untouchedBytes] === 0) {
                        untouchedBytes++;
                    }
                    untouchedBytes -= untouchedBytes % 4; // Stack is used in whole words
                    // Saved registers may contain zeros, so never report less than the current usage
                    stackInfo.stackPeak = Math.max(stackSize - untouchedBytes, stackInfo.stackUsed ?? 0);
                }
            } catch (error) {
                console.log('RTOSAdaBareboard: stack peak read failed', error);
            }
        }
        return stackInfo;
    }

    private async readDescriptor(address: number): Promise<ThreadDescriptor> {
        const bytes = await this.readMemory(address, this.layout.size);
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const word = (offset: number) => view.getUint32(offset, true);
        const integer = (offset: number) => view.getInt32(offset, true);
        return {
            address,
            // With an FPU the context switch saves s16-s31 below PSP and sets bit 0 as a flag
            savedProcessStackPointer: (word(this.layout.savedProcessStackPointer) & ~1) >>> 0,
            taskControlBlock: word(this.layout.taskControlBlock),
            baseProcessor: view.getUint8(this.layout.baseProcessor),
            basePriority: integer(this.layout.basePriority),
            activePriority: integer(this.layout.activePriority),
            topOfStack: word(this.layout.topOfStack),
            bottomOfStack: word(this.layout.bottomOfStack),
            state: view.getUint8(this.layout.state),
            globalListNext: word(this.layout.globalListNext),
        };
    }

    private async readWord(address: number): Promise<number> {
        const bytes = await this.readMemory(address, 4);
        return new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
    }

    private async readMemory(address: number, count: number): Promise<Uint8Array> {
        const argument: DebugProtocol.ReadMemoryArguments = {
            memoryReference: RTOSCommon.hexFormat(address),
            count,
        };
        const response = await this.customRequest('readMemory', argument);
        const buffer = Buffer.from(response?.data ?? '', 'base64');
        if (buffer.length !== count || (response?.unreadableBytes ?? 0) !== 0) {
            throw new Error(`Unable to read ${count} bytes at ${RTOSCommon.hexFormat(address)}`);
        }
        return new Uint8Array(buffer);
    }

    private formatStackUsage(used: number | undefined, size: number | undefined): RTOSCommon.DisplayRowItem {
        if (used === undefined || size === undefined || size <= 0) {
            return { text: '?', value: undefined };
        }
        const percent = Math.max(0, Math.min(100, Math.round((used / size) * 100)));
        return { text: `${percent} % (${used} / ${size})`, value: percent };
    }

    private parseAddress(value: string | undefined): number | undefined {
        const hexadecimal = value?.match(/0x[0-9a-f]+/i)?.[0];
        return hexadecimal ? Number.parseInt(hexadecimal, 16) : undefined;
    }
}
