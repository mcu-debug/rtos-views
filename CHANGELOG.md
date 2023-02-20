# Change Log

## 0.0.5 - Feb 20, 2023

Bug fix: [Issue#22: Fix issue with embOS not working](https://github.com/mcu-debug/rtos-views/issues/22)
Big fix: Fix an issue where we are tracking a session that started but never finished starting. So, it looked like we are tracking a zombie session that never actually started.

## 0.0.4 - Jan 27, 2023

Bug fix: [Issue#16: XRTOS view keeps turning on after restarting vscode](https://github.com/mcu-debug/rtos-views/issues/16)

## 0.0.3 - Jan 10, 2023

Bug fix: [PR#12: Fix bug when OS_TASK_CREATE_EXT_EN is enabled, but code is using OSTaskCreate()](https://github.com/mcu-debug/rtos-views/pull/12)

Bug fix: [PR#11: Fix issue with not showing uC/OS-II thread names](https://github.com/mcu-debug/rtos-views/pull/11)
