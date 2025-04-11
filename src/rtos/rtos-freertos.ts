/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from 'vscode';
import { DebugProtocol } from '@vscode/debugprotocol';
import * as RTOSCommon from './rtos-common';
import { ColTypeEnum } from './rtos-common';

// We will have two rows of headers for FreeRTOS and the table below describes
// the columns headers for the two rows and the width of each column as a fraction
// of the overall space.
enum DisplayFields {
    ID,
    Address,
    TaskName,
    Status,
    Priority,
    StackStart,
    StackTop,
    StackEnd,
    StackSize,
    StackUsed,
    StackFree,
    StackPeak,
    Runtime
}

const numType = RTOSCommon.ColTypeEnum.colTypeNumeric;
const FreeRTOSItems: { [key: string]: RTOSCommon.DisplayColumnItem } = {};
FreeRTOSItems[DisplayFields[DisplayFields.ID]] = { width: 1, headerRow1: '', headerRow2: 'ID', colType: numType };
FreeRTOSItems[DisplayFields[DisplayFields.Address]] = {
    width: 3,
    headerRow1: 'Thread',
    headerRow2: 'Address',
    colGapBefore: 1
};
FreeRTOSItems[DisplayFields[DisplayFields.TaskName]] = { width: 4, headerRow1: '', headerRow2: 'Task Name' };
FreeRTOSItems[DisplayFields[DisplayFields.Status]] = { width: 3, headerRow1: '', headerRow2: 'Status' };
FreeRTOSItems[DisplayFields[DisplayFields.Priority]] = {
    width: 1.5,
    headerRow1: 'Prio',
    headerRow2: 'rity',
    colType: numType
};
FreeRTOSItems[DisplayFields[DisplayFields.StackStart]] = {
    width: 3,
    headerRow1: 'Stack',
    headerRow2: 'Start',
    colType: RTOSCommon.ColTypeEnum.colTypeLink,
    colGapBefore: 1
};
FreeRTOSItems[DisplayFields[DisplayFields.StackTop]] = { width: 3, headerRow1: 'Stack', headerRow2: 'Top' };
FreeRTOSItems[DisplayFields[DisplayFields.StackEnd]] = { width: 3, headerRow1: 'Stack', headerRow2: 'End' };
FreeRTOSItems[DisplayFields[DisplayFields.StackSize]] = {
    width: 2,
    headerRow1: 'Stack',
    headerRow2: 'Size',
    colType: numType
};
FreeRTOSItems[DisplayFields[DisplayFields.StackUsed]] = {
    width: 2,
    headerRow1: 'Stack',
    headerRow2: 'Used',
    colType: numType
};
FreeRTOSItems[DisplayFields[DisplayFields.StackFree]] = {
    width: 2,
    headerRow1: 'Stack',
    headerRow2: 'Free',
    colType: numType
};
FreeRTOSItems[DisplayFields[DisplayFields.StackPeak]] = {
    width: 2,
    headerRow1: 'Stack',
    headerRow2: 'Peak',
    colType: numType
};
FreeRTOSItems[DisplayFields[DisplayFields.Runtime]] = {
    width: 2,
    headerRow1: '',
    headerRow2: 'Runtime',
    colType: numType
};
const DisplayFieldNames: string[] = Object.keys(FreeRTOSItems);

enum QueueFields {
    Address,
    Name,
    Type,
    Size,
    UsedSize,
    ItemSize,
    Head,
    WriteTo,
    QNumber,
    Tail,
    ReadFrom,
    MutexHolder,
    RecursiveCount,
    WaitReceiveCnt,
    WaitSendCnt,
};

const FreeRTOSQueues: { [key: string]: RTOSCommon.DisplayColumnItem } = {};
FreeRTOSQueues[QueueFields[QueueFields.QNumber]] = { colType: ColTypeEnum.colTypeNormal, width: 1, headerRow1: '', headerRow2: '#' };
FreeRTOSQueues[QueueFields[QueueFields.Address]] = { colType: ColTypeEnum.colTypeNormal, width: 3, headerRow1: 'Queue', headerRow2: 'Address' };
FreeRTOSQueues[QueueFields[QueueFields.Name]] = { colType: ColTypeEnum.colTypeNormal, width: 4, headerRow1: '', headerRow2: 'Name' };
FreeRTOSQueues[QueueFields[QueueFields.Type]] = { colType: ColTypeEnum.colTypeNormal, width: 2.5, headerRow1: '', headerRow2: 'Type' };
FreeRTOSQueues[QueueFields[QueueFields.Head]] = { colType: ColTypeEnum.colTypeNormal, width: 3, headerRow1: 'Head', headerRow2: 'Address' };
FreeRTOSQueues[QueueFields[QueueFields.Tail]] = { colType: ColTypeEnum.colTypeNormal, width: 3, headerRow1: 'Tail', headerRow2: 'Address' };
FreeRTOSQueues[QueueFields[QueueFields.WriteTo]] = { colType: ColTypeEnum.colTypeNormal, width: 3, headerRow1: 'Write To', headerRow2: 'Address' };
FreeRTOSQueues[QueueFields[QueueFields.ReadFrom]] = { colType: ColTypeEnum.colTypeNormal, width: 3, headerRow1: 'Read From', headerRow2: 'Address' };
FreeRTOSQueues[QueueFields[QueueFields.WaitReceiveCnt]] = { colType: ColTypeEnum.colTypeCollapse, width: 3, headerRow1: 'Wait', headerRow2: 'Rcvrs' };
FreeRTOSQueues[QueueFields[QueueFields.WaitSendCnt]] = { colType: ColTypeEnum.colTypeCollapse, width: 3, headerRow1: 'Wait', headerRow2: 'Sndrs' };
FreeRTOSQueues[QueueFields[QueueFields.Size]] = { colType: ColTypeEnum.colTypeNumeric, width: 2, headerRow1: 'Queue', headerRow2: 'Size' };
FreeRTOSQueues[QueueFields[QueueFields.UsedSize]] = { colType: ColTypeEnum.colTypeNumeric, width: 2, headerRow1: 'Used', headerRow2: 'Size' };
FreeRTOSQueues[QueueFields[QueueFields.ItemSize]] = { colType: ColTypeEnum.colTypeNumeric, width: 2, headerRow1: 'Item', headerRow2: 'Size' };

