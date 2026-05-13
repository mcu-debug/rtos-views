/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from 'vscode';
import * as RTOSCommon from './rtos-common';

enum DisplayFields {
    ID,
    Address,
    Name,
    Status,
    Priority,
    StackPercent,
    //StackSize, // displayed in StackPercent
    StackBase,
    StackLimit,
    StackPtr,
    StackTop
    // CONSIDER: Cyg_Thread: sleep_reason and wake_reason
    // CONSIDER: Cyg_Thread: timer
    // CONSIDER: Cyg_Thread: suspend_count, wakeup_count and wait_info
    // CONSIDER: Cyg_SchedThread: queue and mutex_count
    // CONSIDER: Cyg_SchedThread: original and inherited priorities
    // CONSIDER: Cyg_SchedThread_Implementation: timeslice_count
}

const numType = RTOSCommon.ColTypeEnum.colTypeNumeric;

const eCosItems: { [key: string]: RTOSCommon.DisplayColumnItem } = {};

/* eCos thread IDs are indexed from 1, so 0 can be used as an invalid thread ID marker */
eCosItems[DisplayFields[DisplayFields.ID]] = {
    width: 1,
    headerRow1: 'Thread',
    headerRow2: 'ID',
    colType: numType
};

eCosItems[DisplayFields[DisplayFields.Address]] = {
    width: 3,
    headerRow1: '',
    headerRow2: 'Address',
    colGapBefore: 1
};

eCosItems[DisplayFields[DisplayFields.Name]] = {
    width: 4,
    headerRow1: '',
    headerRow2: 'Name'
};

eCosItems[DisplayFields[DisplayFields.Status]] = {
    width: 3,
    headerRow1: '',
    headerRow2: 'Status',
    //colType: RTOSCommon.ColTypeEnum.colTypeCollapse
};

eCosItems[DisplayFields[DisplayFields.Priority]] = {
    width: 1.5,
    headerRow1: '',
    headerRow2: 'Priority',
    colType: numType
};

eCosItems[DisplayFields[DisplayFields.StackPercent]] = {
    width: 4,
    headerRow1: 'Stack Usage',
    headerRow2: '% (Used B / Size B)',
    colType: RTOSCommon.ColTypeEnum.colTypePercentage,
};

eCosItems[DisplayFields[DisplayFields.StackBase]] = {
    width: 2,
    headerRow1: 'Stack',
    headerRow2: 'Base',
    colType: numType
};

eCosItems[DisplayFields[DisplayFields.StackLimit]] = {
    width: 2,
    headerRow1: 'Stack',
    headerRow2: 'Limit',
    colType: numType
};

eCosItems[DisplayFields[DisplayFields.StackPtr]] = {
    width: 2,
    headerRow1: 'Stack',
    headerRow2: 'Pointer',
    colType: numType
};

eCosItems[DisplayFields[DisplayFields.StackTop]] = {
    width: 2,
    headerRow1: 'Stack',
    headerRow2: 'Top',
    colType: numType
};

const DisplayFieldNames: string[] = Object.keys(eCosItems);

// eCos thread status is a logical-OR bitmask of states:
enum ThreadStatus {
    RUNNING = 0,
    SLEEPING = (1 << 0),
    COUNTSLEEP = (1 << 1),
    SUSPENDED = (1 << 2),
    CREATING = (1 << 3),
    EXITED = (1 << 4),
    SLEEPSET = (SLEEPING | COUNTSLEEP),
}

export class RTOSeCos extends RTOSCommon.RTOSBase {
    private pxThreadList: RTOSCommon.RTOSVarHelperMaybe;
    private xCurrentThread: RTOSCommon.RTOSVarHelperMaybe;

    private stackIncrements = -1; // negative numbers => stack expands from higher address to lower addresses

    private stale = true;
    private timeInfo = '';
    private helpHtml: string | undefined;

    private foundThreads: RTOSCommon.RTOSThreadInfo[] = [];
    private finalThreads: RTOSCommon.RTOSThreadInfo[] = [];

