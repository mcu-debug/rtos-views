/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from 'vscode';
import { DebugProtocol } from '@vscode/debugprotocol';
import * as RTOSCommon from './rtos-common';

// RTX5 SCVD objects

// CB Sections: objects with custom control blocks, linker option os_cb_sections
const SCVD_cbSectionsObjects = [
    { name: 'TCB', type: 'osRtxThread_t', size: 80 },
    { name: 'CCB', type: 'osRtxTimer_t', size: 32 },
    { name: 'ECB', type: 'osRtxEventFlags_t', size: 16 },
    { name: 'MCB', type: 'osRtxMutex_t', size: 28 },
    { name: 'SCB', type: 'osRtxMemoryPool_t', size: 16 },
    { name: 'PCB', type: 'osRtxSemaphore_t', size: 36 },
    { name: 'QCB', type: 'osRtxMessageQueue_t', size: 52 }
];

const _SCVD_mpiSectionsObjects = [
    { name: 'stack', type: 'osRtxMpInfo_t' },
    { name: 'thread', type: 'osRtxMpInfo_t' },
    { name: 'timer', type: 'osRtxMpInfo_t' },
    { name: 'event_flags', type: 'osRtxMpInfo_t' },
    { name: 'mutex', type: 'osRtxMpInfo_t' },
    { name: 'semaphore', type: 'osRtxMpInfo_t' },
    { name: 'memory_pool', type: 'osRtxMpInfo_t' },
    { name: 'message_queue', type: 'osRtxMpInfo_t' }
];

const Rtx5MemSectionType = new Map<number, { name: string, type: string }>([
    [0x00, { name: 'UNKNOWN', type: 'uint8_t' }],   // Unknown Block
    [0xF1, { name: 'TCB', type: 'osRtxThread_t' }],   // Thread Control Block
    [0xF2, { name: 'CCB', type: 'osRtxTimer_t' }],   // Timer Control Block
    [0xF3, { name: 'ECB', type: 'osRtxEventFlags_t' }],   // EventFlags Control Block
    [0xF5, { name: 'MCB', type: 'osRtxMutex_t' }],   // Mutex Control Block
    [0xF6, { name: 'SCB', type: 'osRtxSemaphore_t' }],   // Semaphore Control Block
    [0xF7, { name: 'PCB', type: 'osRtxMemoryPool_t' }],   // MemoryPool Control Block
    [0xFA, { name: 'QCB', type: 'osRtxMessageQueue_t' }],   // MessageQueue Control Block
]);

const KernelState = new Map<number, { name: string; info: string }>([
    [0, { name: 'osKernelInactive', info: 'Inactive' }],
    [1, { name: 'osKernelReady', info: 'Ready' }],
    [2, { name: 'osKernelRunning', info: 'Running' }],
    [3, { name: 'osKernelLocked', info: 'Locked' }],
    [4, { name: 'osKernelSuspended', info: 'Suspended' }],
    [5, { name: 'osKernelError', info: 'Error' }],
]);

const ThreadState = new Map<number, { name: string; isRunning: boolean }>([
    [0x00, { name: 'Inactive', isRunning: false }],
    [0x01, { name: 'Ready', isRunning: false }],
    [0x02, { name: 'Running', isRunning: true }],
    [0x03, { name: 'Blocked', isRunning: false }],
    [0x04, { name: 'Terminated', isRunning: false }],
    [0x13, { name: 'Waiting Delay', isRunning: false }],
    [0x23, { name: 'Waiting Join', isRunning: false }],
    [0x33, { name: 'Waiting Thread Flags', isRunning: false }],
    [0x43, { name: 'Waiting Event Flags', isRunning: false }],
    [0x53, { name: 'Waiting Mutex', isRunning: false }],
    [0x63, { name: 'Waiting Semaphore', isRunning: false }],
    [0x73, { name: 'Waiting Memory Pool', isRunning: false }],
    [0x83, { name: 'Waiting Message Get', isRunning: false }],
    [0x93, { name: 'Waiting Message Put', isRunning: false }],
    [0xff, { name: 'Error', isRunning: false }],
]);

