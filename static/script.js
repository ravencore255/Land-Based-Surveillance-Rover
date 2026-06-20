function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.querySelector('.toggle-btn');
    sidebar.classList.toggle('open');
    toggleBtn.classList.toggle('open');
}

document.getElementById('controlMode').addEventListener('change', (e) => {
    fetch('/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: e.target.value })
    });
});

document.addEventListener('keydown', (e) => {
    let data = { key: e.key }
    fetch('/keypress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    })
});

document.addEventListener('keyup', (e) => {
    fetch('/keypress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'stop' })
    })
});

document.getElementById('resolution').addEventListener('change', (e) => {
    fetch('/set_res', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution: e.target.value })
    });
});

document.addEventListener('click', function (e) {
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.querySelector('.toggle-btn');

    if (!sidebar.contains(e.target) && !toggleBtn.contains(e.target)) {
        sidebar.classList.remove('open');
        toggleBtn.classList.remove('open'); // <-- this line resets the icon
    }
});

let ffmpegLoaded = false;

window.addEventListener('DOMContentLoaded', async () => {
    const startRecordBtn = document.getElementById('startRecordBtn');

    // Keep button disabled until ready
    startRecordBtn.disabled = true;

    // Background load FFmpeg library
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/@ffmpeg/ffmpeg@0.10.1/dist/ffmpeg.min.js';

    script.onload = async () => {
        // Init ffmpeg instance in background
        const { createFFmpeg } = FFmpeg;
        const ffmpeg = createFFmpeg({ log: false });

        try {
            await ffmpeg.load(); // THIS is the heaviest part
            ffmpegLoaded = true;
            startRecordBtn.disabled = false; // Enable button when ready
            console.log('FFmpeg loaded and ready');
        } catch (err) {
            console.error('FFmpeg failed to load', err);
        }

        // Save ffmpeg instance if needed globally
        window.ffmpeg = ffmpeg;
    };

    document.head.appendChild(script);
});

// --- New Recording Functionality ---
const mainVideoFeed = document.getElementById('mainVideoFeed'); // Get a reference to the main video feed image
const startRecordBtn = document.getElementById('startRecordBtn');
const stopRecordBtn = document.getElementById('stopRecordBtn');
const captureCanvas = document.getElementById('captureCanvas');
const ctx = captureCanvas.getContext('2d');

let downloadFolderHandle = null;
let downloadFolderNameSpan = null;
let selectedFolderHandle = null;
let saveDotLock = false;

let mediaRecorder;
let recordedBlobs;
let captureInterval;
const frameRate = 24; // Record at 24 frames per second

function flashDot(buttonId) {
    const dot = document.querySelector(`#${buttonId} .save-dot`);
    if (!dot) return;

    dot.style.animation = 'none';
    void dot.offsetWidth;
    dot.style.animation = 'saveFlash 0.8s ease';
}

async function ensureFolderSelected() {
    if (!selectedFolderHandle) {
        try {
            selectedFolderHandle = await window.showDirectoryPicker();
            document.getElementById('folderNameLabel').textContent = selectedFolderHandle.name;
            console.log('Folder selected:', selectedFolderHandle.name);
        } catch (err) {
            console.error('Folder selection cancelled or failed:', err);
            throw err; // So caller can decide whether to continue or not
        }
    }
    return selectedFolderHandle;
}

// --- Start Recording Function ---
startRecordBtn.addEventListener('click', () => {
    // Set canvas size to match the displayed image size
    captureCanvas.width = mainVideoFeed.clientWidth;
    captureCanvas.height = mainVideoFeed.clientHeight;

    // Create a video stream from the canvas
    const stream = captureCanvas.captureStream(frameRate);

    // Check for browser support
    if (!MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) {
        alert('VP9 codec (or WebM) is not supported in your browser. Try a different browser like Chrome or Firefox.');
        return;
    }

    // Configure and start the MediaRecorder
    recordedBlobs = [];
    const options = { mimeType: 'video/webm;codecs=vp9' };
    try {
        mediaRecorder = new MediaRecorder(stream, options);
    } catch (e) {
        console.error('Exception while creating MediaRecorder:', e);
        alert(`Exception while creating MediaRecorder: ${e.message}. Check browser support and try refreshing.`);
        return;
    }

    mediaRecorder.onstop = async () => {
        console.log('Recorder stopped. Converting to MP4...');

        const ffmpeg = window.ffmpeg;

        const webmBlob = new Blob(recordedBlobs, { type: 'video/webm' });
        const webmArrayBuffer = await webmBlob.arrayBuffer();

        ffmpeg.FS('writeFile', 'input.webm', new Uint8Array(webmArrayBuffer));
        await ffmpeg.run('-i', 'input.webm', '-c:v', 'copy', 'output.mp4');

        const mp4Data = ffmpeg.FS('readFile', 'output.mp4');

        const mp4Blob = new Blob([mp4Data.buffer], { type: 'video/mp4' });
        const mp4Url = URL.createObjectURL(mp4Blob);


        try {
            const folder = await ensureFolderSelected();
            const timestamp = new Date().toISOString().replace(/[:]/g, '-');
            const fileName = `recording-${timestamp}.mp4`;
            const fileHandle = await folder.getFileHandle(fileName, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(mp4Blob);
            await writable.close();
            
            requestAnimationFrame(() => {
                flashDot('stopRecordBtn');
                setTimeout(() => {
                    stopRecordBtn.disabled = true;
                    startRecordBtn.disabled = false;
                }, 800); // match animation duration
                console.log(`Recording saved to: ${fileName}`);
            });
    
        } catch (err) {
            alert('Recording could not be saved. Folder not selected.');
        }

        URL.revokeObjectURL(mp4Url);
    };

    mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
            recordedBlobs.push(event.data);
        }
    };

    mediaRecorder.start();
    console.log('MediaRecorder started', mediaRecorder);

    // Start capturing frames from the image to the canvas
    captureInterval = setInterval(() => {
        ctx.drawImage(mainVideoFeed, 0, 0, captureCanvas.width, captureCanvas.height);
    }, 1000 / frameRate);

    // Update UI
    startRecordBtn.disabled = true;
    stopRecordBtn.disabled = false;
});

// --- Stop Recording Function ---
stopRecordBtn.addEventListener('click', () => {
    // Stop the recorder and the frame capture
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
    if (captureInterval) {
        clearInterval(captureInterval);
    }

    // Update UI
    console.log('Recording stopped by user.');
});

document.getElementById('snapshotBtn').addEventListener('click', async () => {
    try {
        const folder = await ensureFolderSelected();

        captureCanvas.width = mainVideoFeed.clientWidth;
        captureCanvas.height = mainVideoFeed.clientHeight;
        ctx.drawImage(mainVideoFeed, 0, 0, captureCanvas.width, captureCanvas.height);

        const dot = document.querySelector('#snapshotBtn .save-dot');

        captureCanvas.toBlob(async blob => {
            const timestamp = new Date().toISOString().replace(/[:]/g, '-');
            const fileHandle = await folder.getFileHandle(`snapshot-${timestamp}.png`, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();
            requestAnimationFrame(() => {
                flashDot('snapshotBtn');
            });
        }, 'image/png');

    } catch (err) {
        alert('Folder selection required to save.');
    }
});

document.getElementById('editDownloadDirBtn').addEventListener('click', async () => {
    selectedFolderHandle = null; // reset so ensureFolderSelected will prompt
    try {
        await ensureFolderSelected();
    } catch (err) {2
        // User cancelled
    }
});