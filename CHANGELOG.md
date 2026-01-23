# Change Log

- Read stackTop for current running task with function contributed by @malsyned also in uc/OS-II.
- Add FS-RTOS support. FS-RTOS is very similar to uC/OS-II, so no need to create a own implementation for it.

## 0.0.14-pre1 - Jan 14, 2026

- PR#84: Contribution to support for STMicroelectronics adapters
- PR$87: Contribution to support for FS-RTOS

## 0.0.13-pre1 - Nov 17, 2025

- PR#82: Zephyr support: fixed detection of stack_info and curTaskObjBase.prio

## 0.0.12-pre1 - Sep 17, 2025

-   PR#75: Add support for uC/OS-III.
-   PR#77: Add support for ThreadX.
-   PR#76: Add support Arm:RTX5

## 0.0.11 - Sep 5, 2025

-   Issue#71: XRTOS tab - task loading on FreeRtos leads to infinite loop

## 0.0.10 - Aug 30, 2025

-   PR#61: FreeRTOS: Show vQueueAddToRegistry() hint only for empty queues
-   PR#68: Read stackTop from FreeRTOS MPU context block. This is a major contribution by @malsyned (thanks).

## 0.0.10-pre2 - Apr 12, 2025

-   PR#44: Add support for SMP on FreeRTOS
-   PR#54: Add to list of tracked debuggers. cortex-debug, cppdbg and cspy are already in the list of tracked debuggers. This adds to that list via the setting `rtos-views.trackDebuggers`
-   PR#57: runtime % support for FreeRTOS V11

## 0.0.8 - Sep 7, 2023

-   Updated to newest debug protocol APIs. No real changes

## 0.0.7 - Jun 14, 2023

-   Just a maintenance release

## 0.0.6 - Mar 11, 2023

-   ChibiOS contains much more information (Timers, Globals, etc.) than before and compared to all the other RTOSes.

-   Change: all RTOS implementation that have stack peaks (uC/OS-II, embOS, ChibiOS, FreeRTOS) now respect the `disableStackPeaks` setting (previously only FreeRTOS did this)

-   Bugfix: [Fix delay times showing up wrong and add ticks as unit for embOS](https://github.com/mcu-debug/rtos-views/issues/30)

-   Bugfix: embOS did show the event type pending on

## 0.0.5 - Feb 20, 2023

-   Bug fix: [Issue#22: Fix issue with embOS not working](https://github.com/mcu-debug/rtos-views/issues/22)

-   Bug fix: Fix an issue where we are tracking a session that started but never finished starting. So, it looked like we are tracking a zombie session that never actually started.

## 0.0.4 - Jan 27, 2023

-   Bug fix: [Issue#16: XRTOS view keeps turning on after restarting vscode](https://github.com/mcu-debug/rtos-views/issues/16)

## 0.0.3 - Jan 10, 2023

-   Bug fix: [PR#12: Fix bug when OS_TASK_CREATE_EXT_EN is enabled, but code is using OSTaskCreate()](https://github.com/mcu-debug/rtos-views/pull/12)

-   Bug fix: [PR#11: Fix issue with not showing uC/OS-II thread names](https://github.com/mcu-debug/rtos-views/pull/11)