const ThreadPriorityMap = new Map<number, { name: string, info: string }>([
    [0, { name: 'osPriorityNone', info: 'No priority assigned' }],
    [1, { name: 'osPriorityIdle', info: 'Idle thread priority' }],
    [8, { name: 'osPriorityLow', info: 'Lowest user thread priority' }],
    [9, { name: 'osPriorityLow1', info: 'Low priority +1' }],
    [10, { name: 'osPriorityLow2', info: 'Low priority +2' }],
    [11, { name: 'osPriorityLow3', info: 'Low priority +3' }],
    [12, { name: 'osPriorityLow4', info: 'Low priority +4' }],
    [13, { name: 'osPriorityLow5', info: 'Low priority +5' }],
    [14, { name: 'osPriorityLow6', info: 'Low priority +6' }],
    [15, { name: 'osPriorityLow7', info: 'Low priority +7' }],
    [16, { name: 'osPriorityBelowNormal', info: 'Below normal priority' }],
    [17, { name: 'osPriorityBelowNormal1', info: 'Below normal +1' }],
    [18, { name: 'osPriorityBelowNormal2', info: 'Below normal +2' }],
    [19, { name: 'osPriorityBelowNormal3', info: 'Below normal +3' }],
    [20, { name: 'osPriorityBelowNormal4', info: 'Below normal +4' }],
    [21, { name: 'osPriorityBelowNormal5', info: 'Below normal +5' }],
    [22, { name: 'osPriorityBelowNormal6', info: 'Below normal +6' }],
    [23, { name: 'osPriorityBelowNormal7', info: 'Below normal +7' }],
    [24, { name: 'osPriorityNormal', info: 'Normal thread priority' }],
    [25, { name: 'osPriorityNormal1', info: 'Normal +1' }],
    [26, { name: 'osPriorityNormal2', info: 'Normal +2' }],
    [27, { name: 'osPriorityNormal3', info: 'Normal +3' }],
    [28, { name: 'osPriorityNormal4', info: 'Normal +4' }],
    [29, { name: 'osPriorityNormal5', info: 'Normal +5' }],
    [30, { name: 'osPriorityNormal6', info: 'Normal +6' }],
    [31, { name: 'osPriorityNormal7', info: 'Normal +7' }],
    [32, { name: 'osPriorityAboveNormal', info: 'Above normal priority' }],
    [33, { name: 'osPriorityAboveNormal1', info: 'Above normal +1' }],
    [34, { name: 'osPriorityAboveNormal2', info: 'Above normal +2' }],
    [35, { name: 'osPriorityAboveNormal3', info: 'Above normal +3' }],
    [36, { name: 'osPriorityAboveNormal4', info: 'Above normal +4' }],
    [37, { name: 'osPriorityAboveNormal5', info: 'Above normal +5' }],
    [38, { name: 'osPriorityAboveNormal6', info: 'Above normal +6' }],
    [39, { name: 'osPriorityAboveNormal7', info: 'Above normal +7' }],
    [40, { name: 'osPriorityHigh', info: 'High thread priority' }],
    [41, { name: 'osPriorityHigh1', info: 'High +1' }],
    [42, { name: 'osPriorityHigh2', info: 'High +2' }],
    [43, { name: 'osPriorityHigh3', info: 'High +3' }],
    [44, { name: 'osPriorityHigh4', info: 'High +4' }],
    [45, { name: 'osPriorityHigh5', info: 'High +5' }],
    [46, { name: 'osPriorityHigh6', info: 'High +6' }],
    [47, { name: 'osPriorityHigh7', info: 'High +7' }],
    [48, { name: 'osPriorityRealtime', info: 'Realtime thread priority' }],
    [49, { name: 'osPriorityRealtime1', info: 'Realtime +1' }],
    [50, { name: 'osPriorityRealtime2', info: 'Realtime +2' }],
    [51, { name: 'osPriorityRealtime3', info: 'Realtime +3' }],
    [52, { name: 'osPriorityRealtime4', info: 'Realtime +4' }],
    [53, { name: 'osPriorityRealtime5', info: 'Realtime +5' }],
    [54, { name: 'osPriorityRealtime6', info: 'Realtime +6' }],
    [55, { name: 'osPriorityRealtime7', info: 'Realtime +7' }],
    [56, { name: 'osPriorityISR', info: 'Interrupt Service Routine priority' }],
    [-1, { name: 'osPriorityError', info: 'Invalid or error priority' }],
]);

enum MemBlockType {
    cbSections = 'cbSections',
    memSection = 'osRtxInfo',
    mpiSection = 'mpiSection',
    idleThread = 'idleThread',
    timerThread = 'timerThread',
}

/*const MemBlockTypeMap = new Map<MemBlockType, string>([
    [MemBlockType.cbSections, 'os_cb_sections'],
    [MemBlockType.memSection, 'osRtxInfo.mem'],
    [MemBlockType.mpiSection, 'osRtxInfo.mpi'],
    [MemBlockType.idleThread, 'osRtxInfo.thread.idle'],
    [MemBlockType.timerThread, 'osRtxInfo.timer.thread'],
]);*/

type TCBObject = {
    memBlock: MemBlockType;
    children: DebugProtocol.Variable[][];
};

