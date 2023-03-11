// Get access to the VS Code API from within the webview context
const vscode = acquireVsCodeApi();

// Just like a regular webpage we need to wait for the webview
// DOM to load before we can reference any of the HTML elements
// or toolkit components
window.addEventListener('load', main);

// Main function that gets executed once the webview DOM loads
function main() {
    const refreshButton = document.getElementById('refresh-button');
    if (refreshButton) {
        refreshButton.addEventListener('click', refreshClicked);
    }

    const rtosPanels = document.getElementById('rtos-panels');
    if (rtosPanels) {
        rtosPanels.addEventListener('change', (e) => {
            onRTOSPanelsChange(e.target.getAttribute('debug-session-id'), e.target['activeid']);
        });
    }

    setVSCodeMessageListener();

    setupFoldButtons();
    setupHelpButton();
}

function setupFoldButtons() {
    var coll = document.getElementsByClassName('collapse-button');
    var i;

    for (i = 0; i < coll.length; i++) {
        coll[i].addEventListener('click', function () {
            this.classList.toggle('active');
            var content = this.nextElementSibling;
            if (content.style.maxHeight) {
                content.style.maxHeight = null;
            } else {
                content.style.maxHeight = 'None';
            }
        });
    }
}

function setupHelpButton() {
    var coll = document.getElementsByClassName('help-button');
    var i;

    for (i = 0; i < coll.length; i++) {
        coll[i].addEventListener('click', function () {
            this.classList.toggle('active');
            var content = this.nextElementSibling;
            if (content.style.maxHeight) {
                content.style.maxHeight = null;
            } else {
                content.style.maxHeight = content.scrollHeight + 'px';
            }
        });
    }
}

function refreshClicked() {
    // Passes a message back to the extension context
    vscode.postMessage({
        type: 'refresh',
        body: {}
    });
}

function onRTOSPanelsChange(debugSessionId, activeId) {
    // Passes a message back to the extension context
    vscode.postMessage({
        type: 'change',
        debugSessionId: debugSessionId,
        elementId: 'rtos-panels.activeid',
        body: activeId
    });
}

// Sets up an event listener to listen for messages passed from the extension context
// and executes code based on the message that is received
function setVSCodeMessageListener() {
    window.addEventListener('message', (event) => {
        const command = event.data.command;
        const data = JSON.parse(event.data.payload);
    });
}