    // NOTE: under eCos the idle thread appears as a normal
    // schedulable thread and so we do not need special handling; other
    // than if we want to highlight it (e.g. special case handling of
    // "cyg_idle_thread_loops[cpunum]" reporting)
    constructor(public session: vscode.DebugSession) {
        super(session, 'eCos');
        if (session.configuration.rtosViewConfig) {
            if (session.configuration.rtosViewConfig.stackGrowth) {
                this.stackIncrements = parseInt(session.configuration.rtosViewConfig.stackGrowth);
                console.log('eCos: stackIncrements:', this.stackIncrements);
            }
        }
    }

    public async tryDetect(useFrameId: number): Promise<RTOSCommon.RTOSBase> {
        this.progStatus = 'stopped';
        try {
            if (this.status === 'none') {    //colType: numType
                // Use "Cyg_Thread::thread_list" as basic eCos detection mechanism:
                this.pxThreadList = await this.getVarIfEmpty(this.pxThreadList, useFrameId, 'Cyg_Thread::thread_list');
                // Vector holding per-CPU currently active thread pointer: "Cyg_Scheduler_Base::current_thread[CYGNUM_KERNEL_CPU_COUNT]"
                this.xCurrentThread = await this.getVarIfEmpty(this.xCurrentThread, useFrameId, 'Cyg_Scheduler_Base::current_thread[0]');
                // ASCERTAIN: Best method to get information about the depth of the above vector (#CPUs in SMP configuration).
                // Possibly use non-C symbol as per the thread stacked context shape symbols.
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
                if (!thInfo['name']?.val) {
                    ret += 'Thread name missing: Enable ${strong("CYGVAR_KERNEL_THREADS_NAME")} if desired.<br>';
                }
                // CONSIDER: Checking for further kernel features that may be useful for run-time diagnostics:
                // e.g. CYGFUN_KERNEL_THREADS_STACK_LIMIT, CYGFUN_KERNEL_THREADS_STACK_MEASUREMENT, etc.
                if (ret) {
                    ret += 'Note: Make sure to consider the performance/resources impact of any eCos configuration changes.<br>';
                    this.helpHtml = '<button class="help-button">Hints to get more from the eCos RTOS View</button>\n' +
                        '<div class="help"><p>\n${ret}\n</p></div>\n';
                }
            } catch (e) {
                console.log(e);
            }
        }
    }

    private getThreadState(threadStatus: number, threadCurrent: boolean) {
        let stateText = '';

		if (threadStatus & ThreadStatus.SUSPENDED) {
            stateText = 'suspended+';
        }

		switch (threadStatus & ~ThreadStatus.SUSPENDED) {
		case ThreadStatus.RUNNING:
            if (threadCurrent) {
                stateText = 'running';
            } else if (threadStatus & ThreadStatus.SUSPENDED) {
                stateText = 'suspended';
            } else {
                stateText = 'ready';
            }
			break;
		case ThreadStatus.SLEEPING:
			stateText = 'sleeping';
			break;
		case ThreadStatus.SLEEPSET:
		case ThreadStatus.COUNTSLEEP:
            stateText = 'counted-sleep';
			break;
		case ThreadStatus.CREATING:
			stateText = 'creating';
			break;
		case ThreadStatus.EXITED:
            statedesc = 'exited';
			break;
		default:
            stateText = 'unknown';
			break;
		}

        return stateText;
    }

