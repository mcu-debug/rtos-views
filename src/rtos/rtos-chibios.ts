/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from 'vscode';
import * as RTOSCommon from './rtos-common';

// We will have two rows of headers for ChibiOS and the table below describes
// the columns headers for the two rows and the width of each column as a fraction
// of the overall space.
enum threadDisplayFields {
    ID,
    THREAD_DESCRIPTION,
    FLAGS,
    REFS,
    TIME,
    WTOBJP,
    STATS_N,
    STATS_WORST,
    STATS_CUMULATIVE,
    STACK_CURRENT_USAGE,
    STACK_PEAK_USAGE
}

enum chThreadState {
    READY = 0,
    CURRENT,
    STARTED,
    SUSPENDED,
    QUEUED,
    WTSEM,
    WTMTX,
    WTCOND,
    SLEEPING,
    WTEXIT,
    WTOREVT,
    WTANDEVT,
    SNDMSGQ,
    SNDMSG,
    WTMSG,
    FINAL,
    UNKNOWN,
    _SIZE
}

const colNumType = RTOSCommon.ColTypeEnum.colTypeNumeric;
const threadTableItems: { [key: string]: RTOSCommon.DisplayColumnItem } = {};

threadTableItems[threadDisplayFields[threadDisplayFields.ID]] = {
    width: 2,
    headerRow1: '',
    headerRow2: 'id',
    colType: colNumType
};
threadTableItems[threadDisplayFields[threadDisplayFields.THREAD_DESCRIPTION]] = {
    width: 14,
    headerRow1: '',
    headerRow2: 'Thread',
    colGapBefore: 1
};
threadTableItems[threadDisplayFields[threadDisplayFields.FLAGS]] = {
    width: 2,
    headerRow1: '',
    headerRow2: 'Flags',
    colGapAfter: 1
};
threadTableItems[threadDisplayFields[threadDisplayFields.REFS]] = {
    width: 2,
    headerRow1: '',
    headerRow2: 'Refs',
    colType: colNumType
};
threadTableItems[threadDisplayFields[threadDisplayFields.TIME]] = {
    width: 2,
    headerRow1: '',
    headerRow2: 'Time',
    colType: colNumType
};
threadTableItems[threadDisplayFields[threadDisplayFields.WTOBJP]] = {
    width: 4,
    headerRow1: 'Wait',
    headerRow2: 'Obj/Msg',
    colGapBefore: 1
};
threadTableItems[threadDisplayFields[threadDisplayFields.STATS_N]] = {
    width: 4,
    headerRow1: 'Stats',
    headerRow2: 'Switches',
    colType: colNumType
};
threadTableItems[threadDisplayFields[threadDisplayFields.STATS_WORST]] = {
    width: 4,
    headerRow1: '',
    headerRow2: 'Worst Path',
    colType: colNumType
};
threadTableItems[threadDisplayFields[threadDisplayFields.STATS_CUMULATIVE]] = {
    width: 4,
    headerRow1: '',
    headerRow2: 'Cumulative Time',
    colType: colNumType
};
threadTableItems[threadDisplayFields[threadDisplayFields.STACK_CURRENT_USAGE]] = {
    width: 3,
    headerRow1: 'Stack',
    headerRow2: '',
    colType: colNumType
};
threadTableItems[threadDisplayFields[threadDisplayFields.STACK_PEAK_USAGE]] = {
    width: 3,
    headerRow1: '',
    headerRow2: '',
    colType: colNumType
};

const threadDisplayFieldNames: string[] = Object.keys(threadTableItems);

const globalInfoCols = [{ columnDataKey: 'name', title: 'Name' }, { columnDataKey: 'value', title: 'Value' } ];

const virtualTimersCols = [{ columnDataKey: 'timer', title: 'Timer' },
                           { columnDataKey: 'time', title: 'Time' },
                           { columnDataKey: 'delta', title: 'Delta' },
                           { columnDataKey: 'callback', title: 'Callback' },
                           { columnDataKey: 'params', title: 'Parameters' },
                           { columnDataKey: 'last', title: 'Last Deadline' },
                           { columnDataKey: 'reload', title: 'Reload' }];

const statisticsCols = [{ columnDataKey: 'description', title: 'Measured Section' },
                        { columnDataKey: 'best', title: 'Best Case' },
                        { columnDataKey: 'worst', title: 'Worst Case' },
                        { columnDataKey: 'counter', title: 'Iterations' },
                        { columnDataKey: 'cumulative', title: 'Cumulative Time' } ];

const traceCols = [{ columnDataKey: 'event', title: 'Event' },
                   { columnDataKey: 'eventType', title: 'Type' },
                   { columnDataKey: 'time', title: 'System Time' },
                   { columnDataKey: 'rtstamp', title: 'RT Stamp' },
                   { columnDataKey: 'from', title: 'From' },
                   { columnDataKey: 'fromName', title: 'Name' },
                   { columnDataKey: 'state', title: 'State' },
                   { columnDataKey: 'obj_msg', title: 'Obj/Msg' },
                   { columnDataKey: 'to', title: 'To' },
                   { columnDataKey: 'toName', title: 'Name' }];