const FreeRTOSSemaphores: { [key: string]: RTOSCommon.DisplayColumnItem } = {};
FreeRTOSSemaphores[QueueFields[QueueFields.QNumber]] = { colType: ColTypeEnum.colTypeNormal, width: 1, headerRow1: '', headerRow2: '#' };
FreeRTOSSemaphores[QueueFields[QueueFields.Address]] = { colType: ColTypeEnum.colTypeNormal, width: 3, headerRow1: 'Object', headerRow2: 'Address' };
FreeRTOSSemaphores[QueueFields[QueueFields.Name]] = { colType: ColTypeEnum.colTypeNormal, width: 4, headerRow1: '', headerRow2: 'Name' };
FreeRTOSSemaphores[QueueFields[QueueFields.Type]] = { colType: ColTypeEnum.colTypeNormal, width: 2.5, headerRow1: '', headerRow2: 'Type' };
FreeRTOSSemaphores[QueueFields[QueueFields.MutexHolder]] = { colType: ColTypeEnum.colTypeNormal, width: 3, headerRow1: 'Mutex', headerRow2: 'Holder' };
FreeRTOSSemaphores[QueueFields[QueueFields.WaitReceiveCnt]] = { colType: ColTypeEnum.colTypeCollapse, width: 3, headerRow1: '', headerRow2: 'Waits' };
FreeRTOSSemaphores[QueueFields[QueueFields.Size]] = { colType: ColTypeEnum.colTypeNumeric, width: 2, headerRow1: '', headerRow2: 'Size' };
FreeRTOSSemaphores[QueueFields[QueueFields.UsedSize]] = { colType: ColTypeEnum.colTypeNumeric, width: 2, headerRow1: '', headerRow2: 'Available' };
FreeRTOSSemaphores[QueueFields[QueueFields.RecursiveCount]] = { colType: ColTypeEnum.colTypeNumeric, width: 2, headerRow1: 'Rcrsive', headerRow2: 'Cnt' };

interface IQueueWaitInfo {
    waitCount: number;
    waitingList: string[]; // list of thread addresses (handles)
}

export class RTOSFreeRTOS extends RTOSCommon.RTOSBase {
    // We keep a bunch of variable references (essentially pointers) that we can use to query for values
    // Since all of them are global variable, we only need to create them once per session. These are
    // similar to Watch/Hover variables
    private uxCurrentNumberOfTasks: RTOSCommon.RTOSVarHelperMaybe;
    private uxCurrentNumberOfTasksVal = 0;
    private pxReadyTasksLists: RTOSCommon.RTOSVarHelperMaybe;
    private xDelayedTaskList1: RTOSCommon.RTOSVarHelperMaybe;
    private xDelayedTaskList2: RTOSCommon.RTOSVarHelperMaybe;
    private xPendingReadyList: RTOSCommon.RTOSVarHelperMaybe;
    private pxCurrentTCB: RTOSCommon.RTOSVarHelperMaybe;
    private pxCurrentTCBs: RTOSCommon.RTOSVarHelperMaybe;
    private pxCurrentTCBsNum = 0;
    private xSuspendedTaskList: RTOSCommon.RTOSVarHelperMaybe;
    private xTasksWaitingTermination: RTOSCommon.RTOSVarHelperMaybe;
    private ulTotalRunTime: RTOSCommon.RTOSVarHelperMaybe;
    private ulTotalRunTimeVal = 0;
    private xQueueRegistry : RTOSCommon.RTOSVarHelperMaybe;

    private stale = true;
    private curThreadInfo = 0; // address (from pxCurrentTCB) of status (when multicore)
    private curThreadInfos: number[] = []; //address (from pxCurrentTCBs) of status of all threads (when multicore)
    private foundThreads: RTOSCommon.RTOSThreadInfo[] = [];
    private finalThreads: RTOSCommon.RTOSThreadInfo[] = [];
    private timeInfo = '';
    private readonly maxThreads = 1024;
    private helpHtml: string | undefined;
    private queueInfo: RTOSCommon.RTOSDisplayInfo[] = []; // queues and queue sets
    private semaphoreInfo: RTOSCommon.RTOSDisplayInfo[] = []; // semaphores and mutexes

