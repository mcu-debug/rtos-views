/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from 'vscode';
import * as RTOSCommon from './rtos-common';

// We will have two rows of headers for Zephyr and the table below describes
// the columns headers for the two rows and the width of each column as a fraction
// of the overall space.
enum DisplayFields {
    Address,
    TaskName,
    Status,
    Priority,
    StackPercent,
}

const RTOSZEPHYRItems: { [key: string]: RTOSCommon.DisplayColumnItem } = {};
RTOSZEPHYRItems[DisplayFields[DisplayFields.Address]] = {
    width: 2,
    headerRow1: 'Thread',
    headerRow2: 'Address',
    colGapBefore: 1,
};
RTOSZEPHYRItems[DisplayFields[DisplayFields.TaskName]] = {
    width: 4,
    headerRow1: 'Thread',
    headerRow2: 'Name',
    colGapBefore: 1,
};
RTOSZEPHYRItems[DisplayFields[DisplayFields.Status]] = {
    width: 4,
    headerRow1: 'Thread',
    headerRow2: 'Status',
    colType: RTOSCommon.ColTypeEnum.colTypeCollapse,
};
RTOSZEPHYRItems[DisplayFields[DisplayFields.Priority]] = {
    width: 1,
    headerRow1: 'Thread',
    headerRow2: 'Priority',
    colType: RTOSCommon.ColTypeEnum.colTypeNumeric,
    colGapAfter: 1,
}; // 3 are enough but 4 aligns better with header text
RTOSZEPHYRItems[DisplayFields[DisplayFields.StackPercent]] = {
    width: 4,
    headerRow1: 'Stack Usage',
    headerRow2: '% (Used B / Size B)',
    colType: RTOSCommon.ColTypeEnum.colTypePercentage,
};

const DisplayFieldNames: string[] = Object.keys(RTOSZEPHYRItems);

export class RTOSZEPHYR extends RTOSCommon.RTOSBase {
    // We keep a bunch of variable references (essentially pointers) that we can use to query for values
    // Since all of them are global variable, we only need to create them once per session. These are
    // similar to Watch/Hover variables
    private stackEntrySize: number = 1; // TODO check if stack_info.size is always in Bytes

    private kernel: RTOSCommon.RTOSVarHelperMaybe;

    private current: RTOSCommon.RTOSVarHelperMaybe;
    private currentVal: number = Number.MAX_SAFE_INTEGER;

    private threads: RTOSCommon.RTOSVarHelperMaybe;

    private stale: boolean = true;
    private foundThreads: RTOSCommon.RTOSThreadInfo[] = [];
    private finalThreads: RTOSCommon.RTOSThreadInfo[] = [];
    private timeInfo: string = '';

    /* As of https://docs.zephyrproject.org/latest/hardware/porting/arch.html - At present, Zephyr does not support stacks that grow upward. */
    private stackIncrements = -1; // negative numbers => stack expands from higher address to lower addresses

    private helpHtml: string | undefined;

    constructor(public session: vscode.DebugSession) {
        super(session, 'Zephyr');

        if (session.configuration.rtosViewConfig) {
            if (session.configuration.rtosViewConfig.stackGrowth) {
                this.stackIncrements = parseInt(session.configuration.rtosViewConfig.stackGrowth);
            }
        }
    }

