/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from 'vscode';
import * as RTOSCommon from './rtos-common';

// We will have two rows of headers for ChibiOS and the table below describes
// the columns headers for the two rows and the width of each column as a fraction
// of the overall space.
enum DisplayFields {
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
const ChibiOSItems: { [key: string]: RTOSCommon.DisplayColumnItem } = {};

ChibiOSItems[DisplayFields[DisplayFields.ID]] = { width: 2, headerRow1: '', headerRow2: 'id', colType: colNumType };
ChibiOSItems[DisplayFields[DisplayFields.THREAD_DESCRIPTION]] = { width: 14, headerRow1: '', headerRow2: 'Thread', colGapBefore: 1 };
ChibiOSItems[DisplayFields[DisplayFields.FLAGS]] = { width: 2, headerRow1: '', headerRow2: 'Flags', colGapAfter: 1 };
ChibiOSItems[DisplayFields[DisplayFields.REFS]] = { width: 2, headerRow1: '', headerRow2: 'Refs', colType: colNumType };
ChibiOSItems[DisplayFields[DisplayFields.TIME]] = { width: 2, headerRow1: '', headerRow2: 'Time', colType: colNumType };
ChibiOSItems[DisplayFields[DisplayFields.WTOBJP]] = { width: 4, headerRow1: 'Wait', headerRow2: 'Obj/Msg', colGapBefore: 1 };
ChibiOSItems[DisplayFields[DisplayFields.STATS_N]] = { width: 4, headerRow1: 'Stats', headerRow2: 'Switches', colType: colNumType };
ChibiOSItems[DisplayFields[DisplayFields.STATS_WORST]] = { width: 4, headerRow1: '', headerRow2: 'Worst Path', colType: colNumType };
ChibiOSItems[DisplayFields[DisplayFields.STATS_CUMULATIVE]] = { width: 4, headerRow1: '', headerRow2: 'Cumulative Time', colType: colNumType };
ChibiOSItems[DisplayFields[DisplayFields.STACK_CURRENT_USAGE]] = { width: 3, headerRow1: 'Stack', headerRow2: '', colType: colNumType };
ChibiOSItems[DisplayFields[DisplayFields.STACK_PEAK_USAGE]] = { width: 3, headerRow1: '', headerRow2: '', colType: colNumType };

const DisplayFieldNames: string[] = Object.keys(ChibiOSItems);

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
    return (s ? parseInt(s) : 0);
}

function getNumberNVL(s: string | null | undefined, nullValue: number): number {
    return (s ? parseInt(s) : nullValue);
}

function nvl(v: any, nullValue: any) {
    if ((v === undefined) || (v === null)) {
        return nullValue;
    }

    return v;
}