    // Need to do a TON of testing for stack growing the other direction
    private stackIncrements = -1;

    constructor(public session: vscode.DebugSession) {
        super(session, 'FreeRTOS');
    }

    public async tryDetect(useFrameId: number): Promise<RTOSCommon.RTOSBase> {
        this.progStatus = 'stopped';
        try {
            if (this.status === 'none') {
                // We only get references to all the interesting variables. Note that any one of the following can fail
                // and the caller may try again until we know that it definitely passed or failed. Note that while we
                // re-try everything, we do remember what already had succeeded and don't waste time trying again. That
                // is how this.getVarIfEmpty() works
                this.uxCurrentNumberOfTasks = await this.getVarIfEmpty(
                    this.uxCurrentNumberOfTasks,
                    useFrameId,
                    'uxCurrentNumberOfTasks'
                );
                this.pxReadyTasksLists = await this.getVarIfEmpty(
                    this.pxReadyTasksLists,
                    useFrameId,
                    'pxReadyTasksLists'
                );
                this.xDelayedTaskList1 = await this.getVarIfEmpty(
                    this.xDelayedTaskList1,
                    useFrameId,
                    'xDelayedTaskList1'
                );
                this.xDelayedTaskList2 = await this.getVarIfEmpty(
                    this.xDelayedTaskList2,
                    useFrameId,
                    'xDelayedTaskList2'
                );
                this.xPendingReadyList = await this.getVarIfEmpty(
                    this.xPendingReadyList,
                    useFrameId,
                    'xPendingReadyList'
                );
                this.pxCurrentTCB = await this.getVarIfEmpty(this.pxCurrentTCB, useFrameId, 'pxCurrentTCB', true);
                this.pxCurrentTCBs = await this.getVarIfEmpty(this.pxCurrentTCBs, useFrameId, 'pxCurrentTCBs', true);
                if (this.pxCurrentTCBs === null && this.pxCurrentTCB === null) {
                    this.pxCurrentTCB = undefined;
                    this.pxCurrentTCBs = undefined;
                    throw Error('pxCurrentTCB nor pxCurrentTCBs not found');
                }
                this.xSuspendedTaskList = await this.getVarIfEmpty(
                    this.xSuspendedTaskList,
                    useFrameId,
                    'xSuspendedTaskList',
                    true
                );
                this.xTasksWaitingTermination = await this.getVarIfEmpty(
                    this.xTasksWaitingTermination,
                    useFrameId,
                    'xTasksWaitingTermination',
                    true
                );
                this.ulTotalRunTime = await this.getVarIfEmpty(this.ulTotalRunTime, useFrameId, 'ulTotalRunTime', true);
                this.xQueueRegistry = await this.getVarIfEmpty(this.xQueueRegistry, useFrameId, 'xQueueRegistry', true);

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

    protected createHmlHelp(th: RTOSCommon.RTOSThreadInfo, thInfo: RTOSCommon.RTOSStrToValueMap) {
        function strong(s: string) {
            return `<strong>${s}</strong>`;
        }
        if (this.helpHtml === undefined) {
            this.helpHtml = '';
            try {
                let ret = '';
                if (!thInfo['uxTCBNumber'].val) {
                    ret += `Thread ID missing......: Enable macro ${strong('configUSE_TRACE_FACILITY')} in FW<br>`;
                }
                if (!th.stackInfo.stackEnd) {
                    ret += `Stack End missing......: Enable macro
                    ${strong('configRECORD_STACK_HIGH_ADDRESS')} in FW<br>`;
                }
                if (thInfo['pcTaskName'].val === '[0]' || thInfo['pcTaskName'].val === '[1]') {
                    ret += `Thread Name missing....: Set macro
                    ${strong('configMAX_TASK_NAME_LEN')} to something greater than 1 in FW<br>`;
                }

                if (!this.ulTotalRunTime) {
                    ret += /*html*/ `<br>Missing Runtime stats..:<br>
                    /* To get runtime stats, modify the following macro in FreeRTOSConfig.h */<br>
                    #define ${strong('configGENERATE_RUN_TIME_STATS')}             1 /* 1: generate runtime statistics; 0: no runtime statistics */<br>
                    /* Also, add the following two macros to provide a high speed counter -- something at least 10x faster than<br>
                    ** your RTOS scheduler tick. One strategy could be to use a HW counter and sample its current value when needed<br>
                    */<br>
                    #define ${strong('portCONFIGURE_TIMER_FOR_RUN_TIME_STATS()')} /* Define this to initialize your timer/counter */<br>
                    #define ${strong('portGET_RUN_TIME_COUNTER_VALUE()')}${'&nbsp'.repeat(9)}
                    /* Define this to sample the timer/counter */<br>
                    `;
                }
                if (!this.xQueueRegistry) {
                    ret += /*html*/ `<br>Missing Queue Registry..:<br>
                    /* To get queue/semaphore/mutex information, modify the following macro in FreeRTOSConfig.h */<br>
                    #define ${strong('configQUEUE_REGISTRY_SIZE')}                 10 /* 0: no queue registry; >0: queue registry size */<br>
                    `;
                }
                if (this.queueInfo.length === 0 || this.semaphoreInfo.length === 0) {
                    ret += /*html*/ `<br>Missing Queue/Mutex/Semaphore info..:<br>
                    Register queues/semaphores/mutexes of interest using ${strong('vQueueAddToRegistry()')}<br>
                    `;
                }
                if (ret) {
                    ret +=
                        '<br>Note: Make sure you consider the performance/resources impact for any changes to your FW.<br>\n';
                    ret =
                        '<button class="help-button">Hints to get more out of the FreeRTOS viewer</button>\n' +
                        `<div class="help"><p>\n${ret}\n</p></div>\n`;
                    this.helpHtml = ret;
                }
            } catch (e) {
                console.log(e);
            }
        }
    }

    private updateCurrentThreadAddr(frameId: number): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (this.pxCurrentTCB !== null) {
                this.pxCurrentTCB?.getValue(frameId).then(
                    (ret) => {
                        this.curThreadInfo = parseInt(ret || '');
                        resolve();
                    },
                    (e) => {
                        reject(e);
                    }
                );
            } else {
                resolve();
            }
        });
    }

