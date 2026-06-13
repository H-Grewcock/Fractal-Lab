// js/shared/exportMedia.js:

export function exportCanvasPNG(canvas, filename = "fractal.png") {
    // Fails if there is no canvas
    if (!canvas) {
        throw new Error("exportCanvasPNG requires canvas");
    }

    const link = document.createElement("a");   // temporary download link
    link.download = filename;
    link.href = canvas.toDataURL("image/png");  // Converts canvas pixels to PNG data URL
    link.click();                               // Clicking link starts the download
}

function pickSupportedMimeType() {
    // Allows us to choose best video MIME type supported by the current browser
    const candidates = [
        "video/webm;codecs=vp9",
        "video/webm;codecs=vp8",
        "video/webm",
    ];
    
    for (const t of candidates) {
        // Using MediaRecorder: tests a few WebM options and uses first one that works
        if (window.MediaRecorder && MediaRecorder.isTypeSupported(t)) return t;
    }

    // Empty string allows MediaRecorder to choose a default if possible
    return "";
}

export class CanvasRecorder {
    constructor(canvas, { fps = 60, mimeType = "" } = {}) {
        if (!canvas) throw new Error("CanvasRecorder requires canvas");
        // Older browsers may not support canvas.captureStream()
        if (!canvas.captureStream) throw new Error("CanvasRecorder: captureStream not supported");
        
        this.canvas = canvas;
        this.fps = fps;
        this.mimeType = mimeType || pickSupportedMimeType();    // Uses requested MIMe type / pick supported one
        this.mediaRecorder = null;
        this.chunks = [];                   // Video data chunks collected while recording   
        this.isRecording = false;           // Tracks if recording is currently active
    }

    // Starts recording canvas
    start() {
        // Prevents starting two recordings at once
        if (this.isRecording) return;

        // Creates video stream from the canvas
        const stream = this.canvas.captureStream(this.fps);

        const options = this.mimeType 
            ? { mimeType: this.mimeType } 
            : undefined;
        
        // Clears previous recording chunks
        this.chunks = [];
        // Creates recorder for the canvas stream
        this.mediaRecorder = new MediaRecorder(stream, options);
        // Stores available video data
        // (Chunks later combined into one Blob when recording stops)
        this.mediaRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) this.chunks.push(e.data);
        };

        this.mediaRecorder.start();
        this.isRecording = true;
    }

    // Stops recording canvas and downloads the video
    stop({ filename = "recording.webm"} = {}) {
        // If there is no active recording, don't need to do anything
        return new Promise((resolve) => {
            if (!this.mediaRecorder || !this.isRecording) {
                resolve(null);
                return;
            }

            // When MediaRecorder stops, combine chunks into a Blob and download as a video file
            this.mediaRecorder.onstop = () => {
                // Builds final video file from recorded chunks
                const blob = new Blob(this.chunks, {
                    type: this.mimeType || "video/webm"
                });

                const url = URL.createObjectURL(blob);      // temporary URL for the Blob
                const a = document.createElement("a");      // temporary download link
                a.href = url;
                a.download = filename;

                // Starts download
                a.click();

                // Cleans up temporary URL after download starts
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                this.isRecording = false;       // Marks recorder as stopped
                
                resolve(blob);
            };

            // Stops
            this.mediaRecorder.stop();
        });
    }
}