/* eslint-disable no-async-promise-executor */

import * as vscode from 'vscode';
import { DebugProtocol } from '@vscode/debugprotocol';

export const traceVars = false;

export interface RTOSStackInfo {
    stackStart: number;
    stackTop: number;
    stackEnd?: number;
    stackSize?: number;
    stackUsed?: number;
    stackFree?: number;
    stackPeak?: number;
    bytes?: Uint8Array;
}

export interface VarObjVal {
    val: string; // The value
    ref: number; // Variable reference. Technically, this is not a number, it is handle
    exp: string | undefined; // This is the expression that represents the value
}

export type RTOSStrToValueMap = { [key: string]: VarObjVal };

// It is a bitfield because Link and Collapse are oddballs and do not imply right/left/center justified
// Please follow the conventions so that the look and feel is consistent across RTOSes contributed by
// multiple folks
// Note: The table we produce should still look good when expanding/shrinking in the horizontal direction.. Things
// should not run into each other. Not easy, but do your best and test it
export enum ColTypeEnum {
    colTypeNormal = 0, // Will be left justified. Use for Text fields, fixed width hex values, etc.
    colTypePercentage = 1 << 0, // Will be centered with a % bar
    colTypeNumeric = 1 << 1, // Will be right justified
    colTypeLink = 1 << 2, // TODO: mark it as a link to do something additional. Not totally functional
    colTypeCollapse = 1 << 3 // Items will be collapsible
}

export interface DisplayColumnItem {
    width: number;
    headerRow1: string;
    headerRow2: string;
    fieldName?: string;
    colType?: ColTypeEnum;
    colSpaceFillThreshold?: number; // This makes it fixed width (padded with spaces) unless value width is larger
    colGapBefore?: number; // Use if the field is going to be left justified or fixed width
    colGapAfter?: number; // Use if the field is going to be right justified or fixed width
}

export interface DisplayRowItem {
    text: string;
    value?: any;
}

export interface RTOSDisplayInfo {
    display: { [key: string]: DisplayRowItem }; // Each key is the string of the enum value
}
export interface RTOSThreadInfo extends RTOSDisplayInfo {
    stackInfo: RTOSStackInfo;
    running?: boolean;
}

export interface HtmlInfo {
    html: string;
    css: string;
}

export class ShouldRetry extends Error {
    constructor(str: string) {
        super('Busy or Error for expr ' + str);
    }
}

export abstract class RTOSBase {
    public static disableStackPeaks = false;
    public progStatus: 'started' | 'stopped' | 'running' | 'exited';
    public status: 'failed' | 'initialized' | 'none';
    public className: string;
    protected exprValues: Map<string, RTOSVarHelper> = new Map<string, RTOSVarHelper>();
    protected failedWhy: any; // For debug
    protected uiElementState: Map<string, string> = new Map<string, string>;

    protected constructor(public session: vscode.DebugSession, public readonly name: string) {
        this.status = 'none';
        this.progStatus = 'started';
        this.className = this.name.replace(new RegExp('[^_a-zA-Z0-9-]', 'g'), ''); // Remove invalid CSS chars from name
    }

    //
    // When the promise resolves, check the 'status' property which starts out as 'none'
    // 1. status set to 'initialized' to indicate RTOS has been detected
    // 2. Could not detect an RTOS because session is busy (caller to try again). Status is unmodified. This may
    //    happen because user did a continue or a step
    // 3. Failed to detect an RTOS in which case, status is 'failed' and the host should no longer try use this instance.
    //
    public abstract tryDetect(useFrameId: number): Promise<RTOSBase>;