    // pxCurrentTCBs store the currently running thread. use it determine thread status
    private updateThreadAddrInCurrentTCBs(frameId: number): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (this.pxCurrentTCBs !== null) {
                this.pxCurrentTCBs?.getValue(frameId).then(
                    (ret) => {
                        if (ret !== undefined) {
                            const match = ret.match(/\d+/);
                            this.pxCurrentTCBsNum = match ? parseInt(match[0]) : 0;
                        } else {
                            this.pxCurrentTCBsNum = 0;
                        }
                        for (let i = 0; i < this.pxCurrentTCBsNum; i++) {
                            this.getExprVal('pxCurrentTCBs[' + i + ']', frameId).then(
                                (ret) => {
                                    this.curThreadInfos[i] = parseInt(ret || '');
                                },
                                (e) => {
                                    reject(e);
                                }
                            );
                        }
                        resolve();
                    },
                    (e) => {
                        reject(e);
                    }
                );
            } else {
                resolve();
            }
        });
    }

    private async updateTotalRuntime(frameId: number): Promise<void> {
        if (!this.ulTotalRunTime) {
            return;
        }
        try {
            let total = 0;
            const children = await this.ulTotalRunTime.getVarChildren(frameId);
            for (const child of children) {
                total += parseInt(child.value || '');
            }
            this.ulTotalRunTimeVal = total;
        } catch (e) {
            const ret = await this.ulTotalRunTime.getValue(frameId);
            this.ulTotalRunTimeVal = parseInt(ret || '');
        }
    }

    public refresh(frameId: number): Promise<void> {
        return new Promise<void>((resolve) => {
            if (this.progStatus !== 'stopped') {
                resolve();
                return;
            }

            const timer = new RTOSCommon.HrTimer();
            this.stale = true;
            this.timeInfo = new Date().toISOString();
            // uxCurrentNumberOfTasks can go invalid anytime. Like when a reset/restart happens
            this.uxCurrentNumberOfTasksVal = Number.MAX_SAFE_INTEGER;
            this.foundThreads = [];
            this.queueInfo = [];
            this.semaphoreInfo = [];

            this.uxCurrentNumberOfTasks?.getValue(frameId).then(
                async (str) => {
                    try {
                        this.uxCurrentNumberOfTasksVal = str ? parseInt(str) : Number.MAX_SAFE_INTEGER;
                        if (this.uxCurrentNumberOfTasksVal > 0 && this.uxCurrentNumberOfTasksVal <= this.maxThreads) {
                            let promises = [];
                            const ary = await this.pxReadyTasksLists?.getVarChildren(frameId);
                            for (const v of ary || []) {
                                promises.push(this.getThreadInfo(v.variablesReference, 'READY', frameId));
                            }
                            promises.push(this.updateCurrentThreadAddr(frameId));
                            promises.push(this.updateThreadAddrInCurrentTCBs(frameId));
                            promises.push(this.updateTotalRuntime(frameId));
                            // Update in bulk, but broken up into three chunks, if the number of threads are already fulfilled, then
                            // not much happens
                            await Promise.all(promises);
                            promises = [];
                            promises.push(this.getThreadInfo(this.xDelayedTaskList1, 'BLOCKED', frameId));
                            promises.push(this.getThreadInfo(this.xDelayedTaskList2, 'BLOCKED', frameId));
                            promises.push(this.getThreadInfo(this.xPendingReadyList, 'PENDING', frameId));
                            await Promise.all(promises);
                            promises = [];
                            promises.push(this.getThreadInfo(this.xSuspendedTaskList, 'SUSPENDED', frameId));
                            promises.push(this.getThreadInfo(this.xTasksWaitingTermination, 'TERMINATED', frameId));
                            await Promise.all(promises);
                            promises = [];
                            if (this.foundThreads.length > 0) {
                                const th = this.foundThreads[0];
                                if (th.display['ID'].text !== '??') {
                                    this.foundThreads.sort(
                                        (a, b) => parseInt(a.display['ID'].text) - parseInt(b.display['ID'].text)
                                    );
                                } else {
                                    this.foundThreads.sort(
                                        (a, b) =>
                                            parseInt(a.display['Address'].text) - parseInt(b.display['Address'].text)
                                    );
                                }
                            }
                            this.finalThreads = [...this.foundThreads];
                            // console.table(this.finalThreads);
                        } else {
                            this.finalThreads = [];
                        }
                        if (this.xQueueRegistry) {
                            const queueRegistry = await this.xQueueRegistry.getVarChildren(frameId);
                            let promises = [];
                            for (const q of queueRegistry || []) {
                                promises.push(this.getQueueInfo(q.variablesReference, frameId));
                            }
                            await Promise.all(promises);
                            promises = [];
                        }
                        this.stale = false;
                        this.timeInfo += ' in ' + timer.deltaMs() + ' ms';
                        resolve();
                    } catch (e) {
                        resolve();
                        console.error('FreeRTOS.refresh() failed: ', e);
                    }
                },
                (reason) => {
                    resolve();
                    console.error('FreeRTOS.refresh() failed: ', reason);
                }
            );
        });
    }

    private async getQueueWaitInfo(waitList: RTOSCommon.RTOSStrToValueMap): Promise<IQueueWaitInfo> {
        const waitCount = parseInt(waitList['uxNumberOfItems']?.val);
        const waitingList: string[] = [];
        if (waitCount > 0) {
            const listEndObj = (await this.getVarChildrenObj(waitList['xListEnd']?.ref, '')) || {};
            let curRef = listEndObj['pxPrevious']?.ref;
            for (let wNdx = 0; wNdx < waitCount; wNdx++) {
                const element = (await this.getVarChildrenObj(curRef, '')) || {};
                const threadId = parseInt(element['pvOwner']?.val);
                waitingList.push(RTOSCommon.hexFormat(threadId));
                curRef = element['pxPrevious']?.ref;
            }
        }
        return { waitCount: waitCount, waitingList: waitingList };
    }
    private getQueueInfo(
        varRef: RTOSCommon.RTOSVarHelperMaybe | number,
        frameId: number
    ): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (!varRef || (typeof varRef !== 'number' && !varRef.varReference)) {
                resolve();
                return;
            }
            if (this.progStatus !== 'stopped') {
                reject(new Error('Busy'));
                return;
            }
            let promise;
            if (typeof varRef !== 'number') {
                promise = varRef.getVarChildrenObj(frameId);
            } else {
                promise = this.getVarChildrenObj(varRef, 'task-list');
            }
            promise.then(
                async (obj: any) => {
                    console.log('');

                    const tmpQueueName = obj['pcQueueName']?.val;
                    const match = tmpQueueName.match(/"([^*]*)"$/);
                    const queueName = match ? match[1] : tmpQueueName;

                    if (!queueName || queueName === '0x0') {
                        // empty slot in the registry
                        resolve();
                        return;
                    }

                    const display: { [key: string]: RTOSCommon.DisplayRowItem } = {};
                    const queueRecord: RTOSCommon.RTOSDisplayInfo = {
                        display: display,
                    };
                    const mySetter = (x: QueueFields, text: string, value?: any) => {
                        display[QueueFields[x]] = { text, value };
                    };
                    mySetter(QueueFields.Name, queueName);
                    const queueAddress = parseInt(obj['xHandle']?.val);
                    mySetter(QueueFields.Address, RTOSCommon.hexFormat(queueAddress));

                    const queue = await this.getVarChildrenObj(obj['xHandle']?.ref, '') || {};
                    const uUnion = await this.getVarChildrenObj(queue['u']?.ref, '') || {};
                    const xTasksWaitingToSend = await this.getVarChildrenObj(queue['xTasksWaitingToSend']?.ref, '') || {};
                    const xTasksWaitingToReceive = await this.getVarChildrenObj(queue['xTasksWaitingToReceive']?.ref, '') || {};
                    const waitingToSend = await this.getQueueWaitInfo(xTasksWaitingToSend);
                    const waitingToReceive =await this.getQueueWaitInfo(xTasksWaitingToReceive);
                    const pcHead = parseInt(queue['pcHead']?.val);
                    const pcWriteTo = parseInt(queue['pcWriteTo']?.val);
                    let queueType: number;
                    mySetter(QueueFields.Size, queue['uxLength']?.val);
                    mySetter(QueueFields.UsedSize, queue['uxMessagesWaiting']?.val);
                    mySetter(QueueFields.ItemSize, queue['uxItemSize']?.val);
                    mySetter(QueueFields.Head, RTOSCommon.hexFormat(pcHead));
                    mySetter(QueueFields.WriteTo, RTOSCommon.hexFormat(pcWriteTo));
                    mySetter(QueueFields.WaitReceiveCnt, waitingToReceive.waitCount.toString(), { threads: waitingToReceive.waitingList });
                    mySetter(QueueFields.WaitSendCnt, waitingToSend.waitCount.toString(),{ threads: waitingToSend.waitingList });
                    if (queue['uxQueueNumber']?.val) {
                        mySetter(QueueFields.QNumber, queue['uxQueueNumber']?.val);
                    } else {
                        mySetter(QueueFields.QNumber, '???');
                    }
                    if (queue['ucQueueType']?.val) {
                        // thanks to trace info we have detailed info about the queue type
                        queueType = parseInt(queue['ucQueueType']?.val);
                    } else if (queueAddress === pcHead) {
                        queueType = -2; // unspecified kind of semaphore
                    } else if (pcHead === 0) {
                        queueType = -1; // unspecified kind of mutex
                    } else {
                        queueType = 0;
                    }
                    switch (queueType) {
                        case -2:
                            mySetter(QueueFields.Type, '?Semaphore');
                            break;
                        case -1:
                            mySetter(QueueFields.Type, '?Mutex');
                            break;
                        case 0:
                            mySetter(QueueFields.Type, 'Queue/Set');
                            break;
                        case 1:
                            mySetter(QueueFields.Type, 'Mutex');
                            break;
                        case 2:
                            mySetter(QueueFields.Type, 'CntSemaphore');
                            break;
                        case 3:
                            mySetter(QueueFields.Type, 'BinSemaphore');
                            break;
                        case 4:
                            mySetter(QueueFields.Type, 'RecMutex');
                            break;
                        default:
                            mySetter(QueueFields.Type, `???${queueType}`);
                            break;
                    }

                    if (pcHead === 0 || pcHead === queueAddress) {
                        // mutex || semaphore
                        if (pcHead === 0) {
                            const xSemaphore = await this.getVarChildrenObj(uUnion['xSemaphore']?.ref, '') || {};
                            mySetter(QueueFields.MutexHolder, RTOSCommon.hexFormat(parseInt(xSemaphore['xMutexHolder']?.val)));
                            mySetter(QueueFields.RecursiveCount, xSemaphore['uxRecursiveCallCount']?.val);
                        } else {
                            mySetter(QueueFields.MutexHolder, '---');
                            mySetter(QueueFields.RecursiveCount, '---');
                        }
                        this.semaphoreInfo.push(queueRecord);
                    } else {
                        // queue
                        const xQueue = await this.getVarChildrenObj(uUnion['xQueue']?.ref, '') || {};
                        mySetter(QueueFields.Tail, RTOSCommon.hexFormat(parseInt(xQueue['pcTail']?.val)));
                        mySetter(QueueFields.ReadFrom, RTOSCommon.hexFormat(parseInt(xQueue['pcReadFrom']?.val)));
                        this.queueInfo.push(queueRecord);
                    }

                    resolve();
                },
                (e) => {
                    reject(e);
                }
            );
        });
    }

    private getThreadInfo(
        varRef: RTOSCommon.RTOSVarHelperMaybe | number,
        state: string,
        frameId: number
    ): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (
                !varRef ||
                (typeof varRef !== 'number' && !varRef.varReference) ||
                this.foundThreads.length >= this.uxCurrentNumberOfTasksVal
            ) {
                resolve();
                return;
            }
            if (this.progStatus !== 'stopped') {
                reject(new Error('Busy'));
                return;
            }
            let promise;
            if (typeof varRef !== 'number') {
                promise = varRef.getVarChildrenObj(frameId);
            } else {
                promise = this.getVarChildrenObj(varRef, 'task-list');
            }
            promise.then(
                async (obj: any) => {
                    const threadCount = parseInt(obj['uxNumberOfItems']?.val);
                    const listEndRef = obj['xListEnd']?.ref;
                    if (threadCount <= 0 || !listEndRef) {
                        resolve();
                        return;
                    }
                    try {
                        const listEndObj = (await this.getVarChildrenObj(listEndRef, 'xListEnd')) || {};
                        let curRef = listEndObj['pxPrevious']?.ref;
                        for (let thIx = 0; thIx < threadCount; thIx++) {
                            const element = (await this.getVarChildrenObj(curRef, 'pxPrevious')) || {};
                            const threadId = parseInt(element['pvOwner']?.val);
                            const thInfo = await this.getExprValChildrenObj(
                                `((TCB_t*)${RTOSCommon.hexFormat(threadId)})`,
                                frameId
                            );
                            let threadRunning : boolean;
                            const tmpThName =
                                (await this.getExprVal('(char *)' + thInfo['pcTaskName']?.exp, frameId)) || '';
                            const match = tmpThName.match(/"([^*]*)"$/);
                            const thName = match ? match[1] : tmpThName;
                            const stackInfo = await this.getStackInfo(thInfo, 0xA5);
                            // This is the order we want stuff in
                            const display: { [key: string]: RTOSCommon.DisplayRowItem } = {};
                            const mySetter = (x: DisplayFields, text: string, value?: any) => {
                                display[DisplayFieldNames[x]] = { text, value };
                            };

                            mySetter(DisplayFields.ID, thInfo['uxTCBNumber']?.val || '??');
                            mySetter(DisplayFields.Address, RTOSCommon.hexFormat(threadId));
                            mySetter(DisplayFields.TaskName, thName);
                            if (this.pxCurrentTCB !== null) {
                                threadRunning = threadId === this.curThreadInfo;
                                mySetter(DisplayFields.Status, threadRunning ? 'RUNNING' : state);
                            } else {
                                const xTaskRunState = thInfo['xTaskRunState']?.val;
                                if (xTaskRunState !== undefined) {
                                    // some freertos not use it,then it is undefined
                                    if (xTaskRunState === '-2') {
                                        threadRunning = false;
                                        mySetter(DisplayFields.Status, 'YIELD');
                                    } else if (xTaskRunState === '-1') {
                                        threadRunning = false;
                                        mySetter(DisplayFields.Status, state);
                                    } else {
                                        threadRunning = true;
                                        mySetter(DisplayFields.Status, 'RUNNING(' + xTaskRunState + ')');
                                    }
                                } else {
                                    if (this.pxCurrentTCBs !== null) {
                                        threadRunning = false;
                                        for (const num in this.curThreadInfos) {
                                            if (this.curThreadInfos[num] === threadId) {
                                                threadRunning = true;
                                                mySetter(DisplayFields.Status, 'RUNNING(' + num + ')');
                                                break;
                                            }
                                        }
                                        if (!threadRunning) {
                                            mySetter(DisplayFields.Status, state);
                                        }
                                    } else {
                                        // no pxCurrentTCB, no pxCurrentTCBs, no xTaskRunState
                                        threadRunning = false;
                                        mySetter(DisplayFields.Status, 'UNKNOWN');
                                    }
                                }
                            }
                            mySetter(DisplayFields.StackStart, RTOSCommon.hexFormat(stackInfo.stackStart));
                            mySetter(DisplayFields.StackTop, RTOSCommon.hexFormat(stackInfo.stackTop));
                            mySetter(
                                DisplayFields.StackEnd,
                                stackInfo.stackEnd ? RTOSCommon.hexFormat(stackInfo.stackEnd) : '0x????????'
                            );

                            if (thInfo['uxBasePriority']?.val) {
                                mySetter(
                                    DisplayFields.Priority,
                                    `${thInfo['uxPriority']?.val},${thInfo['uxBasePriority']?.val}`
                                );
                            } else {
                                mySetter(DisplayFields.Priority, `${thInfo['uxPriority']?.val}`);
                            }

                            const func = (x: any) => (x === undefined ? '???' : x.toString());
                            mySetter(DisplayFields.StackSize, func(stackInfo.stackSize));
                            mySetter(DisplayFields.StackUsed, func(stackInfo.stackUsed));
                            mySetter(DisplayFields.StackFree, func(stackInfo.stackFree));

                            if (RTOSCommon.RTOSBase.disableStackPeaks) {
                                mySetter(DisplayFields.StackPeak, '---');
                            }
                            else {
                                mySetter(DisplayFields.StackPeak, func(stackInfo.stackPeak));
                            }

                            if (thInfo['ulRunTimeCounter']?.val && this.ulTotalRunTimeVal) {
                                const tmp = (parseInt(thInfo['ulRunTimeCounter']?.val) / this.ulTotalRunTimeVal) * 100;
                                mySetter(DisplayFields.Runtime, tmp.toFixed(2).padStart(5, '0') + '%');
                            } else {
                                mySetter(DisplayFields.Runtime, '??.??%');
                            }
                            const thread: RTOSCommon.RTOSThreadInfo = {
                                display: display,
                                stackInfo: stackInfo,
                                running: threadRunning
                            };
                            this.foundThreads.push(thread);
                            this.createHmlHelp(thread, thInfo);
                            curRef = element['pxPrevious']?.ref;
                        }
                        resolve();
                    } catch (e) {
                        console.log('FreeRTOS read thread info error', e);
                    }
                },
                (e) => {
                    reject(e);
                }
            );
        });
    }

    protected async getStackInfo(thInfo: RTOSCommon.RTOSStrToValueMap, waterMark: number) {
        const pxStack = thInfo['pxStack']?.val;
        const pxTopOfStack = thInfo['pxTopOfStack']?.val;
        const pxEndOfStack = thInfo['pxEndOfStack']?.val;
        const stackInfo: RTOSCommon.RTOSStackInfo = {
            stackStart: parseInt(pxStack),
            stackTop: parseInt(pxTopOfStack)
        };
        const stackDelta = Math.abs(stackInfo.stackTop - stackInfo.stackStart);
        if (this.stackIncrements < 0) {
            stackInfo.stackFree = stackDelta;
        } else {
            stackInfo.stackUsed = stackDelta;
        }

        if (pxEndOfStack) {
            stackInfo.stackEnd = parseInt(pxEndOfStack);
            stackInfo.stackSize = Math.abs(stackInfo.stackStart - stackInfo.stackEnd);
            if (this.stackIncrements < 0) {
                stackInfo.stackUsed = stackInfo.stackSize - stackDelta;
            } else {
                stackInfo.stackFree = stackInfo.stackSize - stackDelta;
            }
            if (!RTOSCommon.RTOSBase.disableStackPeaks) {
                const memArg: DebugProtocol.ReadMemoryArguments = {
                    memoryReference: RTOSCommon.hexFormat(Math.min(stackInfo.stackStart, stackInfo.stackEnd)),
                    count: stackInfo.stackSize
                };
                try {
                    const stackData = await this.session.customRequest('readMemory', memArg);
                    const buf = Buffer.from(stackData.data, 'base64');
                    stackInfo.bytes = new Uint8Array(buf);
                    let start = this.stackIncrements < 0 ? 0 : stackInfo.bytes.length - 1;
                    const end = this.stackIncrements < 0 ? stackInfo.bytes.length : -1;
                    let peak = 0;
                    while (start !== end) {
                        if (stackInfo.bytes[start] !== waterMark) {
                            break;
                        }
                        start -= this.stackIncrements;
                        peak++;
                    }
                    stackInfo.stackPeak = stackInfo.stackSize - peak;
                } catch (e) {
                    console.log(e);
                }
            }
        }
        return stackInfo;
    }

    public lastValidHtmlContent: RTOSCommon.HtmlInfo = { html: '', css: '' };
    public getHTMLQueues(
        displayColumns: { [key: string]: RTOSCommon.DisplayColumnItem },
        data: RTOSCommon.RTOSDisplayInfo[],
    ): RTOSCommon.HtmlInfo {
        return this.getHTMLTable(Object.keys(displayColumns), displayColumns, data, (_) => '');
    }
    public getHTML(): RTOSCommon.HtmlInfo {
        const htmlContent: RTOSCommon.HtmlInfo = { html: '', css: '' };
        // WARNING: This stuff is super fragile. Once we know how this works, then we should refactor this
        let msg = '';
        if (this.status === 'none') {
            htmlContent.html = '<p>RTOS not yet fully initialized. Will occur next time program pauses</p>\n';
            return htmlContent;
        } else if (this.stale) {
            const lastHtmlInfo = this.lastValidHtmlContent;
            if (this.uxCurrentNumberOfTasksVal === Number.MAX_SAFE_INTEGER) {
                msg = ' Could not read "uxCurrentNumberOfTasks". Perhaps program is busy or did not stop long enough';
                lastHtmlInfo.html = '';
                lastHtmlInfo.css = '';
            } else if (this.uxCurrentNumberOfTasksVal > this.maxThreads) {
                msg = ` FreeRTOS variable uxCurrentNumberOfTasks = ${this.uxCurrentNumberOfTasksVal} seems invalid`;
                lastHtmlInfo.html = '';
                lastHtmlInfo.css = '';
            } else if (lastHtmlInfo.html !== '') {
                msg = ' Following info from last query may be stale.';
            }

            htmlContent.html = `<p>Unable to collect full RTOS information.${msg}</p>\n` + lastHtmlInfo.html;
            htmlContent.css = lastHtmlInfo.css;
            return htmlContent;
        } else if (
            this.uxCurrentNumberOfTasksVal !== Number.MAX_SAFE_INTEGER &&
            this.finalThreads.length !== this.uxCurrentNumberOfTasksVal
        ) {
            msg += `<p>Expecting ${this.uxCurrentNumberOfTasksVal} threads, found ${this.finalThreads.length}. Thread data may be unreliable<p>\n`;
        } else if (this.finalThreads.length === 0) {
            htmlContent.html = `<p>No ${this.name} threads detected, perhaps RTOS not yet initialized or tasks yet to be created!</p>\n`;
            return htmlContent;
        }

        const htmlThreads = this.getHTMLThreads(DisplayFieldNames, FreeRTOSItems, this.finalThreads, '');
        const htmlQueues = this.getHTMLQueues(FreeRTOSQueues, this.queueInfo);
        const htmlSemaphores = this.getHTMLQueues(FreeRTOSSemaphores, this.semaphoreInfo);
        const htmlRTOSPanels = this.getHTMLPanels(
            [
                {   title: `THREADS
                    <vscode-badge appearance="secondary">
                    ${this.finalThreads.length}
                    </vscode-badge>`
                },
                {   title: `QUEUES
                    <vscode-badge appearance="secondary">
                    ${this.queueInfo.length}
                    </vscode-badge>`
                },
                {   title: `MUX/SEMS
                    <vscode-badge appearance="secondary">
                    ${this.semaphoreInfo.length}
                    </vscode-badge>`
                },
            ],
            [
                { content: htmlThreads.html },
                { content: htmlQueues.html },
                { content: htmlSemaphores.html },
            ],
            [   { name: 'id', value: 'rtos-panels' },
                { name: 'activeid', value: this.uiElementState.get('rtos-panels.activeid') },
                { name: 'debug-session-id', value: this.session.id },
            ],
            true);
             
        htmlContent.html = `${msg}\n${htmlRTOSPanels}\n<p>${this.timeInfo}</p>\n${this.helpHtml}\n`;
        htmlContent.css = htmlThreads.css;

        this.lastValidHtmlContent = htmlContent;
        return this.lastValidHtmlContent;
    }
}
