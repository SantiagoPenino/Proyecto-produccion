// src/utils/downloadManager.js

class DownloadManager {
    constructor() {
        this.listeners = [];
        this.abortController = null; // AbortController de la descarga en curso (botón "Cancelar" del panel)
        this.state = {
            isActive: false,
            phase: 'idle', // 'idle' | 'downloading' | 'processing' | 'done' | 'error'
            taskName: '',
            bytesDownloaded: 0,
            totalBytes: 0,
            currentFile: 0,
            totalFiles: 0,
            errorMsg: '',
            subTaskName: '',
            cancellable: false
        };
    }

    subscribe(listener) {
        this.listeners.push(listener);
        listener(this.state);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    notify() {
        for (const listener of this.listeners) {
            listener({ ...this.state });
        }
    }

    start(taskName, abortController = null) {
        this.abortController = abortController;
        this.state = {
            isActive: true,
            phase: 'downloading',
            taskName,
            bytesDownloaded: 0,
            totalBytes: 0,
            currentFile: 0,
            totalFiles: 0,
            errorMsg: '',
            subTaskName: '',
            cancellable: !!abortController
        };
        this.notify();
    }

    // Aborta la descarga en curso (el dueño del loop maneja el corte y su toast) y cierra el panel.
    cancel() {
        this.abortController?.abort();
        this.close();
    }

    updateDownloadProgress(bytesDownloaded, totalBytes) {
        this.state.bytesDownloaded = bytesDownloaded;
        this.state.totalBytes = totalBytes || 0;
        this.notify();
    }

    startProcessing(totalFiles) {
        this.state.phase = 'processing';
        this.state.totalFiles = totalFiles;
        this.state.currentFile = 0;
        this.notify();
    }

    updateProcessingProgress(currentFile) {
        this.state.currentFile = currentFile;
        this.notify();
    }

    updateSubTask(subTaskName) {
        this.state.subTaskName = subTaskName;
        this.notify();
    }

    finish() {
        this.abortController = null;
        this.state.phase = 'done';
        this.state.cancellable = false;
        this.notify();
        
        // Auto hide after 3 seconds
        setTimeout(() => {
            if (this.state.phase === 'done') {
                this.state.isActive = false;
                this.notify();
            }
        }, 3000);
    }

    error(msg) {
        this.abortController = null;
        this.state.phase = 'error';
        this.state.errorMsg = msg;
        this.state.cancellable = false;
        this.notify();

        // Auto hide after 5 seconds
        setTimeout(() => {
            if (this.state.phase === 'error') {
                this.state.isActive = false;
                this.notify();
            }
        }, 5000);
    }

    close() {
        this.abortController = null;
        this.state.isActive = false;
        this.state.cancellable = false;
        this.notify();
    }
}

export const downloadManager = new DownloadManager();