    private static reqCounter = 0;
    public customRequest(cmd: string, arg: any, opt?: boolean): Thenable<any> {
        // eslint-disable-next-line no-async-promise-executor
        return new Promise<any>(async (resolve, reject) => {
            const c = ++RTOSBase.reqCounter;
            if (traceVars) {
                console.log(`${c} RTOS: request -> ${opt ? 'opt' : ''} ${cmd} ${JSON.stringify(arg)}`);
            }
            try {
                const result = await this.session.customRequest(cmd, arg);
                if (traceVars) {
                    console.log(`${c} RTOS: result <- ${JSON.stringify(result)}`);
                }
                resolve(result);
            } catch (e) {
                if (traceVars) {
                    console.log(`${c} RTOS: exception <- ${e}`);
                }
                reject(e);
            }
        });
    }

    public onStopped(frameId: number): Promise<void> {
        this.progStatus = 'stopped';
        return this.refresh(frameId);
    }

    public onContinued(): void {
        this.progStatus = 'running';
    }

    public onExited(): void {
        this.progStatus = 'exited';
    }

    public updateUIElementState(debugSessionId: string, elementId: string, state: string) {
        if (this.session.id.localeCompare(debugSessionId) === 0) {
            this.uiElementState.set(elementId, state);
        }
    }

    // Refresh the RTOS structures
    public abstract refresh(frameId: number): Promise<void>;

    // Return Html Info (html + style element content) that represents the RTOS state.
    // Ideally, it should return a grid/table that is hosted in an upper level structure
    public abstract getHTML(): HtmlInfo;

    // UTILITY functions for all RTOSes
    protected async evalForVarRef(
        prevValue: number,
        useFrameId: number,
        expr: string,
        optional?: boolean
    ): Promise<number | undefined> {
        if (prevValue !== undefined) {
            return prevValue;
        } else if (this.progStatus !== 'stopped') {
            return undefined;
        }
        const arg: DebugProtocol.EvaluateArguments = {
            frameId: useFrameId,
            expression: expr,
            context: 'hover',
        };
        // eslint-disable-next-line no-useless-catch
        try {
            const result = await this.customRequest('evaluate', arg, optional);
            if (!result || (!optional && result.variablesReference === 0)) {
                throw new Error(`Failed to evaluate ${expr}`);
            }
            return result ? result.variablesReference : 0;
        } catch (e) {
            throw e;
        }
    }

    protected async evalForVarValue(useFrameId: number, expr: string): Promise<string | undefined> {
        const arg: DebugProtocol.EvaluateArguments = {
            frameId: useFrameId,
            expression: expr,
            context: 'hover',
        };
        // eslint-disable-next-line no-useless-catch
        try {
            const result = await this.customRequest('evaluate', arg);
            const ret = result?.result;
            return ret;
        } catch (e) {
            throw e;
        }
    }

    protected getVarChildren(varRef: number, dbg: string): Promise<DebugProtocol.Variable[]> {
        return new Promise<DebugProtocol.Variable[]>((resolve, reject) => {
            if (this.progStatus !== 'stopped') {
                return reject(new Error(`busy, failed to evaluate ${dbg}`));
            } else {
                const arg: DebugProtocol.VariablesArguments = {
                    variablesReference: varRef,
                };
                this.customRequest('variables', arg).then(
                    (result: any) => {
                        if (!result || !result.variables || !result.variables.length) {
                            reject(Error(`Failed to evaluate variable ${arg.variablesReference} ${dbg}`));
                        } else {
                            resolve(result.variables);
                        }
                    },
                    (e) => {
                        reject(e);
                    }
                );
            }
        });
    }

    protected getVarChildrenObj(varRef: number, dbg: string): Promise<RTOSStrToValueMap | null> {
        return new Promise<RTOSStrToValueMap | null>((resolve, reject) => {
            if (varRef === undefined || varRef === 0) {
                resolve(null);
                return;
            }
            this.getVarChildren(varRef, dbg).then(
                (vars) => {
                    const obj = RTOSVarHelper.varsToObj(vars);
                    resolve(obj);
                },
                (e) => {
                    reject(e);
                }
            );
        });
    }