enum chTraceEventTypes {
    READY = 'Ready',
    SWITCH = 'Switch',
    ISR_ENTER = 'ISR-enter',
    ISR_LEAVE = 'ISR-leave',
    HALT = 'Halt',
    USER = 'User',
    UNKNOWN = 'Unknown'
}

enum chMessages {
    UNKNOWN = '[UNKNOWN]',
    NULL = '[NULL]',
    NONE = '[NONE]',
    NO_NAME = '[NO NAME]',
    NOT_ENABLED = '[NOT ENABLED]',
    KERNEL_VERSION = 'Kernel version',
    SYSTEM_STATE = 'System state',
    SYSTEM_TIME = 'System time',
    SYSTEM_TIME_MODE = 'Systime mode',
    TICKLESS = 'tickless',
    SYSTICK = 'systick',
    LAST_EVENT_TIME = 'VT last event time',
    PANIC_MESSAGE = 'Panic message',
    ISR_LEVEL = 'ISR level',
    LOCK_LEVEL = 'Lock level',
    RLIST_PREEMPT = 'RList preempt',
    IRQS_COUNTER = 'IRQs counter',
    CTX_SW_COUNTER = 'Context Switches counter',
    THREAD_CRITICAL_ZONES = 'Threads Critical Zones',
    IRQS_CRITTICAL_ZONES = 'ISRs Critical Zones'
}

function getThreadStateName(s: number): string {
    if (s < chThreadState._SIZE) {
        return chThreadState[s];
    }

    return chThreadState[chThreadState._SIZE - 1];
}

function getCString(s: string, nullValue: string = ''): string {
    const matchName = s.match(/"([^*]*)"$/);

    return matchName ? matchName[1] : nullValue;
}

function getNumber(s: string): number {
    return s ? parseInt(s) : 0;
}

function getNumberNVL(s: string | null | undefined, nullValue: number): number {
    return s ? parseInt(s) : nullValue;
}

function nvl(v: any, nullValue: any) {
    if (v === undefined || v === null) {
        return nullValue;
    }

    return v;
}

function getStackDisplayPercentage(s?: number, v?: number) {
    let text = '-';
    let percent = 0;

    if (s !== undefined && v !== undefined) {
        if (v === -1) {
            text = 'overflow';
            percent = 100;
        } else {
            percent = Math.round((v / s) * 100);
            text = `${percent.toString()}% (${v} / ${s})`;
        }
    }

    return { text: text, percent: percent };
}

function getStackDisplayValue(v?: number): string {
    let text = '-';

    if (v) {
        if (v === -1) {
            text = 'overflow';
        } else {
            text = v.toString();
        }
    }

    return text;
}
export class RTOSChibiOS extends RTOSCommon.RTOSBase {
    // We keep a bunch of variable references (essentially pointers) that we can use to query for values
    // Since all of them are global variable, we only need to create them once per session. These are
    // similar to Watch/Hover variables
    private chRlistCurrent: RTOSCommon.RTOSVarHelperMaybe;
    private chReglist: RTOSCommon.RTOSVarHelperMaybe;
    private chCH0!: RTOSCommon.RTOSStrToValueMap;
    private chVTList!: RTOSCommon.RTOSStrToValueMap;
    private chDebug!: RTOSCommon.RTOSStrToValueMap;

    private chConfigDBGFillThreads: boolean = false;

    private kernelVersion: string = chMessages.UNKNOWN;
    private rlistCurrent: number = 0;
    private threadOffset: number = 0;
    private threadSize: number = 0;
    private traceRecordSize: number = 0;
    private smp: boolean = false;
    private hasWAEND: boolean = false;
    private hasWABASE: boolean = false;

    private stale: boolean = true;
    private foundThreads: RTOSCommon.RTOSThreadInfo[] = [];
    private finalThreads: RTOSCommon.RTOSThreadInfo[] = [];
    private threads: Map<number, string> = new Map();
    private globalInfo: any[] = [];
    private virtualTimersInfo: any[] = [];
    private statistics: any[] = [];
    private trace: any[] = [];
    private timeInfo: string = '';
    private helpHtml: string | undefined;

    // Need to do a TON of testing for stack growing the other direction
    private stackIncrements = -1;

    private readonly maxThreads = 1024;

    constructor(public session: vscode.DebugSession) {
        super(session, 'ChibiOS');
    }

