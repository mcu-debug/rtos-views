/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from 'vscode';
import { DebugProtocol } from '@vscode/debugprotocol';
import * as RTOSCommon from './rtos-common';

// We will have two rows of headers for uC/OS-III and the table below describes
// the columns headers for the two rows and the width of each column as a fraction
// of the overall space.
enum DisplayFields {
    Address,
    TaskName,
    Status,
    Priority,
    StackPercent,
    StackPeakPercent,
    Runtime
}

const RTOSUCOS3Items: { [key: string]: RTOSCommon.DisplayColumnItem } = {};
RTOSUCOS3Items[DisplayFields[DisplayFields.Address]] = {
    width: 2,
    headerRow1: '',
    headerRow2: 'Address',
    colGapBefore: 1
};
RTOSUCOS3Items[DisplayFields[DisplayFields.TaskName]] = {
    width: 4,
    headerRow1: '',
    headerRow2: 'Name',
    colGapBefore: 1
};
RTOSUCOS3Items[DisplayFields[DisplayFields.Status]] = {
    width: 4,
    headerRow1: 'Thread',
    headerRow2: 'Status',
    colType: RTOSCommon.ColTypeEnum.colTypeCollapse
};
RTOSUCOS3Items[DisplayFields[DisplayFields.Priority]] = {
    width: 1,
    headerRow1: 'Prio',
    headerRow2: 'rity',
    colType: RTOSCommon.ColTypeEnum.colTypeNumeric,
    colGapAfter: 1
}; // 3 are enough but 4 aligns better with header text
RTOSUCOS3Items[DisplayFields[DisplayFields.StackPercent]] = {
    width: 4,
    headerRow1: 'Stack Usage',
    headerRow2: '% (Used B / Size B)',
    colType: RTOSCommon.ColTypeEnum.colTypePercentage
};
RTOSUCOS3Items[DisplayFields[DisplayFields.StackPeakPercent]] = {
    width: 4,
    headerRow1: 'Stack Peak Usage',
    headerRow2: '% (Peak B / Size B)',
    colType: RTOSCommon.ColTypeEnum.colTypePercentage
};
RTOSUCOS3Items[DisplayFields[DisplayFields.Runtime]] = {
    width: 2,
    headerRow1: '',
    headerRow2: 'Runtime',
    colType: RTOSCommon.ColTypeEnum.colTypeNumeric
};

const DisplayFieldNames: string[] = Object.keys(RTOSUCOS3Items);

export class RTOSUCOS3 extends RTOSCommon.RTOSBase {
    // We keep a bunch of variable references (essentially pointers) that we can use to query for values
    // Since all of them are global variable, we only need to create them once per session. These are
    // similar to Watch/Hover variables
    private OSRunning: RTOSCommon.RTOSVarHelperMaybe;
    private OSRunningVal: number = 0;

    private stackEntrySize: number = 0;

    private OSTaskCtr: RTOSCommon.RTOSVarHelperMaybe;
    private OSTaskCtrVal: number = 0;

    private OSTCBList: RTOSCommon.RTOSVarHelperMaybe;

    private OSTCBCur: RTOSCommon.RTOSVarHelperMaybe;
    private OSTCBCurVal: number = 0;

    private CPU_TS_TmrFreq_Hz: RTOSCommon.RTOSVarHelperMaybe;

    private stale: boolean = true;
    private foundThreads: RTOSCommon.RTOSThreadInfo[] = [];
    private finalThreads: RTOSCommon.RTOSThreadInfo[] = [];
    private timeInfo: string = '';
    private readonly maxThreads = 1024;

    private stackPattern = 0x00;
    private stackIncrements = -1; // negative numbers => OS_STK_GROWTH = OS_STK_GROWTH_HI_TO_LO (1)

    private helpHtml: string | undefined;