    //
    // It will return (or throw)
    // * The previous value if was already defined or session is busy. If session was busy, you can try again
    // * If 'expr' is evaluated and a value found, then return an instance of `RTOSVarHelper`
    // * If 'expr' is evaluated and but a value NOT found, then (should not attempt re-tries)
    //   * If optional, return null
    //   * If not optional, Throws an exception
    //
    // This function may have to be adjusted for other debuggers, for when there is an error. We know what our
    // behavior is fairly good idea of what cppdbg does
    protected async getVarIfEmpty(
        prev: RTOSVarHelperMaybe,
        fId: number,
        expr: string,
        opt?: boolean
    ): Promise<RTOSVarHelperMaybe> {
        try {
            if (prev !== undefined || this.progStatus !== 'stopped') {
                return prev;
            }
            const tmp = new RTOSVarHelper(expr, this);
            const success = await tmp.tryInitOrUpdate(fId, opt);
            if (!success || (isNullOrUndefined(tmp.value) && this.progStatus !== 'stopped')) {
                // It is most likely busy .... try again. Program status can change while we are querying
                throw new ShouldRetry(expr);
            }
            if (isNullOrUndefined(tmp.value)) {
                if (!opt) {
                    if (traceVars) {
                        console.error(`1. Throwing exception for variable ${expr}`);
                    }
                    throw Error(`${expr} not found`);
                }
                return null;
            }
            return tmp;
        } catch (e) {
            if (e instanceof ShouldRetry) {
                throw e;
            }
            if (opt && this.progStatus === 'stopped') {
                return null; // This optional item will never succeed. Return null to avoid retries
            }
            if (traceVars) {
                console.error(`2. Throwing exception for variable ${expr}`);
            }
            throw new Error(`Failed to evaluate ${expr}: ${e?.toString()}`);
        }
    }

    protected async getExprVal(expr: string, frameId: number): Promise<string | undefined> {
        let exprVar = this.exprValues.get(expr);
        if (!exprVar) {
            exprVar = new RTOSVarHelper(expr, this);
        }
        return exprVar.getValue(frameId);
    }

    protected async getExprValChildren(expr: string, frameId: number): Promise<DebugProtocol.Variable[]> {
        let exprVar = this.exprValues.get(expr);
        if (!exprVar) {
            exprVar = new RTOSVarHelper(expr, this);
        }
        return exprVar.getVarChildren(frameId);
    }

    protected getExprValChildrenObj(expr: string, frameId: number): Promise<RTOSStrToValueMap | any> {
        // eslint-disable-next-line no-async-promise-executor
        return new Promise<RTOSStrToValueMap | any>(async (resolve) => {
            try {
                const vars = await this.getExprValChildren(expr, frameId);
                const obj = RTOSVarHelper.varsToObj(vars);
                resolve(obj);
            } catch (e) {
                resolve(e as any);
            }
        });
    }