    private async scanStackUnused(stackTop: number, stackEnd: number, s: number) {
        const stackData = await this.session.customRequest('readMemory', {
            memoryReference: RTOSCommon.hexFormat(Math.min(stackTop, stackEnd)),
            count: s
        });

        const bytes = new Uint8Array(Buffer.from(stackData.data, 'base64'));

        let unused = 0;
        while (unused < bytes.length && bytes[unused] === 0x55) {
            unused++;
        }

        return unused;
    }

    private async getStackPointer(threadAddr: number, frameId: number) {

        let stack = await this.getExprVal(`((struct ch_thread *) ${threadAddr})->ctx.r13`, frameId);

        if (!stack) {
            stack = await this.getExprVal(`((struct ch_thread *) ${threadAddr})->ctx.sp`, frameId);
        }

        return getNumberNVL(stack, 0);
    }

    private getStackPeak(stackInfo: RTOSCommon.RTOSStackInfo, unused: number) {
        let peak = undefined;

        if (this.hasWAEND) {
            // Calculate stack peak
            if (stackInfo.stackSize && stackInfo.stackSize !== 0) {
                peak = Math.max(0, stackInfo.stackSize - unused);
            }
        } else {
            // Assign stack min free size
            peak = unused;
        }

        return peak;
    }