// We will have two rows of headers for RTX5 and the table below describes
// the columns headers for the two rows and the width of each column as a fraction
// of the overall space.
enum DisplayFields {
    Address,
    //MemSection,
    TaskName,
    Status,
    Priority,
    StackPercent,
    StackPeak,
    //StackTopEnd,
}

const RTOSRTX5Items: { [key: string]: RTOSCommon.DisplayColumnItem } = {};
RTOSRTX5Items[DisplayFields[DisplayFields.Address]] = {
    width: 1,
    headerRow1: 'Thread',
    headerRow2: 'Address',
};
/*RTOSRTX5Items[DisplayFields[DisplayFields.MemSection]] = {
    width: 1,
    headerRow1: '',
    headerRow2: 'Memory Section',
};*/
RTOSRTX5Items[DisplayFields[DisplayFields.TaskName]] = {
    width: 1,
    headerRow1: '',
    headerRow2: 'Name',
};
RTOSRTX5Items[DisplayFields[DisplayFields.Status]] = {
    width: 1,
    headerRow1: '',
    headerRow2: 'Status',
};
RTOSRTX5Items[DisplayFields[DisplayFields.Priority]] = {
    width: 1,
    headerRow1: '',
    headerRow2: 'Priority',
};
RTOSRTX5Items[DisplayFields[DisplayFields.StackPercent]] = {
    width: 1,
    headerRow1: 'Stack Usage',
    headerRow2: '% (Used B / Size B)',
    colType: RTOSCommon.ColTypeEnum.colTypePercentage,
};
RTOSRTX5Items[DisplayFields[DisplayFields.StackPeak]] = { 
    width: 1, 
    headerRow1: '', 
    headerRow2: '% (Peak Bytes)',
    colType: RTOSCommon.ColTypeEnum.colTypePercentage,
};
/*RTOSRTX5Items[DisplayFields[DisplayFields.StackTopEnd]] = { 
    width: 1, 
    headerRow1: '', 
    headerRow2: 'Address' 
};*/

const DisplayFieldNames: string[] = Object.keys(RTOSRTX5Items);

type CbSection = {
    name: string;
    start: number;
    size: number;
    type: string;
};

export class RTOSRTX5 extends RTOSCommon.RTOSBase {
    // We keep a bunch of variable references (essentially pointers) that we can use to query for values
    // Since all of them are global variable, we only need to create them once per session. These are
    // similar to Watch/Hover variables
    private osRtxConfig: RTOSCommon.RTOSVarHelperMaybe;
    private osRtxInfo: RTOSCommon.RTOSVarHelperMaybe;
    private os_id: RTOSCommon.RTOSVarHelperMaybe;
    private version: RTOSCommon.RTOSVarHelperMaybe;
    private kernelState: RTOSCommon.RTOSVarHelperMaybe;
    private os_cb_sections: RTOSCommon.RTOSVarHelperMaybe;
    private os_mpi_sections: RTOSCommon.RTOSVarHelperMaybe;
    private os_mem_sections: RTOSCommon.RTOSVarHelperMaybe;
    private os_idle: RTOSCommon.RTOSVarHelperMaybe;
    private os_timer: RTOSCommon.RTOSVarHelperMaybe;
    private tzInitContextSystem_S: RTOSCommon.RTOSVarHelperMaybe;

    private tcbObjects: TCBObject[] = [];
    private threadAddress: number[] = [];

    private os_Config = {
        stack_check:  false,
        stack_wmark:  false,
        safety_feat:  false,
        safety_class: false,
        exec_zone:    false,
        watchdog:     false,
        obj_check:    false,
        svc_check:    false,
    };

    private stale = true;
    private foundThreads: RTOSCommon.RTOSThreadInfo[] = [];
    private finalThreads: RTOSCommon.RTOSThreadInfo[] = [];
    private timeInfo = '';
    private readonly maxThreads = 1024;
    private helpHtml: string | undefined;
    private idleThread: DebugProtocol.Variable[] | undefined;
    private timerThread: DebugProtocol.Variable[] | undefined;

    constructor(public session: vscode.DebugSession) {
        super(session, 'RTX5');
    }