    public async tryDetect(useFrameId: number): Promise<RTOSCommon.RTOSBase> {
        this.progStatus = 'stopped';
        try {
            if (this.status === 'none') {
                // We only get references to all the interesting variables. Note that any one of the following can fail
                // and the caller may try again until we know that it definitely passed or failed. Note that while we
                // re-try everything, we do remember what already had succeeded and don't waste time trying again. That
                // is how this.getVarIfEmpty() works
                this.kernel = await this.getVarIfEmpty(this.kernel, useFrameId, '_kernel', false);
                this.current = await this.getVarIfEmpty(this.current, useFrameId, '_kernel.cpus[0].current', false);
                this.threads = await this.getVarIfEmpty(this.threads, useFrameId, '_kernel.threads', true);
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
        function strong(text: string) {
            return `<strong>${text}</strong>`;
        }

        if (this.helpHtml === undefined) {
            this.helpHtml = '';
            try {
                let ret: string = '';

                if (!('name' in thInfo)) {
                    ret +=
                        `Thread name missing: Enable macro ${strong('CONFIG_THREAD_NAME')} and ` +
                        `use ${strong('k_thread_name_set')} in FW<br><br>`;
                }
                if (!th.stackInfo.stackSize) {
                    ret += `Stack information missing: Enable macro ${strong('CONFIG_THREAD_STACK_INFO')}`;
                }

                if (ret) {
                    ret +=
                        'Note: Make sure you consider the performance/resources impact for any changes to your FW.<br>\n';
                    this.helpHtml =
                        '<button class="help-button">Hints to get more out of the Zephyr RTOS View</button>\n' +
                        `<div class="help"><p>\n${ret}\n</p></div>\n`;
                }
            } catch (e) {
                console.log(e);
            }
        }
    }

    public refresh(frameId: number): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (this.progStatus !== 'stopped') {
                resolve();
                return;
            }

            const timer = new RTOSCommon.HrTimer();
            this.stale = true;
            this.timeInfo = new Date().toISOString();

            this.foundThreads = [];
            this.kernel?.getVarChildrenObj(frameId).then(
                async (kernel) => {
                    try {
                        if (this.threads) {
                            const threadListStart = await this.threads?.getValue(frameId);
                            if (threadListStart && 0 !== parseInt(threadListStart)) {
                                const tmpCurrentVal = await this.current?.getValue(frameId);
                                this.currentVal = tmpCurrentVal ? parseInt(tmpCurrentVal) : Number.MAX_SAFE_INTEGER;

                                await this.getThreadInfo(this.threads, frameId);
                                this.foundThreads.sort(
                                    (a, b) => parseInt(a.display['Address'].text) - parseInt(b.display['Address'].text)
                                );
                            }
                        } else {
                            //TODO Somehow state that user should enable CONFIG_THREAD_MONITOR
                        }

                        this.finalThreads = [...this.foundThreads];

                        this.stale = false;
                        this.timeInfo += ' in ' + timer.deltaMs() + ' ms';
                        resolve();
                    } catch (e) {
                        resolve();
                        console.error('Zephyr.refresh() failed: ', e);
                    }
                },
                (reason) => {
                    resolve();
                    console.error('Zephyr.refresh() failed: ', reason);
                }
            );
        });
    }

    private getThreadInfo(tcbListEntry: RTOSCommon.RTOSVarHelperMaybe, frameId: number): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (!tcbListEntry || !tcbListEntry.varReference) {
                resolve();
                return;
            }

            if (this.progStatus !== 'stopped') {
                reject(new Error('Busy'));
                return;
            }

            tcbListEntry.getVarChildrenObj(frameId).then(
                async (obj: RTOSCommon.RTOSStrToValueMap) => {
                    try {
                        let curTaskObj = obj;
                        let thAddress = parseInt(tcbListEntry?.value || '');

                        do {
                            let thName = '???';
                            if (curTaskObj['name']) {
                                const tmpThName =
                                    (await this.getExprVal('(char *)' + curTaskObj['name']?.exp, frameId)) || '';
                                const matchName = tmpThName.match(/"([^*]*)"$/);
                                thName = matchName ? matchName[1] : tmpThName;
                            }

                            const threadRunning = thAddress === this.currentVal;

                            const curTaskObjBase = await this.getVarChildrenObj(curTaskObj.base.ref, 'curTaskObjBase');

                            const thStateObject = await this.analyzeTaskState(curTaskObjBase);
                            const thState = thStateObject.describe();

                            const stackInfo = await this.getStackInfo(curTaskObj);

                            const display: { [key: string]: RTOSCommon.DisplayRowItem } = {};
                            const mySetter = (x: DisplayFields, text: string, value?: any) => {
                                display[DisplayFieldNames[x]] = { text, value };
                            };

                            mySetter(DisplayFields.Address, RTOSCommon.hexFormat(thAddress));
                            mySetter(DisplayFields.TaskName, thName);
                            mySetter(
                                DisplayFields.Status,
                                threadRunning ? 'RUNNING' : thState,
                                thStateObject.fullData()
                            );
                            mySetter(
                                DisplayFields.Priority,
                                curTaskObjBase ? parseInt(curTaskObjBase.prio.val).toString() : '???'
                            );

                            if (stackInfo.stackUsed !== undefined && stackInfo.stackSize !== undefined) {
                                const stackPercentVal = Math.round((stackInfo.stackUsed / stackInfo.stackSize) * 100);
                                const stackPercentText = `${stackPercentVal} % (${stackInfo.stackUsed} / ${stackInfo.stackSize})`;
                                mySetter(DisplayFields.StackPercent, stackPercentText, stackPercentVal);
                            } else {
                                mySetter(DisplayFields.StackPercent, '?? %');
                            }

                            const thread: RTOSCommon.RTOSThreadInfo = {
                                display: display,
                                stackInfo: stackInfo,
                                running: threadRunning,
                            };
                            this.foundThreads.push(thread);
                            this.createHmlHelp(thread, curTaskObj);

                            thAddress = parseInt(curTaskObj.next_thread?.val);
                            if (0 !== thAddress) {
                                const nextThreadObj = await this.getVarChildrenObj(
                                    curTaskObj.next_thread?.ref,
                                    'next_thread'
                                );
                                curTaskObj = nextThreadObj || {};
                            }
                        } while (0 !== thAddress);

                        resolve();
                    } catch (e) {
                        console.log('RTOSZEPHYR.getThreadInfo() error', e);
                    }
                },
                (e) => {
                    reject(e);
                }
            );
        });
    }

    protected async getEventInfo(
        address: number,
        eventObject: RTOSCommon.RTOSStrToValueMap,
        timeoutVal: number | null
    ): Promise<EventInfo> {
        // TODO Try to get actual event task is pending on
        const eventType = OsEventType.Generic; // TODO Get event type from actual event => via eventObject["waitq"]?.val somehow?
        const eventInfo: EventInfo = { address, eventType: eventType };

        if (timeoutVal) {
            eventInfo.timeout = timeoutVal;
        }

        // TODO Try to readout things like event object name here and add it if valid

        return eventInfo;
    }

    protected async getTaskTimeout(curTaskObjBase: RTOSCommon.RTOSStrToValueMap | null): Promise<number | null> {
        let timeoutValue = null;
        if (curTaskObjBase !== null && curTaskObjBase['timeout']?.ref) {
            const timeout = await this.getVarChildrenObj(curTaskObjBase.timeout?.ref, 'timeout');
            if (timeout) {
                timeoutValue = parseInt(timeout.dticks.val);
            }
        }
        return timeoutValue;
    }

    protected async analyzeTaskState(curTaskObjBase: RTOSCommon.RTOSStrToValueMap | null): Promise<TaskState> {
        if (curTaskObjBase === null) {
            return new TaskStateInvalid();
        } else {
            const state = parseInt(curTaskObjBase.thread_state.val);
            const timeoutValue = await this.getTaskTimeout(curTaskObjBase);
            switch (state) {
                case OsTaskState.DUMMY:
                    return new TaskDummy();
                case OsTaskState.PENDING:
                    const resultState = new TaskPending();
                    resultState.addEventType(OsEventType.Generic);
                    if (curTaskObjBase.pended_on?.val) {
                        const eventWaitQAddress = parseInt(curTaskObjBase.pended_on?.val);
                        if (eventWaitQAddress !== 0) {
                            const event = await this.getVarChildrenObj(curTaskObjBase.pended_on?.ref, 'pended_on');
                            if (event) {
                                const eventInfo = await this.getEventInfo(eventWaitQAddress, event, timeoutValue);
                                resultState.addEvent(eventInfo);
                            }
                        }
                    } else {
                        if (timeoutValue) {
                            const eventInfo: EventInfo = {
                                address: 0x00,
                                eventType: OsEventType.Generic,
                                timeout: timeoutValue,
                            };
                            resultState.addEvent(eventInfo);
                        }
                    }
                    return resultState;
                case OsTaskState.PRESTART:
                    return new TaskPrestart();
                case OsTaskState.DEAD:
                    return new TaskStateInvalid();
                case OsTaskState.SUSPENDED:
                    return new TaskSuspended(timeoutValue);
                case OsTaskState.ABORTING:
                    return new TaskAborting();
                case OsTaskState.READY:
                    return new TaskReady();
                default: {
                    return new TaskStateInvalid();
                }
            }
        }
    }

    protected async getStackInfo(thInfo: RTOSCommon.RTOSStrToValueMap | null) {
        const stackInfo: RTOSCommon.RTOSStackInfo = {
            stackStart: 0,
            stackTop: 0,
        };

        if (thInfo === null) {
            return stackInfo;
        }

        if (thInfo.callee_saved === null) {
            return stackInfo;
        }
        const callee_saved = await this.getVarChildrenObj(thInfo.callee_saved.ref, 'callee_saved');
        if (callee_saved === null) {
            return stackInfo;
        }

        const TopOfStack = callee_saved.psp.val; // FIXME This is not right for all arches => include\zephyr\arch\....\thread.h
        stackInfo.stackTop = parseInt(TopOfStack);

        /* only available with CONFIG_THREAD_STACK_INFO (optional) */
        if (thInfo.stack_info !== null) {
            const stack_info = await this.getVarChildrenObj(thInfo.stack_info.ref, 'stack_info');
            if (stack_info !== null) {
                const StackSize = stack_info['size']?.val;
                const StackStart = stack_info['start']?.val;
                const StackDelta = stack_info['delta']?.val;

                if (StackSize && StackStart && StackDelta) {
                    if (this.stackIncrements < 0) {
                        stackInfo.stackStart =
                            parseInt(StackStart) +
                            parseInt(StackSize) * this.stackEntrySize -
                            parseInt(StackDelta) * this.stackEntrySize;
                        stackInfo.stackEnd = parseInt(StackStart);
                    } else {
                        stackInfo.stackStart = parseInt(StackStart) + parseInt(StackDelta) * this.stackEntrySize;
                        stackInfo.stackEnd = parseInt(StackStart) + parseInt(StackSize) * this.stackEntrySize;
                    }

                    stackInfo.stackSize = parseInt(StackSize) * this.stackEntrySize;

                    if (this.stackIncrements < 0) {
                        const stackDelta = stackInfo.stackStart - stackInfo.stackTop;
                        stackInfo.stackFree = stackInfo.stackSize - stackDelta;
                        stackInfo.stackUsed = stackDelta;
                    } else {
                        const stackDelta = stackInfo.stackTop - stackInfo.stackStart;
                        stackInfo.stackFree = stackDelta;
                        stackInfo.stackUsed = stackInfo.stackSize - stackDelta;
                    }
                }
            }
        } else {
            /* As stackStart is mandatory, we need to set it to some reasonable value */
            stackInfo.stackStart = stackInfo.stackTop;
        }

        return stackInfo;
    }

    public lastValidHtmlContent: RTOSCommon.HtmlInfo = { html: '', css: '' };
    public getHTML(): RTOSCommon.HtmlInfo {
        const htmlContent: RTOSCommon.HtmlInfo = { html: '', css: '' };
        // WARNING: This stuff is super fragile. Once we know how this works, then we should refactor this
        let msg = '';
        if (this.status === 'none') {
            htmlContent.html = '<p>RTOS not yet fully initialized. Will occur next time program pauses</p>\n';
            return htmlContent;
        } else if (this.stale) {
            const lastHtmlInfo = this.lastValidHtmlContent;
            msg = ' Following info from last query may be stale.';
            htmlContent.html = `<p>Unable to collect full RTOS information.${msg}</p>\n` + lastHtmlInfo.html;
            htmlContent.css = lastHtmlInfo.css;
            return htmlContent;
        } else if (this.finalThreads.length === 0) {
            htmlContent.html = `<p>No ${this.name} threads detected, perhaps RTOS not yet initialized or tasks yet to be created!</p>\n`;
            return htmlContent;
        }

        const ret = this.getHTMLThreads(DisplayFieldNames, RTOSZEPHYRItems, this.finalThreads, this.timeInfo);
        htmlContent.html = msg + ret.html + (this.helpHtml || '');
        htmlContent.css = ret.css;

        this.lastValidHtmlContent = htmlContent;
        // console.log(this.lastValidHtmlContent.html);
        return this.lastValidHtmlContent;
    }
}