    constructor(public session: vscode.DebugSession) {
        super(session, 'uC/OS-III');

        if (session.configuration.rtosViewConfig) {
            if (session.configuration.rtosViewConfig.stackPattern) {
                this.stackPattern = parseInt(session.configuration.rtosViewConfig.stackPattern);
            }

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
                this.OSRunning = await this.getVarIfEmpty(this.OSRunning, useFrameId, 'OSRunning', false);
                this.OSTaskCtr = await this.getVarIfEmpty(this.OSTaskCtr, useFrameId, 'OSTaskQty', false);
                this.OSTCBList = await this.getVarIfEmpty(this.OSTCBList, useFrameId, 'OSTaskDbgListPtr', false);
                this.OSTCBCur = await this.getVarIfEmpty(this.OSTCBCur, useFrameId, 'OSTCBCurPtr', false);
                this.CPU_TS_TmrFreq_Hz = await this.getVarIfEmpty(this.CPU_TS_TmrFreq_Hz, useFrameId, 'CPU_TS_TmrFreq_Hz', true);
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

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    protected createHtmlHelp(th: RTOSCommon.RTOSThreadInfo, thInfo: RTOSCommon.RTOSStrToValueMap) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        function strong(text: string) {
            return `<strong>${text}</strong>`;
        }
        if (this.helpHtml === undefined) {
            this.helpHtml = '';
            try {
                let ret: string = '';
                // Once the user has enabled the OS_CFG_DBG_EN macro, all debug variables are valid.
                // For now, we don't need to give any hints.

                // To enable CPUUasge, please:
                //  1. enable macro 'OS_CFG_TASK_PROFILE_EN'
                //  2. enable macro 'CPU_CFG_TS_32_EN' or 'CPU_CFG_TS_64_EN'
                //  3. call OSStatTaskCPUUsageInit() in you main task before start.
                if (!this.CPU_TS_TmrFreq_Hz || !thInfo['CPUUsage']) {
                    ret += 'missing \'Runtime\', please check:<br>'
                        + ` 1. Enable macro ${strong('OS_CFG_TS_EN')} and ${strong('OS_CFG_TASK_PROFILE_EN')} in 'os_cfg.h'<br>`
                        + ` 2. Enable macro ${strong('CPU_CFG_TS_32_EN')} or ${strong('CPU_CFG_TS_64_EN')} in 'cpu_cfg.h'<br>`
                        + ` 3. Make sure ${strong('CPU_TS_TmrRd()')} have a valid implement in 'bsp_cpu.c'<br>`
                        + ` 4. Call ${strong('OSStatTaskCPUUsageInit()')} in you main task<br>`
                        + '<br><br>';
                }

                if (ret) {
                    ret +=
                        'Note: Make sure you consider the performance/resources impact for any changes to your firmware.<br>\n';
                    this.helpHtml =
                        '<button class="help-button">Hints to get more out of the uC/OS-III RTOS View</button>\n' +
                        `<div class="help"><p>\n${ret}\n</p></div>\n`;
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
            this.timeInfo = new Date().toISOString();

            // OSRunning & OSTaskCtr can go invalid anytime. Like when a reset/restart happens
            this.OSTaskCtrVal = Number.MAX_SAFE_INTEGER;
            this.OSRunningVal = Number.MAX_SAFE_INTEGER;
            this.foundThreads = [];

            this.OSRunning?.getValue(frameId).then(
                async (str) => {
                    try {
                        this.OSRunningVal = str ? parseInt(str) : 0;

                        if (0 !== this.OSRunningVal) {
                            const count = await this.OSTaskCtr?.getValue(frameId);
                            this.OSTaskCtrVal = count ? parseInt(count) : Number.MAX_SAFE_INTEGER;

                            if (this.OSTaskCtrVal > 0 && this.OSTaskCtrVal <= this.maxThreads) {
                                const OSTCBListVal = await this.OSTCBList?.getValue(frameId);
                                if (OSTCBListVal && 0 !== parseInt(OSTCBListVal)) {
                                    if (this.stackEntrySize === 0) {
                                        /* Only get stack entry size once per session */
                                        const stackEntrySizeRef = await this.getExprVal('sizeof(CPU_INT32U)', frameId);
                                        this.stackEntrySize = parseInt(stackEntrySizeRef || '');
                                    }

                                    const tmpOSTCBCurVal = await this.OSTCBCur?.getValue(frameId);
                                    this.OSTCBCurVal = tmpOSTCBCurVal
                                        ? parseInt(tmpOSTCBCurVal)
                                        : Number.MAX_SAFE_INTEGER;

                                    await this.getThreadInfo(this.OSTCBList, new Map(), frameId);

                                    this.foundThreads.sort(
                                        (a, b) =>
                                            parseInt(a.display['Address'].text) -
                                            parseInt(b.display['Address'].text)
                                    );
                                }
                                this.finalThreads = [...this.foundThreads];
                            } else {
                                this.finalThreads = [];
                            }
                        } else {
                            this.finalThreads = [];
                        }

                        this.stale = false;
                        this.timeInfo += ' in ' + timer.deltaMs() + ' ms';
                        resolve();
                    } catch (e) {
                        resolve();
                        console.error('RTOSUCOS3.refresh() failed: ', e);
                    }
                },
                (reason) => {
                    resolve();
                    console.error('RTOSUCOS3.refresh() failed: ', reason);
                }
            );
        });
    }

    private getThreadInfo(
        tcbListEntry: RTOSCommon.RTOSVarHelperMaybe,
        flagPendMap: Map<number, FlagGroup[]>,
        frameId: number
    ): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (!tcbListEntry || !tcbListEntry.varReference || this.foundThreads.length >= this.OSTaskCtrVal) {
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

                        if (!obj) {
                            resolve();
                            return;
                        }

                        let curTaskObj = obj;
                        let thAddress = parseInt(tcbListEntry?.value || '');
                        let threadCount = 1;

                        do {
                            let thName = '???';
                            if (curTaskObj['NamePtr']) {
                                const tmpThName = await this.getExprVal('(char *)' + curTaskObj['NamePtr']?.exp, frameId) || '';
                                const matchName = tmpThName.match(/"([^*]*)"$/);
                                thName = matchName ? matchName[1] : tmpThName;
                            }

                            const threadRunning = thAddress === this.OSTCBCurVal;
                            const thStateObject = await this.analyzeTaskState(
                                thAddress,
                                curTaskObj,
                                flagPendMap,
                                frameId
                            );
                            const thState = thStateObject.describe();

                            const stackInfo = await this.getStackInfo(curTaskObj, this.stackPattern, frameId);

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
                            mySetter(DisplayFields.Priority, parseInt(curTaskObj['Prio']?.val).toString());

                            if (stackInfo.stackUsed !== undefined && stackInfo.stackSize !== undefined) {
                                const stackPercentVal = Math.round((stackInfo.stackUsed / stackInfo.stackSize) * 100);
                                const stackPercentText = `${stackPercentVal} % (${stackInfo.stackUsed} / ${stackInfo.stackSize})`;
                                mySetter(DisplayFields.StackPercent, stackPercentText, stackPercentVal);
                            } else {
                                mySetter(DisplayFields.StackPercent, '?? %');
                            }

                            if (stackInfo.stackPeak !== undefined && stackInfo.stackSize !== undefined) {
                                const stackPeakPercentVal =
                                    Math.round((stackInfo.stackPeak / stackInfo.stackSize) * 100);
                                const stackPeakPercentText = `${stackPeakPercentVal.toString().padStart(3)} %` +
                                    ` (${stackInfo.stackPeak} / ${stackInfo.stackSize})`;
                                mySetter(DisplayFields.StackPeakPercent, stackPeakPercentText, stackPeakPercentVal);
                            } else if (RTOSCommon.RTOSBase.disableStackPeaks) {
                                mySetter(DisplayFields.StackPeakPercent, '----');
                            } else {
                                mySetter(DisplayFields.StackPeakPercent, '?? %');
                            }

                            // typedef CPU_INT16U OS_CPU_USAGE;     /* CPU Usage 0..10000  <16>/32 */
                            // OS_CPU_USAGE CPUUsage;               /* CPU Usage of task (0.00-100.00%) */
                            if (this.CPU_TS_TmrFreq_Hz && curTaskObj['CPUUsage']?.val) {
                                const tmp = parseInt(curTaskObj['CPUUsage']?.val) / 100;
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
                            this.createHtmlHelp(thread, curTaskObj);

                            thAddress = parseInt(curTaskObj['DbgNextPtr']?.val);
                            if (0 !== thAddress) {
                                const nextThreadObj = await this.getVarChildrenObj(
                                    curTaskObj['DbgNextPtr']?.ref,
                                    'DbgNextPtr'
                                );
                                curTaskObj = nextThreadObj || {};
                                threadCount++;
                            }

                            if (threadCount > this.OSTaskCtrVal) {
                                console.log(
                                    'RTOSUCOS3.getThreadInfo() detected more threads in OSTCBCur linked list that OSTaskCtr states'
                                );
                                break;
                            }
                        } while (0 !== thAddress);

                        resolve();
                    } catch (e) {
                        console.log('RTOSUCOS3.getThreadInfo() error', e);
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
        _frameId: number
    ): Promise<EventInfo> {

        const eventInfo: EventInfo = {
            address,
            eventType: OsEventType.Flag
        };

        // #define  OS_OBJ_TYPE_NONE   (OS_OBJ_TYPE)CPU_TYPE_CREATE('N', 'O', 'N', 'E')
        // #define  OS_OBJ_TYPE_FLAG   (OS_OBJ_TYPE)CPU_TYPE_CREATE('F', 'L', 'A', 'G')
        // #define  OS_OBJ_TYPE_MEM    (OS_OBJ_TYPE)CPU_TYPE_CREATE('M', 'E', 'M', ' ')
        // #define  OS_OBJ_TYPE_MUTEX  (OS_OBJ_TYPE)CPU_TYPE_CREATE('M', 'U', 'T', 'X')
        // #define  OS_OBJ_TYPE_COND   (OS_OBJ_TYPE)CPU_TYPE_CREATE('C', 'O', 'N', 'D')
        // #define  OS_OBJ_TYPE_Q      (OS_OBJ_TYPE)CPU_TYPE_CREATE('Q', 'U', 'E', 'U')
        // #define  OS_OBJ_TYPE_SEM    (OS_OBJ_TYPE)CPU_TYPE_CREATE('S', 'E', 'M', 'A')
        // #define  OS_OBJ_TYPE_TMR    (OS_OBJ_TYPE)CPU_TYPE_CREATE('T', 'M', 'R', ' ')
        const typeNum = parseInt(eventObject['Type']?.val);
        if (typeNum) {
            const char1 = typeNum & 0xFF;
            const char2 = (typeNum >> 8) & 0xFF;
            const char3 = (typeNum >> 16) & 0xFF;
            const char4 = (typeNum >> 24) & 0xFF;
            const etype = String.fromCharCode(char1, char2, char3, char4).trim();
            switch (etype) {
                case 'FLAG':
                    eventInfo.eventType = OsEventType.Flag;
                    break;
                case 'MUTX':
                    eventInfo.eventType = OsEventType.Mutex;
                    break;
                case 'COND':
                    eventInfo.eventType = OsEventType.Condition;
                    break;
                case 'QUEU':
                    eventInfo.eventType = OsEventType.Queue;
                    break;
                case 'SEMA':
                    eventInfo.eventType = OsEventType.Semaphore;
                    break;
                default:
                    eventInfo.eventType = OsEventType.None;
                    break;
            }
        }

        const nameVal = eventObject['NamePtr']?.val;
        if (nameVal && !/^(?:0x0|0)$/.test(nameVal.trim())) {
            const matchName = nameVal.match(/"(.*)"$/);
            eventInfo.name = matchName ? matchName[1] : nameVal;
        }

        return eventInfo;
    }

    protected async analyzeTaskState(
        threadAddr: number,
        curTaskObj: any,
        flagPendMap: Map<number, FlagGroup[]>,
        frameId: number
    ): Promise<TaskState> {
        const state = parseInt(curTaskObj['TaskState']?.val);
        // #define  OS_TASK_STATE_RDY                    (OS_STATE)(  0u)  /*   0 0 0     Ready                                  */
        // #define  OS_TASK_STATE_DLY                    (OS_STATE)(  1u)  /*   0 0 1     Delayed or Timeout                     */
        // #define  OS_TASK_STATE_PEND                   (OS_STATE)(  2u)  /*   0 1 0     Pend                                   */
        // #define  OS_TASK_STATE_PEND_TIMEOUT           (OS_STATE)(  3u)  /*   0 1 1     Pend + Timeout                         */
        // #define  OS_TASK_STATE_SUSPENDED              (OS_STATE)(  4u)  /*   1 0 0     Suspended                              */
        // #define  OS_TASK_STATE_DLY_SUSPENDED          (OS_STATE)(  5u)  /*   1 0 1     Suspended + Delayed or Timeout         */
        // #define  OS_TASK_STATE_PEND_SUSPENDED         (OS_STATE)(  6u)  /*   1 1 0     Suspended + Pend                       */
        // #define  OS_TASK_STATE_PEND_TIMEOUT_SUSPENDED (OS_STATE)(  7u)  /*   1 1 1     Suspended + Pend + Timeout             */
        switch (state) {
            case 0:
                return new TaskReady();
            case 1:
                return new TaskDelayed();
            case 4:
            case 5:
            case 6:
            case 7:
                return new TaskSuspended();
            default: {
                const resultState = new TaskPending();
                // #define  OS_TASK_PEND_ON_NOTHING              (OS_STATE)(  0u)  /* Pending on nothing                                 */
                // #define  OS_TASK_PEND_ON_FLAG                 (OS_STATE)(  1u)  /* Pending on event flag group                        */
                // #define  OS_TASK_PEND_ON_TASK_Q               (OS_STATE)(  2u)  /* Pending on message to be sent to task              */
                // #define  OS_TASK_PEND_ON_COND                 (OS_STATE)(  3u)  /* Pending on condition variable                      */
                // #define  OS_TASK_PEND_ON_MUTEX                (OS_STATE)(  4u)  /* Pending on mutual exclusion semaphore              */
                // #define  OS_TASK_PEND_ON_Q                    (OS_STATE)(  5u)  /* Pending on queue                                   */
                // #define  OS_TASK_PEND_ON_SEM                  (OS_STATE)(  6u)  /* Pending on semaphore                               */
                // #define  OS_TASK_PEND_ON_TASK_SEM             (OS_STATE)(  7u)  /* Pending on signal  to be sent to task              */
                if (curTaskObj['PendOn']?.val) {
                    const st = parseInt(curTaskObj['PendOn']?.val);
                    switch (st) {
                        case 1:
                            resultState.addEventType(getEventTypeForTaskState(OsTaskState.PEND_FLAGGROUP));
                            break;
                        case 3:
                            resultState.addEventType(getEventTypeForTaskState(OsTaskState.PEND_COND));
                            break;
                        case 4:
                            resultState.addEventType(getEventTypeForTaskState(OsTaskState.PEND_MUTEX));
                            break;
                        case 2:
                        case 5:
                            resultState.addEventType(getEventTypeForTaskState(OsTaskState.PEND_QUEUE));
                            break;
                        case 6:
                        case 7:
                            resultState.addEventType(getEventTypeForTaskState(OsTaskState.PEND_SEMAPHORE));
                            break;
                        default:
                            break;
                    }
                }
                if (curTaskObj['PendObjPtr']?.val) {
                    const eventAddress = parseInt(curTaskObj['PendObjPtr']?.val);
                    if (eventAddress !== 0) {
                        const event = await this.getVarChildrenObj(curTaskObj['PendObjPtr']?.ref, 'PendObjPtr');
                        if (event) {
                            const eventInfo = await this.getEventInfo(eventAddress, event, frameId);
                            resultState.addEvent(eventInfo);
                        }
                    }
                }
                if (flagPendMap.has(threadAddr)) {
                    flagPendMap.get(threadAddr)?.forEach((flagGroup) =>
                        resultState.addEvent({
                            name: flagGroup.name,
                            eventType: OsEventType.Flag,
                            address: flagGroup.address,
                        })
                    );
                }
                return resultState;
            }
        }
    }

    protected async getStackInfo(thInfo: RTOSCommon.RTOSStrToValueMap, stackPattern: number, _frameId: number) {
        const TopOfStack = thInfo['StkPtr']?.val;

        /* only available with (OS_CFG_DBG_EN > 0u) || (OS_CFG_STAT_TASK_STK_CHK_EN > 0u) || (OS_CFG_TASK_STK_REDZONE_EN > 0u) (optional) */
        const EndOfStack = parseInt(thInfo['StkBasePtr']?.val) || 0;
        const StackSize = parseInt(thInfo['StkSize']?.val) || 0;

        let Stack = 0;
        if (EndOfStack !== 0 && StackSize !== 0) {
            if (this.stackIncrements < 0) {
                Stack = EndOfStack + StackSize * this.stackEntrySize;
            }
            else {
                Stack = EndOfStack - StackSize * this.stackEntrySize;
            }
        }
        else {
            /* As stackStart is mandatory, we need to set it to some reasonable value */
            Stack = parseInt(TopOfStack);
        }

        const stackInfo: RTOSCommon.RTOSStackInfo = {
            stackStart: Stack
        };
        stackInfo.stackTop = parseInt(TopOfStack);

        if (EndOfStack !== 0 && StackSize !== 0) {
            stackInfo.stackEnd = EndOfStack;
            stackInfo.stackSize = StackSize * this.stackEntrySize;

            if (this.stackIncrements < 0) {
                const stackDelta = stackInfo.stackStart - stackInfo.stackTop;
                stackInfo.stackFree = stackInfo.stackSize - stackDelta;
                stackInfo.stackUsed = stackDelta;
            } else {
                const stackDelta = stackInfo.stackTop - stackInfo.stackStart;
                stackInfo.stackFree = stackDelta;
                stackInfo.stackUsed = stackInfo.stackSize - stackDelta;
            }

            if (!RTOSCommon.RTOSBase.disableStackPeaks) {
                /* check stack peak */
                const memArg: DebugProtocol.ReadMemoryArguments = {
                    memoryReference: RTOSCommon.hexFormat(Math.min(stackInfo.stackTop, stackInfo.stackEnd)),
                    count: stackInfo.stackFree
                };
                try {
                    const stackData = await this.session.customRequest('readMemory', memArg);
                    const buf = Buffer.from(stackData.data, 'base64');
                    stackInfo.bytes = new Uint8Array(buf);
                    let start = this.stackIncrements < 0 ? 0 : stackInfo.bytes.length - 1;
                    const end = this.stackIncrements < 0 ? stackInfo.bytes.length : -1;
                    let peak = 0;
                    while (start !== end) {
                        if (stackInfo.bytes[start] !== stackPattern) {
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
    public getHTML(): RTOSCommon.HtmlInfo {
        const htmlContent: RTOSCommon.HtmlInfo = { html: '', css: '' };
        // WARNING: This stuff is super fragile. Once we know how this works, then we should refactor this
        let msg = '';
        if (this.status === 'none') {
            htmlContent.html = '<p>RTOS not yet fully initialized. Will occur next time program pauses</p>\n';
            return htmlContent;
        } else if (this.stale) {
            const lastHtmlInfo = this.lastValidHtmlContent;
            if (this.OSTaskCtrVal === Number.MAX_SAFE_INTEGER) {
                msg = ' Could not read "OSTaskCtr". Perhaps program is busy or did not stop long enough';
                lastHtmlInfo.html = '';
                lastHtmlInfo.css = '';
            } else if (this.OSTaskCtrVal > this.maxThreads) {
                msg = ` uC/OS-III variable OSTaskCtr = ${this.OSTaskCtrVal} seems invalid`;
                lastHtmlInfo.html = '';
                lastHtmlInfo.css = '';
            } else if (lastHtmlInfo.html !== '') {
                msg = ' Following info from last query may be stale.';
            }

            htmlContent.html = `<p>Unable to collect full RTOS information.${msg}</p>\n` + lastHtmlInfo.html;
            htmlContent.css = lastHtmlInfo.css;
            return htmlContent;
        } else if (this.OSTaskCtrVal !== Number.MAX_SAFE_INTEGER && this.finalThreads.length !== this.OSTaskCtrVal) {
            msg += `<p>Expecting ${this.OSTaskCtrVal} threads, found ${this.finalThreads.length}. Thread data may be unreliable<p>\n`;
        } else if (this.finalThreads.length === 0) {
            htmlContent.html = `<p>No ${this.name} threads detected, perhaps RTOS not yet initialized or tasks yet to be created!</p>\n`;
            return htmlContent;
        }

        const ret = this.getHTMLThreads(DisplayFieldNames, RTOSUCOS3Items, this.finalThreads, this.timeInfo);
        htmlContent.html = msg + ret.html + (this.helpHtml || '');
        htmlContent.css = ret.css;

        this.lastValidHtmlContent = htmlContent;
        // console.log(this.lastValidHtmlContent.html);
        return this.lastValidHtmlContent;
    }
}

enum OsTaskState {
    READY = 0x00,
    SUSPENDED = 0x08,
    PEND_SEMAPHORE = 0x01,
    PEND_MAILBOX = 0x02,
    PEND_QUEUE = 0x04,
    PEND_MUTEX = 0x10,
    PEND_FLAGGROUP = 0x20,
    PEND_COND = 0x40
}

enum OsEventType {
    None = 0,
    Mailbox = 1,
    Queue = 2,
    Semaphore = 3,
    Mutex = 4,
    Flag = 5,
    Condition = 6
}

function getEventTypeForTaskState(state: OsTaskState): OsEventType {
    switch (state) {
        case OsTaskState.PEND_SEMAPHORE:
            return OsEventType.Semaphore;
        case OsTaskState.PEND_MAILBOX:
            return OsEventType.Mailbox;
        case OsTaskState.PEND_QUEUE:
            return OsEventType.Queue;
        case OsTaskState.PEND_MUTEX:
            return OsEventType.Mutex;
        case OsTaskState.PEND_FLAGGROUP:
            return OsEventType.Flag;
        case OsTaskState.PEND_COND:
            return OsEventType.Condition;
        default:
            return OsEventType.None; // Should not happen, but we need something for lint
    }
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
    public describe(): string {
        return 'SUSPENDED';
    }

    public fullData(): any {
        return null;
    }
}

class TaskDelayed extends TaskState {
    public describe(): string {
        return 'DELAYED';
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
    address: number;
    eventType: OsEventType;
}

function describeEvent(event: EventInfo): string {
    if (event.name && event.name !== '?') {
        return event.name;
    } else {
        return `0x${event.address.toString(16)}`;
    }
}

interface FlagGroup {
    name?: string;
    address: number;
}