    public async tryDetect(useFrameId: number): Promise<RTOSCommon.RTOSBase> {
        this.progStatus = 'stopped';

        // Detection of symbols that must not exist
        try {
            if(this.status === 'none') {
                this.tzInitContextSystem_S = await this.getVarIfEmpty(
                    this.tzInitContextSystem_S,
                    useFrameId,
                    'TZ_InitContextSystem_S'
                );
            }
            console.log('RTX5: Trustzone detected');
        } catch (e) {
            console.log('RTX5: No Trustzone detected');
        }

        try {
            if (this.status === 'none') {
                // We only get references to all the interesting variables. Note that any one of the following can fail
                // and the caller may try again until we know that it definitely passed or failed. Note that while we
                // re-try everything, we do remember what already had succeeded and don't waste time trying again. That
                // is how this.getVarIfEmpty() works
                this.osRtxConfig = await this.getVarIfEmpty(
                    this.osRtxConfig,
                    useFrameId,
                    'osRtxConfig'
                );
                this.osRtxInfo = await this.getVarIfEmpty(
                    this.osRtxInfo,
                    useFrameId,
                    'osRtxInfo'
                );
                this.os_id = await this.getVarIfEmpty(
                    this.os_id,
                    useFrameId,
                    '(const char*)(osRtxInfo.os_id)'
                );
                this.version = await this.getVarIfEmpty(
                    this.version,
                    useFrameId,
                    '(uint32_t)(osRtxInfo.version)'
                );
                this.kernelState = await this.getVarIfEmpty(
                    this.kernelState,
                    useFrameId,
                    '(uint8_t)(osRtxInfo.kernel.state)'
                );
                this.os_cb_sections = await this.getVarIfEmpty(
                    this.os_cb_sections,
                    useFrameId,
                    'os_cb_sections'
                );
                this.os_mpi_sections = await this.getVarIfEmpty(
                    this.os_mpi_sections,
                    useFrameId,
                    'osRtxInfo.mpi'
                );
                this.os_mem_sections = await this.getVarIfEmpty(
                    this.os_mem_sections,
                    useFrameId,
                    'osRtxInfo.mem'
                );
                this.os_idle = await this.getVarIfEmpty(
                    this.os_idle,
                    useFrameId,
                    'osRtxInfo.thread.idle'
                );
                this.os_timer = await this.getVarIfEmpty(
                    this.os_timer,
                    useFrameId,
                    'osRtxInfo.timer.thread'
                );

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

    private async readOsCbSections(frameId: number): Promise<void> {
        const children = await this.os_cb_sections?.getVarChildren(frameId);
        if (!children || children.length === 0) {
            return;
        }

        const cb_SectionsArr = children.map(child => parseInt(child.value));
        const sections: CbSection[] = SCVD_cbSectionsObjects.map((obj, index) => {
            return {
                name: obj.name,
                start: cb_SectionsArr[index * 2],
                size: (cb_SectionsArr[index * 2 + 1] - cb_SectionsArr[index * 2]) / obj.size,
                type: obj.type
            };
        });

        const sectionsToEvaluate = sections
            .filter((section) => (
                section.name === 'TCB'
                && section.start !== 0
                && section.size > 0
            ));

        const sectionsEvaluated = await Promise.all(
            sectionsToEvaluate.map(async (section) => {
                const children = [];
                for (let i = 0; i < Math.floor(section.size); i++) {
                    const expr = `((${section.type} *)${RTOSCommon.hexFormat(section.start)})[${i}]`;
                    const child = await this.getExprValChildren(expr, frameId);
                    children.push(child);
                }
                return {
                    name: section.name,
                    children
                };
            })
        );

        const tcbSection = sectionsEvaluated.find((sec) => sec.name === 'TCB');
        if (tcbSection && tcbSection.children.length > 0) {
            this.tcbObjects.push({ memBlock: MemBlockType.cbSections, children: tcbSection.children });
        }

        //console.log('RTX5: cb_sections evaluated:', sectionsEvaluated);
    }

    private async readIdleAndTimer(frameId: number): Promise<void> {
        const idleChilds = await this.os_idle?.getVarChildren(frameId);
        const timerChilds = await this.os_timer?.getVarChildren(frameId);
        if (idleChilds && idleChilds.length >= 0) {
            this.idleThread = idleChilds;
            const childs = [idleChilds];
            this.tcbObjects.push({ memBlock: MemBlockType.idleThread, children: childs });
        }

        if (timerChilds && timerChilds.length >= 0) {
            this.timerThread = timerChilds;
            const childs = [timerChilds];
            this.tcbObjects.push({ memBlock: MemBlockType.timerThread, children: childs });
        }
        //console.log('RTX5: Idle and Timer threads evaluated:', idleChilds, timerChilds);
    }

    private async readMpiSection(frameId: number): Promise<void> {
        // block_base is where you start reading, control block size is the size to read and to increment the pointer,
        // max_blocks is the number of control blocks that can fit into memory pool.
        // Meaning that you can have gaps in memory, control blocks that belong to destroyed threads, hence check if they are valid
        // TCB[i].cb_valid = (TCB[i].id == 0xF1) &amp;&amp; (TCB[i].state != 0) &amp;&amp; (TCB[i].sp != 0);

        const os_mpi_sections = await this.os_mpi_sections?.getVarChildren(frameId);
        const mpiThreadObj = os_mpi_sections?.find((section) => section.name === 'thread');
        const blockAddr = parseInt(mpiThreadObj?.value ?? '0');
        if(blockAddr && mpiThreadObj && mpiThreadObj.evaluateName) {
            const mpiThreadSection = await this.getExprValChildren(mpiThreadObj.evaluateName, frameId);
            const blockSize = parseInt(mpiThreadSection.find((section) => section.name === 'block_size')?.value ?? '0');
            const maxBlocks = parseInt(mpiThreadSection.find((section) => section.name === 'max_blocks')?.value ?? '0');

            for(let idx=0; idx < maxBlocks; idx++) {
                const expr = `(osRtxThread_t*)(${mpiThreadObj.evaluateName}.block_base + (${idx * blockSize}))`;
                const tcbObj = await this.getExprValChildren(expr, frameId);

                if (tcbObj && tcbObj.length > 0) {
                    const tcb = tcbObj[0];
                    if (tcb.value !== '0x0') {
                        this.tcbObjects.push({ memBlock: MemBlockType.mpiSection, children: [tcbObj] });
                    }
                }
            }
        }
        //console.log('RTX5: MPI section evaluated:', os_mpi_sections);
    }

    private async readMemSection(frameId: number): Promise<void> {
        const os_mem_sections = await this.os_mem_sections?.getVarChildren(frameId);
        const os_mem_common = os_mem_sections?.find((section) => section.name === 'common');
        const osMemCommonObjectsGeneric = [];
        if (os_mem_common) {
            /* read full mem_head_t + *next pointer from first block
            //  Memory Pool Header structure
            typedef struct {
                uint32_t size;                // Memory Pool size
                uint32_t used;                // Used Memory
            } mem_head_t; */
            const currAddrStr = os_mem_common.value;    // start of first block
            let currAddr = currAddrStr ? parseInt(currAddrStr) + (2 * 4) : 0;  // skip mem_head_t

            while(currAddr !== 0) {     // follow *next pointer until 0
                /* Read 3 consecutive uint32_t values as an array:
                //  Memory Block Header structure
                typedef struct mem_block_s {
                    struct mem_block_s *next;     // Next Memory Block in list
                    uint32_t            info;     // Block Info or max used Memory (in last block)
                    uint8_t             id;       // Block ID (hidden)
                } mem_block_t; */
                const currBlockExpr = `*(uint32_t (*)[3])(${RTOSCommon.hexFormat(currAddr)})`;  // read 3 consecutive uint32_t values (mem_block_t + (uint8_t)id)
                const currBlockObj = await this.getExprValChildren(currBlockExpr, frameId);

                const nextAddr = parseInt(currBlockObj[0]?.value ?? '0');
                const info = parseInt(currBlockObj[1]?.value ?? '0');
                const size = info;

                const id = parseInt(currBlockObj[2]?.value ?? '0') & 0xff;
                const entry = Rtx5MemSectionType.get(id) ?? Rtx5MemSectionType.get(0);
                const typeName = entry?.name ?? RTOSCommon.hexFormat(id);
                const typeCast = entry?.type;

                osMemCommonObjectsGeneric.push({
                    addr: RTOSCommon.hexFormat(currAddr +(2*4)), // +2*4 to skip mem_block_t
                    size,
                    type: typeName,
                    typeCast,
                    id
                });
                currAddr = nextAddr;
            }
        }

        const osMemCommonObjects = await Promise.all(osMemCommonObjectsGeneric
            .filter(obj => obj.type !== 'UNKNOWN')
            .map(async (obj) => {
                const memObjExpr = obj.id > 0
                    ? `(${obj.typeCast} *)${obj.addr}`
                    : `*(${obj.typeCast} (*)[${obj.size}])${obj.addr}`;
                const memObj = await this.getExprValChildren(memObjExpr, frameId);

                return {
                    type: obj.type,
                    start: obj.addr,
                    id: obj.id,
                    obj: memObj
                };
            })
        );

        const childs = osMemCommonObjects
            .filter(obj => obj.type === 'TCB')
            .map((obj) => obj.obj);
        if(childs.length > 0) {
            this.tcbObjects.push({ memBlock: MemBlockType.memSection, children: childs });
        }
        //console.log('RTX5: Memory section evaluated:', osMemCommonObjects);
    }

    private async gatherThreadInfo(frameId: number): Promise<void> {
        await Promise.all(this.tcbObjects.map(async (tcb) => {
            await Promise.all(tcb.children
                .map(async (tcbChild) => {
                    await this.getThreadInfo(tcbChild, frameId, tcb.memBlock);
            }));
        }));

        return;
    }

    public async getOsRtxConfig(frameId: number): Promise<void> {
        if (this.osRtxConfig) {
            const osRtxConfig = await this.osRtxConfig?.getVarChildren(frameId);
            const osRtxConfigObject = osRtxConfig?.find(v => v.name === 'flags');
            const os_ConfigFlags = parseInt(osRtxConfigObject?.value ?? '0');
            this.os_Config = {
                stack_check:  (os_ConfigFlags >> 1) & 1 ? true : false,
                stack_wmark:  (os_ConfigFlags >> 2) & 1 ? true : false,
                safety_feat:  (os_ConfigFlags >> 3) & 1 ? true : false,
                safety_class: (os_ConfigFlags >> 4) & 1 ? true : false,
                exec_zone:    (os_ConfigFlags >> 5) & 1 ? true : false,
                watchdog:     (os_ConfigFlags >> 6) & 1 ? true : false,
                obj_check:    (os_ConfigFlags >> 7) & 1 ? true : false,
                svc_check:    (os_ConfigFlags >> 8) & 1 ? true : false,
            };
            //console.log('RTX5: os_Config flags:', this.os_Config);
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
            this.foundThreads = [];

            this.os_id?.getValue(frameId).then(
                async (str) => {
                    this.getOsRtxConfig(frameId);
                    
                    const os_id = str?.split(' "')[1]?.replace(/"$/, '') ?? '<OS not detected>';
                    const osVersionStr = await this.version?.getValue(frameId);
                    const osVersion = osVersionStr ? parseInt(osVersionStr) : 0;
                    const osKernelStateStr = await this.kernelState?.getValue(frameId);
                    const osKernelState = osKernelStateStr ? parseInt(osKernelStateStr) : 0;
                    const osKernelStateText = KernelState.get(osKernelState) ?? { name: 'UNKNOWN', info: 'Unknown state' };
                    console.log(`RTX5: os_id = ${os_id}, version = ${osVersion}, kernelState = ${osKernelStateText.name}`);

                    if((Math.floor(osVersion / 10000000) === 5) && osKernelState >= 0 && osKernelState <= 5) {
                        try {
                            this.tcbObjects.length = 0; // reset tcbObjects
                            await this.readOsCbSections(frameId);
                            await this.readIdleAndTimer(frameId);
                            await this.readMpiSection(frameId);
                            await this.readMemSection(frameId);
                            await this.gatherThreadInfo(frameId);

                            // Remove duplicate Address entries
                            const uniqueThreads = new Map<string, RTOSCommon.RTOSThreadInfo>();
                            for (const thread of this.foundThreads) {
                                const addr = thread.display['Address'].text;
                                if (!uniqueThreads.has(addr)) {
                                    uniqueThreads.set(addr, thread);
                                }
                            }
                            this.finalThreads = Array.from(uniqueThreads.values())
                                .sort((a, b) =>
                                    parseInt(a.display['Address'].text) - parseInt(b.display['Address'].text)
                                );
                            this.stale = false;
                            this.timeInfo += ' in ' + timer.deltaMs() + ' ms';
                            resolve();
                        } catch (e) {
                            console.error(e);
                        }
                    }
                }
            );
        });
    }

    private getTimerOrIdle(tcbChild: DebugProtocol.Variable[]) {
        const threadAddrStr = tcbChild.find(item => item.name === 'thread_addr')?.value;
        if (threadAddrStr !== undefined) {
            const threadAddr = parseInt(threadAddrStr);
            const timerAddr = parseInt(this.timerThread?.find(item => item.name === 'thread_addr')?.value ?? '0') ?? 0;
            const idleAddr = parseInt(this.idleThread?.find(item => item.name === 'thread_addr')?.value ?? '0') ?? 0;

            if (threadAddr === timerAddr) {
                return '&lt;OS Timer&gt;';
            } else if (threadAddr === idleAddr) {
                return '&lt;OS Idle&gt;';
            }
        }
        return undefined;
    }


    private async getThreadInfo(tcbChild: DebugProtocol.Variable[], frameId: number, _memBlock: MemBlockType): Promise<void> {
        const stackWatermark = 0xCC;
        const stackMagicWord = 0xE25A2EA5;
        const stackInfo = await this.getStackInfo(tcbChild, stackWatermark, stackMagicWord, frameId);
        const display: { [key: string]: RTOSCommon.DisplayRowItem } = {};
        const mySetter = (x: DisplayFields, text: string, value?: any) => {
            display[DisplayFieldNames[x]] = { text, value };
        };

        return new Promise<void>((resolve, reject) => {
            if (!tcbChild || tcbChild.length === 0) {
                resolve();
                return;
            }

            if (this.progStatus !== 'stopped') {
                reject(new Error('Busy'));
                return;
            }

            // Validate TCB: all required fields must pass their checks, otherwise invalid
            const tcbValid = tcbChild.reduce((valid, item) => {
                if (!valid) {return false;}
                switch (item.name) {
                    case 'id': return parseInt(item.value) === 0xF1;
                    case 'state': return parseInt(item.value) !== 0;
                    case 'sp': return parseInt(item.value) !== 0;
                    default: return valid;
                }
            }, true);

            if (!tcbValid) {
                resolve();
                return;
            }

            let threadRunning = false;
            tcbChild
            .filter((item) =>   // filter out items that are not relevant for display, to not iterate through whole list each time
                item.name === 'name'
                || item.name === 'thread_addr'
                || item.name === 'state'
                || item.name === 'priority'
            )
            .forEach((item) => {
                switch (item.name) {
                    case 'name': {
                        // Extract name from value, e.g. '0x8007c26 "OS Idle"'
                        const match = item.value.match(/"([^"]*)"/);
                        if (match && match[1]) {
                            mySetter(DisplayFields.TaskName, match[1]);
                        } else {
                            const name = this.getTimerOrIdle(tcbChild);
                            mySetter(DisplayFields.TaskName, name ?? '&lt;not set&gt;');
                        }
                    } break;
                    case 'thread_addr': {
                        const addr = parseInt(item.value ?? '0');
                        mySetter(DisplayFields.Address, RTOSCommon.hexFormat(addr, 8, true));
                    } break;
                    case 'state': {
                        const state = parseInt(item.value ?? '0');
                        const threadState = ThreadState.get(state);
                        const stateText = threadState ? threadState.name : 'UNKNOWN';
                        threadRunning = threadState?.isRunning ?? false;
                        mySetter(DisplayFields.Status, stateText);
                    } break;
                    case 'priority': {
                        const prio = parseInt(item.value ?? '0');
                        const prioText = ThreadPriorityMap.get(prio)?.name ?? `(${prio.toString()})`;
                        mySetter(DisplayFields.Priority, prioText);
                    } break;
                }
            });

            // Stack usage
            if(stackInfo.stackUsed !== undefined && stackInfo.stackSize) {
                const stackPercent = Math.round((stackInfo.stackUsed / stackInfo.stackSize) * 100);
                mySetter(
                    DisplayFields.StackPercent,
                    `${stackPercent} % (${stackInfo.stackUsed} / ${stackInfo.stackSize})`,
                    stackPercent
                );
            } else {
                mySetter(DisplayFields.StackPercent, '?? %');
            }

            // Stack peak
            if(stackInfo.stackPeak !== undefined && stackInfo.stackPeak > 0 && stackInfo.stackSize !== undefined) {
                const peakPercent = (stackInfo.stackPeak >= 0)
                    ? Math.round((stackInfo.stackPeak / stackInfo.stackSize) * 100)
                    : 100;
                mySetter(
                    DisplayFields.StackPeak,
                    stackInfo.stackPeak >= 0
                        ? `${peakPercent} % (${(stackInfo.stackPeak)})`
                        : 'OVERFLOW',
                    peakPercent
                );
            } else {
                mySetter(DisplayFields.StackPeak, '??');
            }

            /*mySetter(
                DisplayFields.StackTopEnd,
                stackInfo.stackTop !== undefined && stackInfo.stackEnd !== undefined
                    ? `${RTOSCommon.hexFormat(stackInfo.stackEnd, 8, true)} .. ${RTOSCommon.hexFormat(stackInfo.stackStart, 8, true)}`
                    : '??'
            );*/
            /*mySetter(
                DisplayFields.MemSection,
                MemBlockTypeMap.get(memBlock) ?? 'UNKNOWN'
            );*/

            const thread: RTOSCommon.RTOSThreadInfo = {
                display: display,
                stackInfo: stackInfo,
                running: threadRunning,
            };
            this.foundThreads.push(thread);
            resolve();
        });
    }
    
    protected async getStackInfo(tcbChild: DebugProtocol.Variable[], waterMark: number, magicWord: number, frameId: number): Promise<RTOSCommon.RTOSStackInfo> {
        const stackSize = parseInt(tcbChild.find(item => item.name === 'stack_size')?.value ?? '0') ?? 0;
        const stackPointer = parseInt(tcbChild.find(item => item.name === 'sp')?.value ?? '0') ?? 0;
        const stackMemAddr = parseInt(tcbChild.find(item => item.name === 'stack_mem')?.value ?? '0') ?? 0;
        const _stackFrame = parseInt(tcbChild.find(item => item.name === 'stack_frame')?.value ?? '0') ?? 0;
        const threadState = parseInt(tcbChild.find(item => item.name === 'state')?.value ?? '0') ?? 0;
        const threadRunning = threadState !== undefined && threadState === 2; // Running state
        let currStackPointer = stackPointer;

        if(threadRunning) {
            // If thread is running, then we use the current stack pointer
            const ipsrRegStr = await this.getExprVal('$xpsr', frameId);
            const ipsrReg = (ipsrRegStr ? parseInt(ipsrRegStr) : 0) & 0x01FF;
            const pspRegStr = this.tzInitContextSystem_S !== undefined
                ? await this.getExprVal('$psp_ns', frameId) 
                : await this.getExprVal('$psp', frameId);
            const pspReg = (pspRegStr ? parseInt(pspRegStr) : 0);
            const currPSP  = pspReg ?? stackPointer;
            currStackPointer = ((ipsrReg !== 0 && ipsrReg < 16)) ? (stackPointer) : (currPSP);
        }

        // Check parameters for stack calculation
        if(stackMemAddr === 0 || stackSize === 0 || currStackPointer === 0) {
            return {
                stackStart: 0,
                stackTop: 0,
            };
        } 
        
        const stackCurrentUsed = stackSize - Math.abs(currStackPointer - stackMemAddr);
        let stackBytes: Uint8Array | undefined;
        let stackPeak = 0;

        if(currStackPointer < stackMemAddr || currStackPointer > (stackMemAddr + stackSize)) {
            stackPeak = -1;
        }

        // Note: Magic Word is always set!
        if (RTOSCommon.RTOSBase.disableStackPeaks || !this.os_Config.stack_wmark) {
            const magicWordReadExpr = `*((uint32_t *)(${RTOSCommon.hexFormat(stackMemAddr)}))`;
            const magicWordValStr = await this.getExprVal(magicWordReadExpr, frameId);
            const magicWordVal = magicWordValStr ? parseInt(magicWordValStr) : 0;
            if (magicWordVal !== 0 && magicWordVal !== magicWord) {
                stackPeak = -1;
            }
        }
        else {
            const memArg: DebugProtocol.ReadMemoryArguments = {
                memoryReference: RTOSCommon.hexFormat(stackMemAddr),
                count: currStackPointer - stackMemAddr,
            };
            try {
                const stackData = await this.session.customRequest('readMemory', memArg);
                if(stackData !== undefined && stackData.data !== undefined) {
                    const buf = Buffer.from(stackData.data, 'base64');
                    stackBytes = new Uint8Array(buf);
                    if(stackPeak !== -1 && stackBytes.length >= 4) {
                        const stackMagicWord = ( // Calculate magicWord from the first 4 bytes of stackBytes
                            (stackBytes[0] |
                            (stackBytes[1] << 8) |
                            (stackBytes[2] << 16) |
                            (stackBytes[3] << 24)) >>> 0);
                        if (stackMagicWord !== magicWord) {
                            stackPeak = -1; // magic word is not correct, mark overflow
                        }
                    }
                    if (stackPeak !== -1) {
                        const unused = stackBytes.slice(4).findIndex(b => b !== waterMark);
                        stackPeak = stackSize - (unused >= 0 ? unused : stackBytes.length - 4);
                    }
                }
            } catch (e) {
                console.log(e);
            }
        }
        
        return  {
            stackStart: stackMemAddr, // address of stack buffer, lower address
            stackTop: currStackPointer, // current SP of thread
            stackEnd: stackMemAddr + stackSize, // highest address, start+size
            stackSize: stackSize, // size of stack buffer
            stackUsed: stackCurrentUsed, // current used stack size
            stackFree: stackSize - stackCurrentUsed, // current free stack size
            stackPeak: stackPeak, // peak stack usage
            bytes: stackBytes
        };
    }

    public lastValidHtmlContent: RTOSCommon.HtmlInfo = { html: '', css: '' };
    public getHTML(): RTOSCommon.HtmlInfo {
        const htmlContent: RTOSCommon.HtmlInfo = { html: '', css: '' };
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

        const ret = this.getHTMLThreads(DisplayFieldNames, RTOSRTX5Items, this.finalThreads, this.timeInfo);
        htmlContent.html = msg + ret.html + (this.helpHtml || '');
        htmlContent.css = ret.css;

        this.lastValidHtmlContent = htmlContent;
        return this.lastValidHtmlContent;
    }
}