function getStackDisplayPercentage(s?: number, v?: number) {

    let text = '-';
    let percent = 0;

    if ((s !== undefined) && (v !== undefined)) {
        if (v === -1) {
            text = 'overflow';
            percent = 100;
        } else {
            percent = Math.round((v / s) * 100);
            text = `${percent.toString()}% (${v} / ${s})`;
        }
    }

    return {text: text, percent: percent};
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

    private rlistCurrent: number = 0;
    private threadOffset: number = 0;
    private threadSize: number = 0;
    private smp: boolean = false;
    private hasWAEND: boolean = false;

    private stale: boolean = true;
    private foundThreads: RTOSCommon.RTOSThreadInfo[] = [];
    private finalThreads: RTOSCommon.RTOSThreadInfo[] = [];
    private timeInfo: string = '';
    private helpHtml: string | undefined;

    // Need to do a TON of testing for stack growing the other direction
    private stackIncrements = -1;

    private readonly maxThreads = 1024;

    constructor(public session: vscode.DebugSession) {
        super(session, 'ChibiOS');
    }

    private async scanStackUnused(stackTop: number, stackEnd: number, s: number) {
        const stackData = await this.session.customRequest(
            'readMemory',
            {
                memoryReference: RTOSCommon.hexFormat(Math.min(stackTop, stackEnd)),
                count: s
            }
        );

        const bytes = new Uint8Array(Buffer.from(stackData.data, 'base64'));

        let unused = 0;
        while ((unused < bytes.length) && (bytes[unused] === 0x55)) {
            unused++;
        }

        return unused;
    }

    private async getStackPointer(threadInfo: RTOSCommon.RTOSStrToValueMap) {

        let sp = 0;
        const currentThreadCtx = await this.getVarChildrenObj(threadInfo['ctx']?.ref, 'ctx');
        const currentThreadCtxRegs = currentThreadCtx ? await this.getVarChildrenObj(currentThreadCtx['sp']?.ref, 'sp') : null;

        if (currentThreadCtxRegs && currentThreadCtx) {
            sp = getNumberNVL(currentThreadCtxRegs.hasOwnProperty('r13-val') ? currentThreadCtxRegs['r13']?.val : currentThreadCtx['sp']?.val, 0);
        }

        return sp;
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
                    this.chReglist = await this.getVarIfEmpty(this.chReglist, useFrameId, '(uint32_t) &ch_system.reglist', false);
                    this.smp = true;
                }
                catch (e) {
                    if (e instanceof RTOSCommon.ShouldRetry) {
                        throw e;
                    }
                    this.chReglist = await this.getVarIfEmpty(this.chReglist, useFrameId, '(uint32_t) &ch0.reglist', false);
                }

                let chRlistCurrentWAEND;
                this.chRlistCurrent = await this.getVarIfEmpty(this.chRlistCurrent, useFrameId, 'ch0.rlist.current', false);
                chRlistCurrentWAEND = await this.getVarIfEmpty(chRlistCurrentWAEND, useFrameId, 'ch0.rlist.current.waend', true);
                this.threadOffset = parseInt(await this.getExprVal('((char *)(&((thread_t *)0)->rqueue) - (char *)0)', useFrameId) || '');
                this.threadSize = parseInt(await this.getExprVal('sizeof(thread_t)', useFrameId) || '');
                this.status = 'initialized';

                if (!chRlistCurrentWAEND) {
                    // old version without waend
                    ChibiOSItems[DisplayFields[DisplayFields.STACK_CURRENT_USAGE]] = { width: 3, headerRow1: 'Stack', headerRow2: 'Current free', colType: colNumType };
                    ChibiOSItems[DisplayFields[DisplayFields.STACK_PEAK_USAGE]] = { width: 3, headerRow1: '', headerRow2: 'Min. free', colType: colNumType };
                } else {
                    // new version with waend
                    ChibiOSItems[DisplayFields[DisplayFields.STACK_CURRENT_USAGE]] = { width: 4, headerRow1: 'Stack', headerRow2: 'Current %<br><small>(Used B / Size B)</small>', colType: RTOSCommon.ColTypeEnum.colTypePercentage };
                    ChibiOSItems[DisplayFields[DisplayFields.STACK_PEAK_USAGE]] = { width: 4, headerRow1: '', headerRow2: 'Peak %<br><small>(Peak B / Size B)</small>', colType: RTOSCommon.ColTypeEnum.colTypePercentage };
                    this.hasWAEND = true;
                }
            }
            return this;
        }
        catch (e) {
            if (e instanceof RTOSCommon.ShouldRetry) {
                console.error(e.message);
            } else {
                this.status = 'failed';
                this.failedWhy = e;
            }
            return this;
        }
    }

    protected createHmlHelp(
        th: RTOSCommon.RTOSThreadInfo,
        thread: RTOSCommon.RTOSStrToValueMap,
        threadStats: RTOSCommon.RTOSStrToValueMap,
        threadStack: RTOSCommon.RTOSStackInfo
        ) {
        if (this.helpHtml === undefined) {
            this.helpHtml = '';
            try {
                let ret: string = '';
                function strong(text: string) {
                    return `<strong>${text}</strong>`;
                }

                if (!getNumberNVL(thread['wabase']?.val, 0)) {
                    ret += `Thread stack debug information is not enabled: to enable set ${strong('CH_DBG_ENABLE_STACK_CHECK')} and ${strong('CH_DBG_FILL_THREADS')} to ${strong('TRUE')} in chconf.h<br><br>`;
                }

                if ((!threadStats['n']?.val) || (!threadStats['worst']?.val) || (!threadStats['cumulative']?.val)) {
                    ret += `Kernel statistics are not enabled: to enable set ${strong('CH_DBG_STATISTICS')} to ${strong('TRUE')} in chconf.h<br><br>`;
                }

                if (ret) {
                    ret += 'Note: Make sure you consider the performance/resources impact for any changes to your FW.<br>\n';
                    this.helpHtml = '<button class="help-button">Hints to get more out of the ChibiOS RTOS View</button>\n' +
                        `<div class="help"><p>\n${ret}\n</p></div>\n`;
                }
            }
            catch (e) {
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
            this.timeInfo = (new Date()).toISOString();
            this.foundThreads = [];
            this.finalThreads = [];

            this.chRlistCurrent?.getValue(frameId).then(async (rlistCurrentStr) => {
                try {
                    this.rlistCurrent = getNumberNVL(rlistCurrentStr, 0);

                    if (0 !== this.rlistCurrent) {
                        // TODO: add global info: panic message, irs cnt...

                        await this.getThreadInfo(this.chReglist, frameId);
                        this.finalThreads = [...this.foundThreads];
                    } else {
                        this.finalThreads = [];
                    }

                    this.stale = false;
                    this.timeInfo += ' in ' + timer.deltaMs() + ' ms';
                    resolve();
                }
                catch (e) {
                    resolve();
                    console.error('ChibiOS.refresh() failed: ', e);
                }
            }, (reason) => {
                resolve();
                console.error('ChibiOS.refresh() failed: ', reason);
            });
        });
    }

    private getThreadInfo(reglist: RTOSCommon.RTOSVarHelperMaybe, frameId: number): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (!reglist) {
                resolve();
                return;
            }

            if (this.progStatus !== 'stopped') {
                reject(new Error('Busy'));
                return;
            }

            reglist.getValue(frameId).then(async (obj) => {
                try {
                    const reglistHeader = getNumberNVL(obj, 0);

                    if (reglistHeader && 0 !== reglistHeader) {
                        let nextEntry = await this.getExprValChildrenObj('(ch_queue_t *)' + reglistHeader, frameId);
                        let currentReglist = getNumber(nextEntry['next'].val);
                        let i = 0;

                        // TODO: add reglist integrity check

                        do {
                            const currentThreadAddr = currentReglist - this.threadOffset;
                            const currentThread = await this.getExprValChildrenObj('(thread_t *) ' + currentThreadAddr, frameId);
                            const currentThreadPqueue = await this.getExprValChildrenObj('((thread_t *) ' + currentThreadAddr + ')->hdr.pqueue', frameId);
                            const currentThreadStateDetails = await this.getVarChildrenObj(currentThread['u']?.ref, 'u') || {};
                            const currentThreadStats = await this.getVarChildrenObj(currentThread['stats']?.ref, 'stats') || {};

                            const threadRunning = (currentThreadAddr === this.rlistCurrent);
                            const threadName = getCString(currentThread['name'].val, '[NO NAME]');
                            const threadState = getThreadStateName(getNumberNVL(currentThread['state']?.val, chThreadState._SIZE));
                            const threadFlags = getNumberNVL(currentThread['flags']?.val, 0);
                            const threadPrio = getNumberNVL(currentThreadPqueue['prio']?.val, 0);
                            const threadRefs = getNumberNVL(currentThread['refs']?.val, 0);
                            const threadTime = nvl(currentThread['time']?.val, '-');
                            const threadWaitForObj = currentThreadStateDetails['wtobjp']?.val;
                            const threadStatsN = nvl(currentThreadStats['n']?.val, '-');
                            const threadStatsWorst = nvl(currentThreadStats['worst']?.val, '-');
                            const threadStatsCumulative = nvl(currentThreadStats['cumulative']?.val, '-');

                            const stackInfo = await this.getStackInfo(currentThread);

                            i++;

                            const display: { [key: string]: RTOSCommon.DisplayRowItem } = {};
                            const mySetter = (x: DisplayFields, text: string, value?: any) => {
                                display[DisplayFieldNames[x]] = { text, value };
                            };

                            mySetter(DisplayFields.ID, i.toString());
                            mySetter(DisplayFields.THREAD_DESCRIPTION,
                                threadName + '@' + RTOSCommon.hexFormat(currentThreadAddr) + ' ' + threadState + ' [P:' + threadPrio + ']');
                            mySetter(DisplayFields.FLAGS, RTOSCommon.hexFormat(threadFlags, 2));
                            mySetter(DisplayFields.REFS, threadRefs.toString());
                            mySetter(DisplayFields.TIME, threadTime);
                            mySetter(DisplayFields.WTOBJP, RTOSCommon.hexFormat(parseInt(threadWaitForObj)));
                            mySetter(DisplayFields.STATS_N, threadStatsN);
                            mySetter(DisplayFields.STATS_WORST, threadStatsWorst);
                            mySetter(DisplayFields.STATS_CUMULATIVE, threadStatsCumulative);

                            if (this.hasWAEND) {
                                const currentStackUsage = getStackDisplayPercentage(stackInfo.stackSize, stackInfo.stackUsed);
                                const peakStackUsage = getStackDisplayPercentage(stackInfo.stackSize, stackInfo.stackPeak);
                                mySetter(DisplayFields.STACK_CURRENT_USAGE, currentStackUsage.text, currentStackUsage.percent);
                                mySetter(DisplayFields.STACK_PEAK_USAGE, peakStackUsage.text, peakStackUsage.percent);
                            } else {
                                mySetter(DisplayFields.STACK_CURRENT_USAGE, getStackDisplayValue(stackInfo.stackFree));
                                mySetter(DisplayFields.STACK_PEAK_USAGE, getStackDisplayValue(stackInfo.stackPeak));
                            }

                            const threadInfo: RTOSCommon.RTOSThreadInfo = {
                                display: display, stackInfo: stackInfo, running: threadRunning
                            };

                            this.foundThreads.push(threadInfo);
                            this.createHmlHelp(threadInfo, currentThread, currentThreadStats, stackInfo);

                            nextEntry = await this.getExprValChildrenObj('(ch_queue_t *)' + currentReglist, frameId);
                            currentReglist = getNumberNVL(nextEntry['next']?.val, 0);

                        } while (reglistHeader !== currentReglist);

                    } else {
                        // TODO: add error message - reglist header not found
                    }

                    resolve();
                }
                catch (e) {
                    console.log('ChibiOS.getThreadInfo() error', e);
                }
            }, (e) => {
                reject(e);
            });
        });
    }

    protected async getStackInfo(threadInfo: RTOSCommon.RTOSStrToValueMap) {

        const stackInfo: RTOSCommon.RTOSStackInfo = {
            stackStart: 0,
            stackTop: 0
        };

        stackInfo.stackEnd = getNumberNVL(threadInfo['wabase']?.val, 0);
        stackInfo.stackTop = await this.getStackPointer(threadInfo);

        if (this.hasWAEND) {
            stackInfo.stackStart = Math.max(getNumberNVL(threadInfo['waend']?.val, 0) - this.threadSize);

            if (stackInfo.stackStart !== 0 && stackInfo.stackEnd !== 0) {
                stackInfo.stackSize = Math.abs(stackInfo.stackStart - stackInfo.stackEnd);
                if (stackInfo.stackTop === 0) {
                    stackInfo.stackTop = stackInfo.stackStart;
                }
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

            if (stackInfo.stackSize && stackInfo.stackSize !== 0 ) {
                stackInfo.stackUsed = Math.max(0, stackInfo.stackSize - stackInfo.stackFree);
            }

            // get stack peak
            const unused = await this.scanStackUnused(stackInfo.stackTop, stackInfo.stackEnd, stackInfo.stackFree);
            stackInfo.stackPeak = this.getStackPeak(stackInfo, unused);
        }

        return stackInfo;
    }

    public lastValidHtmlContent: RTOSCommon.HtmlInfo = { html: '', css: '' };
    public getHTML(): RTOSCommon.HtmlInfo {
        const htmlContent: RTOSCommon.HtmlInfo = {
            html: '', css: ''
        };
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
            htmlContent.html = `<p>No ${this.name} threads detected, perhaps RTOS not yet initialized or tasks yet to be created!</p>\n`;
            return htmlContent;
        }

        const ret = this.getHTMLCommon(DisplayFieldNames, ChibiOSItems, this.finalThreads, this.timeInfo);
        htmlContent.html = ret.html + (this.helpHtml || '');
        htmlContent.css = ret.css;

        this.lastValidHtmlContent = htmlContent;
        // console.log(this.lastValidHtmlContent.html);
        return this.lastValidHtmlContent;
    }

}