    protected async getStackInfo(thInfo: RTOSCommon.RTOSStrToValueMap | null, thHardware) {
        const stackInfo: RTOSCommon.RTOSStackInfo = {
            stackStart: 0,
        };
        stackInfo.stackTop = 0;

        if (thInfo === null) {
            return stackInfo;
        }

        const stackBase = thHardware['stack_base'].val;
        const stackLimit = thHardware['stack_limit'].val;
        const stackSize = thHardware['stack_size'].val;
        const stackPtr = thHardware['stack_ptr'].val;

        // If CYGFUN_KERNEL_THREADS_STACK_MEASUREMENT (with
        // CYGNUM_KERNEL_THREADS_STACK_DATA_INIT as the init value) we could
        // calculate the stackInfo.stackPeak value by checking the target
        // memory. See rtos-embos.ts for an example implementation.

        if (stackSize && stackBase && stackLimit && stackPtr) {
            const base = parseInt(stackBase);
            const limit = parseInt(stackLimit);
            const size = parseInt(stackSize);
            const ptr = parseInt(stackPtr);
            stackInfo.stackTop = Math.abs(base + size);
            stackInfo.stackSize = size;
            if (this.stackIncrements < 0) {
                // Descending:
                stackInfo.stackStart = limit;
                stackInfo.stackEnd = stackInfo.stackTop;
                stackInfo.stackFree = Math.abs(ptr - limit);
                stackInfo.stackUsed = Math.abs(stackInfo.stackEnd - ptr);
            } else {
                // Ascending:
                stackInfo.stackStart = stackInfo.stackTop;
                stackInfo.stackEnd = limit;
                stackInfo.stackFree = Math.abs(stackInfo.stackEnd- ptr);
                stackInfo.stackUsed = Math.abs(ptr - stackInfo.stackStart);
            }
        } else {
            // Force value since stackStart needs to be set:
            stackInfo.stackStart = stackInfo.stackTop;
        }

        return stackInfo;
    }

    private getThreadInfo(thListHead: RTOSCommon.RTOSVarHelperMaybe, frameId: number): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (!thListHead || !thListHead.varReference) {
                resolve();
                return;
            }

            if (this.progStatus !== 'stopped') {
                reject(new Error('Busy'));
                return;
            }

            // thListHead is head object of circular linked list:
            let thFirstAddress = parseInt(thListHead?.value || '');
            let thActiveAddress = undefined;

            // Only CPU[0] currently:
            this.xCurrentThread?.getValue(frameId).then(
                async(dummy: RTOSCommon.RTOSStrToValueMap) => {
                    try {
                        const thActive = await this.xCurrentThread;
                        thActiveAddress = parseInt(thActive?.value || '');
                    } catch (e) {
                        console.log('RTOSeCos.getThreadInfo() xCurrentThread error', e);
                    }
                },
                (e) => {
                    reject(e);
                }
            );

