/* eslint-disable @typescript-eslint/naming-convention */
import * as assert from 'assert';
import * as vscode from 'vscode';
import { RTOSBase } from '../../rtos/rtos-common';
import { RTOSRTThread } from '../../rtos/rtos-rtthread';

interface FakeThread {
    address: number;
    nextNode: number;
    name: string;
    state: number;
    currentPriority: number;
    initPriority: number;
    remainingTick: number;
    initTick: number;
    error: number;
    stackAddress: number;
    stackSize: number;
    stackPointer: number;
    unusedStack: number;
}

suite('RT-Thread provider', () => {
    test('detects RT-Thread and renders its object-list threads', async () => {
        const headAddress = 0x1000;
        const listOffset = 0x14;
        const threads: FakeThread[] = [
            {
                address: 0x2000,
                nextNode: 0x2114,
                name: 'main',
                state: 0x03,
                currentPriority: 10,
                initPriority: 10,
                remainingTick: 5,
                initTick: 10,
                error: 0,
                stackAddress: 0x3000,
                stackSize: 32,
                stackPointer: 0x3018,
                unusedStack: 20,
            },
            {
                address: 0x2100,
                nextNode: headAddress,
                name: 'worker',
                state: 0x04,
                currentPriority: 12,
                initPriority: 12,
                remainingTick: 4,
                initTick: 10,
                error: -2,
                stackAddress: 0x3100,
                stackSize: 32,
                stackPointer: 0x3110,
                unusedStack: 10,
            },
        ];

        const evaluate = (expression: string): string => {
            const fixedValues: { [key: string]: string } = {
                '&_object_container[0].object_list': hex(headAddress),
                '(unsigned long)&((struct rt_thread *)0)->parent.list': hex(listOffset),
                '&((struct rt_thread *)0)->sched_thread_ctx.stat': '0x3c',
                '_cpu.current_thread': hex(threads[0].address),
                '_object_container[0].object_list.next': hex(threads[0].address + listOffset),
            };
            if (expression in fixedValues) {
                return fixedValues[expression];
            }
            if (expression === 'rt_object_container[0]' || expression.startsWith('_cpus[')) {
                throw new Error(`No symbol ${expression}`);
            }

            const addressText = expression.match(/struct rt_thread \*\)(0x[0-9a-f]+)/i)?.[1];
            const thread = threads.find((item) => item.address === Number.parseInt(addressText ?? '', 16));
            if (!thread) {
                throw new Error(`Unexpected expression: ${expression}`);
            }

            if (expression.endsWith('->parent.list.next')) {
                return hex(thread.nextNode);
            }
            if (expression.endsWith('->parent.name')) {
                return `${hex(thread.address)} "${thread.name}"`;
            }
            if (expression.endsWith('->sched_thread_ctx.stat')) {
                return thread.state.toString();
            }
            if (expression.endsWith('->sched_thread_ctx.sched_thread_priv.current_priority')) {
                return thread.currentPriority.toString();
            }
            if (expression.endsWith('->sched_thread_ctx.sched_thread_priv.init_priority')) {
                return thread.initPriority.toString();
            }
            if (expression.endsWith('->sched_thread_ctx.sched_thread_priv.remaining_tick')) {
                return thread.remainingTick.toString();
            }
            if (expression.endsWith('->sched_thread_ctx.sched_thread_priv.init_tick')) {
                return thread.initTick.toString();
            }
            if (expression.endsWith('->error')) {
                return thread.error.toString();
            }
            if (expression.endsWith('->stack_addr')) {
                return hex(thread.stackAddress);
            }
            if (expression.endsWith('->stack_size')) {
                return thread.stackSize.toString();
            }
            if (expression.endsWith('->sp')) {
                return hex(thread.stackPointer);
            }
            throw new Error(`Unexpected expression: ${expression}`);
        };

        const fakeSession = {
            id: 'rtthread-test',
            name: 'RT-Thread test',
            type: 'cortex-debug',
            customRequest: async (command: string, args: any): Promise<any> => {
                if (command === 'evaluate') {
                    return { result: evaluate(args.expression), variablesReference: 1 };
                }
                if (command === 'readMemory') {
                    const address = Number.parseInt(args.memoryReference, 16);
                    const thread = threads.find((item) => item.stackAddress === address);
                    if (!thread) {
                        throw new Error(`Unexpected stack address ${args.memoryReference}`);
                    }
                    const bytes = Buffer.alloc(thread.stackSize, 0xa5);
                    bytes.fill(0x23, 0, thread.unusedStack);
                    return { address: args.memoryReference, data: bytes.toString('base64') };
                }
                throw new Error(`Unexpected request: ${command}`);
            },
        } as unknown as vscode.DebugSession;

        RTOSBase.disableStackPeaks = false;
        const provider = new RTOSRTThread(fakeSession);
        await provider.tryDetect(1);
        assert.strictEqual(provider.status, 'initialized');

        await provider.refresh(1);
        const html = provider.getHTML().html;
        assert.match(html, /main/);
        assert.match(html, /worker/);
        assert.match(html, /RUNNING/);
        assert.match(html, /SUSPENDED/);
        assert.match(html, /25 % \(8 \/ 32\)/);
        assert.match(html, /38 % \(12 \/ 32\)/);
        assert.match(html, /50 % \(16 \/ 32\)/);
        assert.match(html, /69 % \(22 \/ 32\)/);
    });
});

function hex(value: number): string {
    return `0x${value.toString(16)}`;
}