    protected htmlEscape(s: string): string {
        return s
            .replace(/&/g, '&amp')
            .replace(/'/g, '&apos')
            .replace(/"/g, '&quot')
            .replace(/>/g, '&gt')
            .replace(/</g, '&lt');
    }

    protected getHTMLDataGrid(columns: any[], rows: any[], attributes: any[], hasComplexContent: boolean = false): string {
        let html = '';
        let attrs = '';
        let headers = '';
        let dataRows = '';
        const columnKeys: any[] = [];

        if (attributes) {
            attributes.forEach(a => {
                if (('name' in a) && ('value' in a)) {
                    attrs += `${a['name']}="${a['value']}"`;
                }
            });
        }

        if (columns) {
            let i = 0;
            columns.forEach(c => {
                if (('title' in c) && ('columnDataKey' in c)) {
                    i++;
                    columnKeys.push(c['columnDataKey']);
                    headers += `<vscode-data-grid-cell cell-type="columnheader" grid-column="${i}">
                                ${this.htmlEscape(c['title'].toString())}</vscode-data-grid-cell>`;
                }
            });
            headers = `<vscode-data-grid-row row-type="header">${headers}</vscode-data-grid-row>`;
        }

        if (rows) {
            rows.forEach(r => {
                let i = 0;
                let dataRow = '';
                columnKeys.forEach(c => {
                    if (c in r) {
                        dataRow += `<vscode-data-grid-cell grid-column="${i}">
                                    ${hasComplexContent ? r[c].toString() : this.htmlEscape(r[c].toString())}</vscode-data-grid-cell>`;
                    } else {
                        dataRow += `<vscode-data-grid-cell grid-column="${i}"></vscode-data-grid-cell>`;
                    }
                });
                dataRows += `<vscode-data-grid-row>${dataRow}</vscode-data-grid-row>`;
                i++;
            });
        }

        html = `<vscode-data-grid ${attrs}}>${headers}${dataRows}</vscode-data-grid>`;

        return html;
    }

    protected getHTMLPanels(tabs: any[], views: any[], attributes: any[], hasComplexContent: boolean = false): string {
        let html = '';
        let attrs = '';
        let panelTabs = '';
        let panelViews = '';

        if (attributes) {
            attributes.forEach(a => {
                if (('name' in a) && ('value' in a)) {
                    attrs += `${a['name']}="${a['value']}"`;
                }
            });
        }

        if (tabs) {
            let i = 1;
            tabs.forEach(t => {
                if ('title' in t) {
                    i++;
                    panelTabs += `<vscode-panel-tab id="tab-${i}">
                                ${hasComplexContent ? t['title'].toString() : this.htmlEscape(t['title'].toString())}
                                </vscode-panel-tab>`;
                }
            });
        }

        if (views) {
            let i = 1;
            views.forEach(v => {
                if ('content' in v) {
                    i++;
                    panelViews += `<vscode-panel-view id="view-${i}">
                                ${hasComplexContent ? v['content'].toString() : this.htmlEscape(v['content'].toString())}
                                </vscode-panel-view>`;
                }
            });
        }

        html = `<vscode-panels ${attrs}}>${panelTabs}${panelViews}</vscode-panels>`;

        return html;
    }

    protected getHTMLTable<T extends RTOSDisplayInfo>(
        displayFieldNames: string[],
        // eslint-disable-next-line @typescript-eslint/naming-convention
        RTOSDisplayColumn: { [key: string]: DisplayColumnItem },
        allRowData: T[],
        fnCreateAdditionalClass: (info: T) => string
    ): HtmlInfo {
        const getAlignClasses = (key: string) => {
            const colType: ColTypeEnum = RTOSDisplayColumn[key].colType || ColTypeEnum.colTypeNormal;
            let ret = '';
            if (colType & ColTypeEnum.colTypePercentage) {
                ret += ' centerAlign';
            }
            if (colType & ColTypeEnum.colTypeNumeric) {
                ret += ' rightAlign';
            }
            return ret;
        };

        const padText = (key: string, txt: string) => {
            let needWSPreserve = false;
            const colSpaceFillThreshold = RTOSDisplayColumn[key].colSpaceFillThreshold;
            if (colSpaceFillThreshold !== undefined && txt.length > 0) {
                txt = txt.padStart(colSpaceFillThreshold);
                needWSPreserve = true;
            }
            const gapBefore = RTOSDisplayColumn[key]?.colGapBefore || 0;
            if (gapBefore > 0) {
                txt = ' '.repeat(gapBefore) + txt;
                needWSPreserve = true;
            }
            const gapAfter = RTOSDisplayColumn[key]?.colGapAfter || 0;
            if (gapAfter > 0) {
                txt += ' '.repeat(gapAfter);
                needWSPreserve = true;
            }
            if (needWSPreserve) {
                txt = `<div class="whitespacePreserve">${txt}</div>`;
            }
            return txt;
        };

        const colFormat = displayFieldNames.map((key) => `${RTOSDisplayColumn[key].width}fr`).join(' ');
        let table = `<vscode-data-grid class="${this.className}-grid threads-grid" grid-template-columns="${colFormat}">\n`;
        let header = '';
        let style = '';
        let row = 1;
        for (const rowData of allRowData) {
            const th = rowData.display;
            if (!header) {
                let col = 1;
                let have2ndRow = false;
                const commonHeaderRowPart = '  <vscode-data-grid-row row-type="header" class="threads-header-row">\n';
                const commonHeaderCellPart =
                    '    <vscode-data-grid-cell cell-type="columnheader" class="threads-header-cell';
                header = commonHeaderRowPart;
                for (const key of displayFieldNames) {
                    const txt = padText(key, RTOSDisplayColumn[key].headerRow1);
                    const additionalClasses = getAlignClasses(key);
                    header += `${commonHeaderCellPart}${additionalClasses}" grid-column="${col}">${txt}</vscode-data-grid-cell>\n`;
                    if (!have2ndRow) {
                        have2ndRow = !!RTOSDisplayColumn[key].headerRow2;
                    }
                    col++;
                }
                header += '  </vscode-data-grid-row>\n';

                if (have2ndRow) {
                    col = 1;
                    header += commonHeaderRowPart;
                    for (const key of displayFieldNames) {
                        const txt = padText(key, RTOSDisplayColumn[key].headerRow2);
                        const additionalClasses = getAlignClasses(key);
                        header += `${commonHeaderCellPart}${additionalClasses}" grid-column="${col}">${txt}</vscode-data-grid-cell>\n`;
                        col++;
                    }
                    header += '  </vscode-data-grid-row>\n';
                }
                table += header;
            }

            let col = 1;
            // prettier-ignore
            const createdAddClass = fnCreateAdditionalClass(rowData);
            const rowClass = `thread-row-${row}`;
            table += `  <vscode-data-grid-row class="${this.className}-row threads-row ${rowClass}">\n`;
            for (const key of displayFieldNames) {
                const v = th[key];
                let txt = padText(key, v.text);
                const lKey = key.toLowerCase();
                let additionalClasses = createdAddClass + getAlignClasses(key);
                const colType = RTOSDisplayColumn[key].colType || ColTypeEnum.colTypeNormal;
                if (colType & ColTypeEnum.colTypePercentage) {
                    if (v.value !== undefined) {
                        const rowValueNumber = parseFloat(v.value);
                        if (!isNaN(rowValueNumber)) {
                            const activeValueStr = Math.floor(rowValueNumber).toString();
                            additionalClasses += ' backgroundPercent';
                            style +=
                                `.${this.className}-grid .${rowClass} .threads-cell-${lKey}.backgroundPercent {\n` +
                                `  --rtosview-percentage-active: ${activeValueStr}%;\n}\n\n`;
                        }
                    }
                } else if (colType & ColTypeEnum.colTypeLink) {
                    // We lose any padding/justification information. Deal with this later when start doing memory windows
                    // and try to preserve formatting. Disable for now
                    // txt = `<vscode-link class="threads-link-${lKey}" href="#">${v.text}</vscode-link>`;
                } else if (colType & ColTypeEnum.colTypeCollapse && v.value) {
                    // Following does not work with current version of Node
                    // const length = Object.values(v.value).reduce((acc: number, cur: string[]) => acc + cur.length, 0);
                    let length = 0;
                    for (const val of Object.values(v.value)) {
                        if (Array.isArray(val)) {
                            length += val.length;
                        }
                    }
                    if (length >= 1) {
                        const descriptions = Object.keys(v.value)
                            .map((key) => `${key}: ${v.value[key].join(', ')}`)
                            .join('<br>');
                        txt = `<button class="collapse-button">${v.text}</button><div class="collapse">${descriptions}</div>`;
                    }
                }

                const cls = `class="${this.className}-cell threads-cell threads-cell-${lKey}${additionalClasses}"`;
                table += `    <vscode-data-grid-cell ${cls} grid-column="${col}">${txt}</vscode-data-grid-cell>\n`;
                col++;
            }
            table += '  </vscode-data-grid-row>\n';
            row++;
        }

        table += '</vscode-data-grid>\n';

        const htmlContent: HtmlInfo = { html: table, css: style };
        return htmlContent;
    }

    protected getHTMLThreads(
        displayFieldNames: string[],
        // eslint-disable-next-line @typescript-eslint/naming-convention
        RTOSDisplayColumn: { [key: string]: DisplayColumnItem },
        allThreads: RTOSThreadInfo[],
        timeInfo: string
    ): HtmlInfo {
        const additionalClassCreator = (info: RTOSThreadInfo) => (info.running === true) ? ' running' : '';
        const htmlTable = this.getHTMLTable(
            displayFieldNames,
            RTOSDisplayColumn,
            allThreads,
            additionalClassCreator);
        let html = htmlTable.html;
        if (timeInfo) {
            html += `<p>Data collected at ${timeInfo}</p>\n`;
        }

        const htmlContent: HtmlInfo = { html: html, css: htmlTable.css };
        return htmlContent;
    }
}

export class RTOSVarHelper {
    public varReference: number | undefined;
    public value: string | undefined;

    constructor(public expression: string, public rtos: RTOSBase) { }

    public static varsToObj(vars: DebugProtocol.Variable[]): RTOSStrToValueMap {
        const obj: RTOSStrToValueMap = {};
        for (const v of vars) {
            const tmp: VarObjVal = {
                val: v.value,
                ref: v.variablesReference,
                exp: v.evaluateName
            };
            obj[v.name] = tmp;
        }
        return obj;
    }

    public async tryInitOrUpdate(useFrameId: number, opt?: boolean): Promise<boolean> {
        try {
            if (this.rtos.progStatus !== 'stopped') {
                return false;
            }
            const arg: DebugProtocol.EvaluateArguments = {
                frameId: useFrameId,
                expression: this.expression,
                context: 'hover'
            };
            this.value = undefined;
            // We have to see what a debugger like cppdbg returns for failures or when busy. And, is hover the right thing to use
            const result = await this.rtos.customRequest('evaluate', arg, opt);
            this.value = result.result;
            this.varReference = result.variablesReference;
            return true;
        } catch (e) {
            const msg = (e as any)?.message as string;
            if (msg) {
                if (
                    msg === 'notStopped' ||  // Official busy signal introduced in the API recently
                    msg === 'Busy' || // Cortex-Debug old message
                    msg.includes('process is running') // cppdbg
                ) {
                    // For cppdbg, the whole message is 'Unable to perform this action because the process is running.'
                    return false;
                }
            }
            throw e;
        }
    }

    public getValue(frameId: number): Promise<string | undefined> {
        return new Promise<string | undefined>(async (resolve, reject) => {
            if (this.rtos.progStatus !== 'stopped') {
                return reject(new Error(`busy, failed on ${this.expression}`));
            } else {
                this.tryInitOrUpdate(frameId).then(
                    (res) => {
                        if (!res) {
                            reject(new Error('failed to initialize/update'));
                        } else {
                            resolve(this.value);
                        }
                    },
                    (e) => {
                        reject(e);
                    }
                );
            }
        });
    }

    public getVarChildren(frameId: number): Promise<DebugProtocol.Variable[]> {
        return new Promise<DebugProtocol.Variable[]>((resolve, reject) => {
            if (this.rtos.progStatus !== 'stopped') {
                return reject(new Error(`busy, failed on ${this.expression}`));
            } else {
                this.getValue(frameId).then(
                    (str) => {
                        if (!this.varReference || !str) {
                            reject(Error(`Failed to get variable reference for ${this.expression}`));
                            return;
                        }
                        const arg: DebugProtocol.VariablesArguments = {
                            variablesReference: this.varReference,
                        };
                        this.rtos.customRequest('variables', arg).then(
                            (result: any) => {
                                if (!result || !result.variables || !result.variables.length) {
                                    reject(
                                        Error(
                                            `Failed to evaluate variable ${this.expression} ${arg.variablesReference}`
                                        )
                                    );
                                } else {
                                    resolve(result.variables);
                                }
                            },
                            (e) => {
                                reject(e);
                            }
                        );
                    },
                    (e) => {
                        reject(e);
                    }
                );
            }
        });
    }

    public getVarChildrenObj(useFrameId: number): Promise<RTOSStrToValueMap> {
        return new Promise<RTOSStrToValueMap>((resolve, reject) => {
            this.getVarChildren(useFrameId).then(
                (vars) => {
                    const obj = RTOSVarHelper.varsToObj(vars);
                    resolve(obj);
                },
                (e) => {
                    reject(e);
                }
            );
        });
    }
}

export type RTOSVarHelperMaybe = RTOSVarHelper | undefined | null;

export class HrTimer {
    private start: bigint;
    constructor() {
        this.start = process.hrtime.bigint();
    }

    public restart(): void {
        this.start = process.hrtime.bigint();
    }

    public getStart(): bigint {
        return this.start;
    }

    public deltaNs(): string {
        return (process.hrtime.bigint() - this.start).toString();
    }

    public deltaUs(): string {
        return this.toStringWithRes(3);
    }

    public deltaMs(): string {
        return this.toStringWithRes(6);
    }

    public createPaddedMs(padding: number): string {
        const hrUs = this.deltaMs().padStart(padding, '0');
        // const hrUsPadded = (hrUs.length < padding) ? '0'.repeat(padding - hrUs.length) + hrUs : '' + hrUs ;
        // return hrUsPadded;
        return hrUs;
    }

    public createDateTimestamp(): string {
        const hrUs = this.createPaddedMs(6);
        const date = new Date();
        const ret = `[${date.toISOString()}, +${hrUs}ms]`;
        return ret;
    }

    private toStringWithRes(res: number) {
        // prettier-ignore
        const diff = process.hrtime.bigint() - this.start + BigInt((10 ** res) / 2);
        let ret = diff.toString();
        ret = ret.length <= res ? '0' : ret.substr(0, ret.length - res);
        return ret;
    }
}

export function isNullOrUndefined(x: any) {
    return x === undefined || x === null;
}

export function hexFormat(value: number, padding = 8, includePrefix = true): string {
    let base = (value >>> 0).toString(16);
    base = base.padStart(padding, '0');
    return includePrefix ? '0x' + base : base;
}

export function toStringDecHexOctBin(val: number /* should be an integer */): string {
    if (Number.isNaN(val)) {
        return 'NaN: Not a number';
    }
    if (!Number.isSafeInteger(val)) {
        // TODO: Handle big numbers. We eventually have to. We need to use bigint as javascript
        // looses precision beyond 53 bits
        return 'Big Num: ' + val.toString() + '\nother-radix values not yet available. Sorry';
    }

    let ret = `dec: ${val}`;
    if (val < 0) {
        val = -val;
        val = (~(val >>> 0) + 1) >>> 0;
    }
    let str = val.toString(16);
    str = '0x' + '0'.repeat(Math.max(0, 8 - str.length)) + str;
    ret += `\nhex: ${str}`;

    str = val.toString(8);
    str = '0'.repeat(Math.max(0, 12 - str.length)) + str;
    ret += `\noct: ${str}`;

    str = val.toString(2);
    str = '0'.repeat(Math.max(0, 32 - str.length)) + str;
    let tmp = '';
    // eslint-disable-next-line no-constant-condition
    while (true) {
        if (str.length <= 8) {
            tmp = str + tmp;
            break;
        }
        tmp = ' ' + str.slice(-8) + tmp;
        str = str.slice(0, -8);
    }
    ret += `\nbin: ${tmp}`;
    return ret;
}