enum OsTaskState {
    DUMMY = 0x00 /* _THREAD_DUMMY / Not a real thread */,
    PENDING = 0x01 /* _THREAD_PENDING / Waiting */,
    PRESTART = 0x02 /* _THREAD_PRESTART / New */,
    DEAD = 0x04 /* _THREAD_DEAD / Terminated */,
    SUSPENDED = 0x10 /* _THREAD_SUSPENDED / Suspended (thread is not active until k_wakeup() is called on thread) */,
    ABORTING = 0x20 /* _THREAD_ABORTING / abort in progress */,
    READY = 0x80 /* _THREAD_QUEUED / Ready */,
}

enum OsEventType {
    Generic = 1,
}

abstract class TaskState {
    public abstract describe(): string;
    public abstract fullData(): any;
}

class TaskReady extends TaskState {
    public describe(): string {
        return 'READY';
    }

    public fullData(): any {
        return null;
    }
}

class TaskSuspended extends TaskState {
    private timeout?: number | null;

    constructor(timeout: number | null) {
        super();
        this.timeout = timeout;
    }

    public describe(): string {
        let suspendDescription = 'SUSPENDED';
        if (this.timeout && this.timeout !== 0) {
            suspendDescription += ` for: ${this.timeout.toString()} ms`;
        }
        return suspendDescription;
    }