            this.pxThreadList?.getVarChildrenObj(frameId).then(
                async (thHead: RTOSCommon.RTOSStrToValueMap) => {
                    try {
                        let thCurrent = thHead;
                        let thAddress = thFirstAddress;

                        do {
                            if (Object.hasOwn(thCurrent, 'list_next')) {
                                const thHardware = await this.getVarChildrenObj(thCurrent['Cyg_HardwareThread']?.ref, '');
                                const thSched = await this.getVarChildrenObj(thCurrent['Cyg_SchedThread']?.ref, '');
                                const thSchedImpl = await this.getVarChildrenObj(thSched['Cyg_SchedThread_Implementation']?.ref, '');

                                let thName = '[EMPTY]';
                                if (thCurrent['name']) {
                                    const matchName = thCurrent['name'].val.match(/"([^*]*)"$/);
                                    thName = matchName ? matchName[1] : thName;
                                }

                                let threadRunning = (thAddress === thActiveAddress);
                                const stackInfo = await this.getStackInfo(thCurrent, thHardware);

                                const display: { [key: string]: RTOSCommon.DisplayRowItem } = {};
                                const mySetter = (x: DisplayFields, text: string, value?: any) => {
                                    display[DisplayFieldNames[x]] = { text, value };
                                };

                                mySetter(DisplayFields.ID, thCurrent['unique_id'].val);
                                mySetter(DisplayFields.Address, RTOSCommon.hexFormat(thAddress));
                                mySetter(DisplayFields.Priority, Math.abs(thSchedImpl['priority'].val)); // decimal
                                mySetter(DisplayFields.Status, this.getThreadState(thCurrent['state'].val, threadRunning));
                                mySetter(DisplayFields.Name, thName);
                                if ((stackInfo.stackUsed !== undefined) && (stackInfo.stackSize !== undefined)) {
                                    const stackPercentVal = Math.round((stackInfo.stackUsed / stackInfo.stackSize) * 100);
                                    const stackPercentText = `${stackPercentVal} % (${stackInfo.stackUsed} / ${stackInfo.stackSize})`;
                                    mySetter(DisplayFields.StackPercent, stackPercentText, stackPercentVal);
                                } else {
                                    mySetter(DisplayFields.StackPercent, '[unknown]');
                                }
                                mySetter(DisplayFields.StackBase, thHardware['stack_base'].val); // could use value de-referenced in getStackInfo()
                                mySetter(DisplayFields.StackLimit, RTOSCommon.hexFormat(stackInfo.stackStart));
                                mySetter(DisplayFields.StackPtr, thHardware['stack_ptr'].val);
                                mySetter(DisplayFields.StackTop, RTOSCommon.hexFormat(stackInfo.stackTop));

                                const thread: RTOSCommon.RTOSThreadInfo = {
                                    display: display,
                                    stackInfo: stackInfo,
                                    running: threadRunning,
                                };
                                this.foundThreads.push(thread);
                                this.createHmlHelp(thread, thCurrent);

                                thAddress = parseInt(thCurrent.list_next?.val);
                                if (0 !== thAddress) {
                                    const thNextThread = await this.getVarChildrenObj(thCurrent.list_next?.ref, 'list_next');
                                    thCurrent = thNextThread || {};
                                }
                            } else {
                                console.log('invalid eCos thread reference : no list_next');
                            }
                        } while ((thAddress !== 0) && (thFirstAddress !== thAddress));

                        resolve();
                    } catch (e) {
                        console.log('RTOSeCos.getThreadInfo() error', e);
                    }
                },
                (e) => {
                    reject(e);
                }
            );
        });
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
            this.foundThreads = [];

            this.pxThreadList?.getValue(frameId).then(
                async (varObj: RTOSCommon.RTOSStrToValueMap) => {
                    try {
                        await this.getThreadInfo(this.pxThreadList, frameId);
                        this.foundThreads.sort((a, b) => parseInt(a.display['ID'].text) - parseInt(b.display['ID'].text));

                        this.finalThreads = [...this.foundThreads];
                        this.stale = false;
                        this.timeInfo += ' in ' + timer.deltaMs() + 'ms';
                        resolve();
                    } catch (e) {
                        resolve();
                        console.error('RTOSeCos.refresh() failed: ', e);
                    }
                },
                (reason) => {
                    resolve();
                    console.error('RTOSeCos.refresh() failed reason: ', reason);
                }
            );
        });
    }

    public lastValidHtmlContent: RTOSCommon.HtmlInfo = { html: '', css: '' };

    public getHTML(): RTOSCommon.HtmlInfo {
        const htmlContent: RTOSCommon.HtmlInfo = { html: '', css: '' };
        let msg = '';
        if (this.status === 'none') {
            htmlContent.html = '<p>eCos not yet fully initialized. Will update the next time program pauses.</p>\n';
            return htmlContent;
        } else if (this.stale) {
            const lastHtmlInfo = this.lastValidHtmlContent;
            msg = ' Following info from last query may be stale.';
            htmlContent.html = `<p>Unable to collect full eCos information.${msg}</p>\n` + lastHtmlInfo.html;
            htmlContent.css = lastHtmlInfo.css;
            return htmlContent;
        } else if (this.finalThreads.length === 0) {
            htmlContent.html = `<p>No ${this.name} threads detected, perhaps eCos is not yet initialized or threads are yet to be created!</p>\n`;
            return htmlContent;
        }

        const ret = this.getHTMLThreads(DisplayFieldNames, eCosItems, this.finalThreads, this.timeInfo);
        // CONSIDER: Display other useful *global* eCos information (mutexes, memory pools, etc.) // see rtos-threadx.ts for example
        htmlContent.html = msg + ret.html + (this.helpHtml || '');
        htmlContent.css = ret.css;

        this.lastValidHtmlContent = htmlContent;
        return this.lastValidHtmlContent;
    }
}