    public async tryDetect(useFrameId: number): Promise<RTOSCommon.RTOSBase> {
        this.progStatus = 'stopped';
        try {
            if (this.status === 'none') {
                // We only get references to all the interesting variables. Note that any one of the following can fail
                // and the caller may try again until we know that it definitely passed or failed. Note that while we
                // re-try everything, we do remember what already had succeeded and don't waste time trying again. That
                // is how this.getVarIfEmpty() works
                try {
                    this.chReglist = await this.getVarIfEmpty(
                        this.chReglist,
                        useFrameId,
                        '&ch_system.reglist',
                        false
                    );
                    this.smp = true;
                } catch (e) {
                    if (e instanceof RTOSCommon.ShouldRetry) {
                        throw e;
                    }
                    this.chReglist = await this.getVarIfEmpty(
                        this.chReglist, useFrameId,
                        '&ch0.reglist',
                        false);
                }

                this.chRlistCurrent = await this.getVarIfEmpty(
                    this.chRlistCurrent, useFrameId,
                    'ch0.rlist.current',
                    false);
                this.threadOffset = parseInt(await this.getExprVal(
                    '((char *)(&((thread_t *)0)->rqueue) - (char *)0)',
                    useFrameId) || '');
                this.threadSize = parseInt(await this.getExprVal('sizeof(thread_t)', useFrameId) || '');
                this.traceRecordSize = parseInt(await this.getExprVal('sizeof(trace_event_t)', useFrameId) || '');
                this.chDebug = await this.getExprValChildrenObj('ch_debug', useFrameId);

                if (await this.getExprVal('ch0.rlist.current.wabase', useFrameId)) {
                    this.hasWABASE = true;
                }

                if (!(await this.getExprVal('ch0.rlist.current.waend', useFrameId))) {
                    // old version without waend
                    threadTableItems[threadDisplayFields[threadDisplayFields.STACK_CURRENT_USAGE]] = {
                        width: 3,
                        headerRow1: 'Stack',
                        headerRow2: 'Current free',
                        colType: colNumType
                    };
                    threadTableItems[threadDisplayFields[threadDisplayFields.STACK_PEAK_USAGE]] = {
                        width: 3,
                        headerRow1: '',
                        headerRow2: 'Min. free',
                        colType: colNumType
                    };
                } else {
                    // new version with waend
                    threadTableItems[threadDisplayFields[threadDisplayFields.STACK_CURRENT_USAGE]] = {
                        width: 4,
                        headerRow1: 'Stack',
                        headerRow2: 'Current %<br><small>(Used B / Size B)</small>',
                        colType: RTOSCommon.ColTypeEnum.colTypePercentage
                    };
                    threadTableItems[threadDisplayFields[threadDisplayFields.STACK_PEAK_USAGE]] = {
                        width: 4,
                        headerRow1: '',
                        headerRow2: 'Peak %<br><small>(Peak B / Size B)</small>',
                        colType: RTOSCommon.ColTypeEnum.colTypePercentage
                    };
                    this.hasWAEND = true;
                }

                if (await this.getExprVal('__thd_stackfill', useFrameId)) {
                    this.chConfigDBGFillThreads = true;
                }

                if (this.chDebug['version']) {
                    const v = parseInt(this.chDebug['version']?.val);
                    const major = (v >> 11) & 0xF;
                    const minor = (v >> 6) & 0xF;
                    const patch = (v >> 0) & 0xF;

                    this.kernelVersion = `${major}.${minor}.${patch}`;
                }

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

    protected createHmlHelp() {
        function strong(text: string) {
            return `<strong>${text}</strong>`;
        }

        if (this.helpHtml === undefined) {
            this.helpHtml = '';
            try {
                let ret: string = '';

                if (!this.hasWABASE) {
                    ret +=
                        `Thread stack debug information is not enabled: to enable set
                        ${strong('CH_DBG_ENABLE_STACK_CHECK')} to ${strong('TRUE')} in chconf.h<br><br>`;
                }

                if (!this.chConfigDBGFillThreads) {
                    ret +=
                        `Thread stack peak calculation is disabled: to enable set
                        ${strong('CH_DBG_FILL_THREADS')} to ${strong('TRUE')} in chconf.h<br><br>`;
                }

                if (!this.chCH0['kernel_stats']) {
                    ret +=
                        `Kernel statistics are not enabled: to enable set
                        ${strong('CH_DBG_STATISTICS')} to ${strong('TRUE')} in chconf.h<br><br>`;
                }

                if (ret) {
                    ret +=
                        'Note: Make sure you consider the performance/resources impact for any changes to your FW.<br>\n';
                    this.helpHtml =
                        `<button class="help-button">Hints to get more out of the ChibiOS RTOS View</button>\n
                        <div class="help"><p>\n${ret}\n</p></div>\n`;
                }
            } catch (e) {
                console.log(e);
            }
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
            this.timeInfo = (new Date()).toLocaleString();
            this.globalInfo = [];
            this.foundThreads = [];
            this.finalThreads = [];
            this.virtualTimersInfo = [];
            this.statistics = [];
            this.trace = [];
            this.threads.clear();

            this.chRlistCurrent?.getValue(frameId).then(
                async (rlistCurrentStr) => {
                    try {
                        this.chCH0 = await this.getExprValChildrenObj('ch0', frameId);
                        this.chVTList = await this.getVarChildrenObj(this.chCH0['vtlist']?.ref, 'vtlist') || {};
                        this.rlistCurrent = getNumberNVL(rlistCurrentStr, 0);

                        if (0 !== this.rlistCurrent) {
                            await this.getRTOSInfo(this.chReglist, frameId);
                            this.finalThreads = [...this.foundThreads];
                        } else {
                            this.finalThreads = [];
                        }

                        this.stale = false;
                        this.timeInfo += ' in ' + timer.deltaMs() + ' ms';
                        resolve();
                    } catch (e) {
                        resolve();
                        console.error('ChibiOS.refresh() failed: ', e);
                    }
                },
                (reason) => {
                    resolve();
                    console.error('ChibiOS.refresh() failed: ', reason);
                }
            );
        });
    }

    private getRTOSInfo(reglist: RTOSCommon.RTOSVarHelperMaybe, frameId: number): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (!reglist) {
                resolve();
                return;
            }

            if (this.progStatus !== 'stopped') {
                reject(new Error('Busy'));
                return;
            }

            reglist.getValue(frameId).then(async (reglistVal) => {
                try {
                    await this.getGlobalInfo(frameId);
                    await this.getThreadInfo(getNumberNVL(reglistVal, 0), frameId);
                    await this.getVirtualTimersInfo(frameId);
                    await this.getStatisticsInfo();
                    resolve();
                }
                catch (e) {
                    console.log('ChibiOS.getRTOSInfo() error: ', e);
                }
            }, (e) => {
                reject(e);
            });
        });
    }

    protected async getGlobalInfo(frameId: number) {

        const system = await this.getExprValChildrenObj('ch_system', frameId);
        const debug = await this.getVarChildrenObj(this.chCH0['dbg']?.ref, 'dbg') || {};
        const rlist = await this.getVarChildrenObj(this.chCH0['rlist']?.ref, 'rlist') || {};

        this.globalInfo.push({ name: chMessages.KERNEL_VERSION, value: this.kernelVersion });
        this.globalInfo.push({
            name: chMessages.SYSTEM_STATE,
            value: system['state'] ? system['state'].val : chMessages.UNKNOWN
        });

        if (this.chVTList['lasttime']) {
            this.globalInfo.push({ name: chMessages.SYSTEM_TIME_MODE, value: chMessages.TICKLESS });
            this.globalInfo.push({ name: chMessages.LAST_EVENT_TIME, value: this.chVTList['lasttime'].val });
        } else if (this.chVTList['systime']) {
            this.globalInfo.push({ name: chMessages.SYSTEM_TIME_MODE, value: chMessages.SYSTICK });
            this.globalInfo.push({ name: chMessages.SYSTEM_TIME, value: this.chVTList['systime'].val });
        } else {
            this.globalInfo.push({ name: chMessages.SYSTEM_TIME, value: chMessages.UNKNOWN });
        }

        if (debug['panic_msg']) {
            this.globalInfo.push({
                name: chMessages.PANIC_MESSAGE,
                value: getCString(debug['panic_msg'].val,
                chMessages.NONE)
            });
        } else {
            this.globalInfo.push({ name: chMessages.PANIC_MESSAGE, value: chMessages.NOT_ENABLED });
        }

        if (debug['isr_cnt']) {
            this.globalInfo.push({
                name: chMessages.ISR_LEVEL,
                value: getNumber(debug['isr_cnt'].val) === 0 ? 'not within ISR' : 'within ISR - ' + debug['isr_cnt']?.val
            });
        } else {
            this.globalInfo.push({ name: chMessages.ISR_LEVEL, value: chMessages.NOT_ENABLED });
        }

        if (debug['lock_cnt']) {
            this.globalInfo.push({
                name: chMessages.LOCK_LEVEL,
                value: getNumber(debug['lock_cnt'].val) === 0
                ? 'not within lock' : 'within lock - ' + debug['lock_cnt']?.val
            });
        } else {
            this.globalInfo.push({ name: chMessages.LOCK_LEVEL, value: chMessages.NOT_ENABLED });
        }

        if (rlist['preempt']) {
            this.globalInfo.push({ name: chMessages.RLIST_PREEMPT, value: rlist['preempt'] });
        }
    }

    protected async getThreadInfo(reglistHeader: number, frameId: number) {
        if (reglistHeader && 0 !== reglistHeader) {
            let nextEntry = await this.getExprValChildrenObj('(ch_queue_t *)' + reglistHeader, frameId);
            let currentReglist = getNumber(nextEntry['next'].val);
            let i = 0;

            // TODO: add reglist integrity check

            do {
                const currentThreadAddr = currentReglist - this.threadOffset;
                const currentThread = await this.getExprValChildrenObj(`(thread_t *) ${currentThreadAddr}`, frameId);
                const currentThreadPqueue = await this.getExprValChildrenObj(
                    `((thread_t *) ${currentThreadAddr} )->hdr.pqueue`,
                    frameId
                );
                const currentThreadStateDetails = await this.getVarChildrenObj(currentThread['u']?.ref, 'u') || {};
                const currentThreadStats = await this.getVarChildrenObj(currentThread['stats']?.ref, 'stats') || {};

                const threadRunning = (currentThreadAddr === this.rlistCurrent);
                const threadName = getCString(currentThread['name'].val, chMessages.NO_NAME);
                const threadState = getThreadStateName(getNumberNVL(currentThread['state']?.val, chThreadState._SIZE));
                const threadFlags = getNumberNVL(currentThread['flags']?.val, 0);
                const threadPrio = getNumberNVL(currentThreadPqueue['prio']?.val, 0);
                const threadRefs = getNumberNVL(currentThread['refs']?.val, 0);
                const threadTime = nvl(currentThread['time']?.val, '-');
                const threadWaitForObj = currentThreadStateDetails['wtobjp']?.val;
                const threadStatsN = nvl(currentThreadStats['n']?.val, '-');
                const threadStatsWorst = nvl(currentThreadStats['worst']?.val, '-');
                const threadStatsCumulative = nvl(currentThreadStats['cumulative']?.val, '-');

                const stackInfo = await this.getStackInfo(currentThreadAddr, currentThread, frameId);

                i++;

                const display: { [key: string]: RTOSCommon.DisplayRowItem } = {};
                const mySetter = (x: threadDisplayFields, text: string, value?: any) => {
                    display[threadDisplayFieldNames[x]] = { text, value };
                };

                mySetter(threadDisplayFields.ID, i.toString());
                mySetter(
                    threadDisplayFields.THREAD_DESCRIPTION,
                    threadName + '@' + RTOSCommon.hexFormat(currentThreadAddr) + ' ' + threadState +
                    ' [P:' + threadPrio + ']'
                );
                mySetter(threadDisplayFields.FLAGS, RTOSCommon.hexFormat(threadFlags, 2));
                mySetter(threadDisplayFields.REFS, threadRefs.toString());
                mySetter(threadDisplayFields.TIME, threadTime);
                mySetter(threadDisplayFields.WTOBJP, RTOSCommon.hexFormat(parseInt(threadWaitForObj)));
                mySetter(threadDisplayFields.STATS_N, threadStatsN);
                mySetter(threadDisplayFields.STATS_WORST, threadStatsWorst);
                mySetter(threadDisplayFields.STATS_CUMULATIVE, threadStatsCumulative);

                if (this.hasWAEND) {
                    const currentStackUsage = getStackDisplayPercentage(stackInfo.stackSize, stackInfo.stackUsed);
                    const peakStackUsage = getStackDisplayPercentage(stackInfo.stackSize, stackInfo.stackPeak);
                    mySetter(threadDisplayFields.STACK_CURRENT_USAGE, currentStackUsage.text, currentStackUsage.percent);
                    mySetter(threadDisplayFields.STACK_PEAK_USAGE, peakStackUsage.text, peakStackUsage.percent);
                } else {
                    mySetter(threadDisplayFields.STACK_CURRENT_USAGE, getStackDisplayValue(stackInfo.stackFree));
                    mySetter(threadDisplayFields.STACK_PEAK_USAGE, getStackDisplayValue(stackInfo.stackPeak));
                }

                const threadInfo: RTOSCommon.RTOSThreadInfo = {
                    display: display, stackInfo: stackInfo, running: threadRunning
                };

                this.foundThreads.push(threadInfo);
                this.threads.set(currentThreadAddr, threadName);

                nextEntry = await this.getExprValChildrenObj(`(ch_queue_t *) ${currentReglist}`, frameId);
                currentReglist = getNumberNVL(nextEntry['next']?.val, 0);

            } while ((reglistHeader !== currentReglist) && (currentReglist !== 0));
        }
    }

    protected async getStackInfo(threadAddr:number, threadInfo: RTOSCommon.RTOSStrToValueMap, frameId: number) {

        const stackInfo: RTOSCommon.RTOSStackInfo = {
            stackStart: 0,
            stackTop: 0
        };

        stackInfo.stackEnd = getNumberNVL(threadInfo['wabase']?.val, 0);
        stackInfo.stackTop = await this.getStackPointer(threadAddr, frameId);

        if (this.hasWAEND) {
            stackInfo.stackStart = getNumberNVL(threadInfo['waend']?.val, 0) - this.threadSize;

            if (stackInfo.stackStart > 0 && stackInfo.stackEnd !== 0) {
                stackInfo.stackSize = Math.abs(stackInfo.stackStart - stackInfo.stackEnd);
                if (stackInfo.stackTop === 0) {
                    stackInfo.stackTop = stackInfo.stackStart;
                }
            } else {
                stackInfo.stackStart = 0;
            }
        } else {
            stackInfo.stackStart = stackInfo.stackTop;
        }

        if (stackInfo.stackTop === 0 || stackInfo.stackEnd === 0) {
            // unknown stack
            stackInfo.stackFree = stackInfo.stackPeak = stackInfo.stackUsed = undefined;
        } else if (stackInfo.stackTop < stackInfo.stackEnd) {
            // stack overflow
            stackInfo.stackFree = stackInfo.stackPeak = stackInfo.stackUsed = -1;
        } else {
            stackInfo.stackFree = Math.abs(stackInfo.stackTop - stackInfo.stackEnd);

            if (stackInfo.stackSize && stackInfo.stackSize !== 0) {
                stackInfo.stackUsed = Math.max(0, stackInfo.stackSize - stackInfo.stackFree);
            }

            if (this.chConfigDBGFillThreads && !RTOSCommon.RTOSBase.disableStackPeaks) {
                // get stack peak
                const unused = await this.scanStackUnused(stackInfo.stackTop, stackInfo.stackEnd, stackInfo.stackFree);
                stackInfo.stackPeak = this.getStackPeak(stackInfo, unused);
            }
        }

        return stackInfo;
    }

    protected async getVirtualTimersInfo(frameId: number) {

        if (this.chCH0['vtlist']) {

            const head = getNumberNVL(await this.getExprVal('&ch0.vtlist.dlist', frameId), 0);
            let dlist = await this.getVarChildrenObj(this.chVTList['dlist']?.ref, '') || {};
            let current = getNumberNVL(dlist['next']?.val, 0);
            let time = 0;

            while ((current !== head) && (current !== 0)) {
                const virtualTimer = await this.getExprValChildrenObj(`(struct ch_virtual_timer *) ${current}`, frameId);
                const timer = dlist['next'].val;
                dlist = await this.getVarChildrenObj(virtualTimer['dlist']?.ref, 'dlist') || {};
                const delta = getNumberNVL(dlist['delta']?.val, 0);
                time = time + delta;
                this.virtualTimersInfo.push({
                    timer: timer,
                    time: time,
                    delta: dlist['delta']?.val,
                    callback: virtualTimer['func']?.val,
                    params: virtualTimer['par']?.val,
                    last: virtualTimer['last'] ? virtualTimer['par'].val : '-',
                    reload: virtualTimer['reload'] ? virtualTimer['reload'].val : '-'
                });
                current = getNumberNVL(dlist['next'].val, 0);
            }
        }
    }

    protected async getStatisticsInfo() {

        if (this.chCH0['kernel_stats']) {

            const kernelStats = await this.getVarChildrenObj(this.chCH0['kernel_stats']?.ref, 'kernel_stats') || {};

            const nIRQVal = kernelStats['n_irq'].val;
            const nCtxSwcVal = kernelStats['n_ctxswc'].val;
            const kernelStatsCriticalThd = await this.getVarChildrenObj(kernelStats['m_crit_thd']?.ref, 'm_crit_thd');
            const kernelStatsCriticalIsr = await this.getVarChildrenObj(kernelStats['m_crit_isr']?.ref, 'm_crit_isr');

            if (nIRQVal) {
                this.statistics.push({
                    description: chMessages.IRQS_COUNTER,
                    best: '',
                    worst: '',
                    counter: nIRQVal.toString(),
                    cumulative: ''
                });
            }

            if (nCtxSwcVal) {
                this.statistics.push({
                    description: chMessages.CTX_SW_COUNTER,
                    best: '',
                    worst: '',
                    counter: nCtxSwcVal.toString(),
                    cumulative: ''
                });
            }

            if (kernelStatsCriticalThd) {
                let best = parseInt(kernelStatsCriticalThd['best']?.val);
                let worst = parseInt(kernelStatsCriticalThd['worst']?.val);
                let n = parseInt(kernelStatsCriticalThd['n']?.val);
                let cumulative = parseInt(kernelStatsCriticalThd['cumulative']?.val);

                if (best > worst) {
                    best = 0;
                    worst = 0;
                    n = 0;
                    cumulative = 0;
                }

                this.statistics.push({
                    description: chMessages.THREAD_CRITICAL_ZONES,
                    best: best.toString(),
                    worst: worst.toString(),
                    counter: n.toString(),
                    cumulative: cumulative.toString()
                });
            }

            if (kernelStatsCriticalIsr) {
                let best = parseInt(kernelStatsCriticalIsr['best']?.val);
                let worst = parseInt(kernelStatsCriticalIsr['worst']?.val);
                let n = parseInt(kernelStatsCriticalIsr['n']?.val);
                let cumulative = parseInt(kernelStatsCriticalIsr['cumulative']?.val);

                if (best > worst) {
                    best = 0;
                    worst = 0;
                    n = 0;
                    cumulative = 0;
                }

                this.statistics.push({
                    description: chMessages.IRQS_CRITTICAL_ZONES,
                    best: best.toString(),
                    worst: worst.toString(),
                    counter: n.toString(),
                    cumulative: cumulative.toString()
                });
            }

        }
    }

    protected async getTraceBuffer(frameId: number) {

        if (this.chCH0['trace_buffer']) {

            const traceBufferSize = parseInt(await this.getExprVal('ch0.trace_buffer.size', frameId) || '');

            if (traceBufferSize > 0) {

                const traceBuffer = await this.getVarChildrenObj(this.chCH0['trace_buffer']?.ref, 'trace_buffer') || {};
                const events = await this.getVarChildrenObj(traceBuffer['buffer']?.ref, 'buffer') || {};
                const next = parseInt(
                    await this.getExprVal('(ch0.trace_buffer.ptr - ch0.trace_buffer.buffer)', frameId) || ''
                );
                let i = next;
                let n = 1;

                do {
                    const event = await this.getVarChildrenObj(events[i]?.ref, '') || {};
                    const eventType = getNumberNVL(event['type']?.val, 0);

                    if (eventType > 0) {

                        const event = await this.getVarChildrenObj(events[i]?.ref, '') || {};
                        const u = await this.getVarChildrenObj(event['u']?.ref, '') || {};

                        switch (eventType) {
                            case 1:
                                const rdy = await this.getVarChildrenObj(u['rdy']?.ref, 'rdy') || {};
                                const tp = parseInt(rdy['tp']?.val);
                                this.trace.push({
                                    event: n,
                                    eventType: chTraceEventTypes.READY,
                                    state: '',
                                    rtstamp: event['rtstamp']?.val,
                                    time: event['time']?.val,
                                    from:  RTOSCommon.hexFormat(tp),
                                    fromName: this.threads.get(tp),
                                    obj_msg: RTOSCommon.hexFormat(parseInt(rdy['msg']?.val)),
                                    to: '',
                                    toName: ''
                                });
                                break;
                            case 2:
                                const sw =  await this.getVarChildrenObj(u['sw']?.ref, 'sw') || {};
                                const ntp = parseInt(sw['ntp']?.val);
                                this.trace.push({
                                    event: n,
                                    eventType: chTraceEventTypes.READY,
                                    state: getThreadStateName(parseInt(event['state']?.val)),
                                    rtstamp: parseInt(event['rtstamp']?.val),
                                    time: parseInt(event['time']?.val),
                                    from: '',
                                    fromName: '',
                                    obj_msg: RTOSCommon.hexFormat(parseInt(sw['wtobjp']?.val)),
                                    to: RTOSCommon.hexFormat(ntp),
                                    toName: this.threads.get(ntp)
                                });
                                break;
                            case 3:
                            case 4:
                                const isr =  await this.getVarChildrenObj(u['isr']?.ref, 'isr') || {};
                                this.trace.push({
                                    event: n,
                                    eventType:
                                        eventType === 3 ? chTraceEventTypes.ISR_ENTER : chTraceEventTypes.ISR_LEAVE,
                                    state: '',
                                    rtstamp: parseInt(event['rtstamp']?.val),
                                    time: parseInt(event['time']?.val),
                                    from: '',
                                    fromName: getCString(isr['name']?.val),
                                    obj_msg: '',
                                    to: '',
                                    toName: ''
                                });
                                break;
                            case 5:
                                const halt =  await this.getVarChildrenObj(u['halt']?.ref, 'halt') || {};
                                this.trace.push({
                                    event: n,
                                    eventType: chTraceEventTypes.HALT,
                                    state: '',
                                    rtstamp: parseInt(event['rtstamp']?.val),
                                    time: parseInt(event['time']?.val),
                                    from: '',
                                    fromName: getCString(halt['reason']?.val),
                                    obj_msg: '',
                                    to: '',
                                    toName: ''
                                });
                                break;
                            case 6:
                                const user =  await this.getVarChildrenObj(u['user']?.ref, 'user') || {};
                                this.trace.push({
                                    event: n,
                                    eventType: chTraceEventTypes.USER,
                                    state: '',
                                    rtstamp: parseInt(event['rtstamp']?.val),
                                    time: parseInt(event['time']?.val),
                                    from: RTOSCommon.hexFormat(parseInt(user['up1']?.val)),
                                    fromName: '',
                                    obj_msg: '',
                                    to: RTOSCommon.hexFormat(parseInt(user['up2']?.val)),
                                    toName: ''
                                });
                                break;
                            default:
                                break;
                        }
                        n++;
                    }

                    i++;

                    if (i === traceBufferSize) {
                        i = 0;
                    }

                } while (i !== next);
            }
        }

    }

    public lastValidHtmlContent: RTOSCommon.HtmlInfo = { html: '', css: '' };
    public getHTML(): RTOSCommon.HtmlInfo {
        const htmlContent: RTOSCommon.HtmlInfo = { html: '', css: '' };
        // WARNING: This stuff is super fragile. Once we know how this works, then we should refactor this
        if (this.status === 'none') {
            htmlContent.html = '<p>RTOS not yet fully initialized. Will occur next time program pauses</p>\n';
            return htmlContent;
        } else if (this.stale) {
            const lastHtmlInfo = this.lastValidHtmlContent;
            htmlContent.html = '<p>Unable to collect full RTOS information.</p>\n' + lastHtmlInfo.html;
            htmlContent.css = lastHtmlInfo.css;
            return htmlContent;
        } else if (this.finalThreads.length === 0) {
            htmlContent.html =
                            `<p>No ${this.name} threads detected, perhaps RTOS not yet initialized or
                            tasks yet to be created!</p>\n`;
            return htmlContent;
        }

        this.createHmlHelp();

        const htmlThreads = this.getHTMLThreads(threadDisplayFieldNames, threadTableItems, this.finalThreads, '');

        const htmlGlobalInfo = this.getHTMLDataGrid(globalInfoCols,
                                                    this.globalInfo,
                                                    [{ name: 'id', value: 'global' },
                                                     { name: 'aria-label', value: 'Global Variables' },
                                                     { name: 'grid-template-columns', value: '30% 70%' }]);

        const htmlVirtualTimersInfo = this.getHTMLDataGrid(virtualTimersCols,
                                                           this.virtualTimersInfo,
                                                           [{ name: 'id', value: 'timers' },
                                                            { name: 'aria-label', value: 'Virtual Timers' }]);

        const htmlStatistics = this.getHTMLDataGrid(statisticsCols,
                                                    this.statistics,
                                                    [{ name: 'id', value: 'statistics' },
                                                     { name: 'aria-label', value: 'Statistics' }]);

        const htmlRTOSPanels = this.getHTMLPanels([{ title: `THREADS
                                                            <vscode-badge appearance="secondary">
                                                            ${this.finalThreads.length}
                                                            </vscode-badge>` },
                                                   { title: 'GLOBAL' },
                                                   { title: `TIMERS
                                                            <vscode-badge appearance="secondary">
                                                            ${this.virtualTimersInfo.length}
                                                            </vscode-badge>` },
                                                   { title: 'STATISTICS' }],
                                                  [{ content: htmlThreads.html },
                                                   { content: htmlGlobalInfo },
                                                   { content: htmlVirtualTimersInfo },
                                                   { content: htmlStatistics }],
                                                  [{ name: 'id', value: 'rtos-panels' },
                                                   { name: 'aria-label', value: 'ChibiOS RTOS Information Panel' },
                                                   { name: 'activeid', value: this.uiElementState.get('rtos-panels.activeid') },
                                                   { name: 'debug-session-id', value: this.session.id }],
                                                   true);

        htmlContent.html = `${htmlRTOSPanels}\n<p>Data collected at ${this.timeInfo}</p>\n`;

        htmlContent.html += (this.helpHtml || '');
        htmlContent.css = htmlThreads.css;

        this.lastValidHtmlContent = htmlContent;
        return this.lastValidHtmlContent;
    }
}