    public fullData(): any {
        return null;
    }
}

class TaskAborting extends TaskState {
    public describe(): string {
        return 'ABORTING';
    }

    public fullData(): any {
        return null;
    }
}

class TaskPrestart extends TaskState {
    public describe(): string {
        return 'PRESTART';
    }

    public fullData(): any {
        return null;
    }
}

class TaskDummy extends TaskState {
    public describe(): string {
        return 'DUMMY';
    }

    public fullData(): any {
        return null;
    }
}

class TaskStateInvalid extends TaskState {
    public describe(): string {
        return '???';
    }

    public fullData(): any {
        return null;
    }
}

class TaskPending extends TaskState {
    private pendingInfo: Map<OsEventType, EventInfo[]>;

    constructor() {
        super();
        this.pendingInfo = new Map();
    }

    public addEvent(event: EventInfo) {
        this.addEventType(event.eventType);
        this.pendingInfo.get(event.eventType)?.push(event);
    }

    public addEventType(eventType: OsEventType) {
        if (!this.pendingInfo.has(eventType)) {
            this.pendingInfo.set(eventType, []);
        }
    }

    public describe(): string {
        // Converting to an array here is inefficient, but JS has no builtin iterator map/reduce feature
        const eventCount = [...this.pendingInfo.values()].reduce((acc, events) => acc + events.length, 0);

        if (eventCount <= 1) {
            let event: EventInfo | undefined;
            for (const events of this.pendingInfo.values()) {
                if (events.length > 0) {
                    event = events[0];
                }
            }

            if (event) {
                const eventTypeStr = OsEventType[event.eventType] ? OsEventType[event.eventType] : 'Unknown';
                return `PEND ${eventTypeStr}: ${describeEvent(event)}`;
            } else {
                // This should not happen, but we still keep it as a fallback
                return 'PEND Unknown';
            }
        } else {
            return 'PEND MULTI';
        }
    }

    public fullData() {
        // Build an object containing mapping event types to event descriptions
        const result: any = {};
        const eventTypes = [...this.pendingInfo.keys()];
        eventTypes.sort();
        for (const eventType of eventTypes) {
            result[OsEventType[eventType]] = [];
            for (const event of this.pendingInfo.get(eventType) || []) {
                result[OsEventType[eventType]].push(describeEvent(event));
            }
        }

        return result;
    }
}

interface EventInfo {
    name?: string;
    timeout?: number;
    address: number;
    eventType: OsEventType;
}

function describeEvent(event: EventInfo): string {
    let eventDescription: string = '';
    if (event.name && event.name !== '?') {
        eventDescription = event.name;
    } else {
        eventDescription = `0x${event.address.toString(16)}`;
    }

    if (event.timeout && event.timeout !== 0) {
        eventDescription += `, timeout: ${event.timeout.toString()}`;
    }

    return eventDescription;
}
