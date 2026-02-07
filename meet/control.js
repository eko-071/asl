const toggleCameraBtn = document.getElementById("toggleCamera");
const toggleMicBtn = document.getElementById("toggleMic");
const endCallBtn = document.getElementById("endCall");

// --- Toggle Camera ---
toggleCameraBtn.onclick = () => {
    // Check if stream exists before trying to toggle
    if (!localStream) return;
    
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        // Toggle visual class
        toggleCameraBtn.classList.toggle("off", !videoTrack.enabled);
    }
};

// --- Toggle Mic ---
toggleMicBtn.onclick = () => {
    if (!localStream) return;
    
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        // Toggle visual class
        toggleMicBtn.classList.toggle("off", !audioTrack.enabled);
    }
};

// --- End Call ---
endCallBtn.onclick = () => {
    if (call) call.close();
    if (conn) conn.close();
    
    // Redirect to Google Meet
    window.location.href = "../home/index.html";
};