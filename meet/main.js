const localVideo = document.getElementById("local");
const remoteVideo = document.getElementById("remote");
const caption = document.getElementById("caption");
const myIdText = document.getElementById("myId");
const callBtn = document.getElementById("callBtn");
const peerIdInput = document.getElementById("peerId");
const inferenceBtn = document.getElementById("inferenceBtn");
const bufferStatus = document.getElementById("bufferStatus");
const bufferPercentage = document.getElementById("bufferPercentage");
const incomingCallOverlay = document.getElementById("incomingCall");
const acceptCallBtn = document.getElementById("acceptCallBtn");

let localStream;
let pendingCall = null;
let conn;
let call;
let captionTimeout;

// I3D Inference module
let i3d = null;
let isInferenceEnabled = false;
let inferenceWorker = null;
let videoCanvas = null;
let videoCanvasCtx = null;

/* --------------------------
   I3D Model Setup
-------------------------- */
async function initializeI3D() {
  try {
    console.log("Initializing I3D inference module...");
    i3d = new I3DInference();
    
    // Load the model
    const modelLoaded = await i3d.loadModel();
    
    if (modelLoaded) {
      console.log("✓ I3D model initialized successfully");
      inferenceBtn.disabled = false;
      
      // Create canvas for frame capture
      videoCanvas = document.createElement('canvas');
      videoCanvas.width = 224;
      videoCanvas.height = 224;
      videoCanvasCtx = videoCanvas.getContext('2d');
      
      return true;
    } else {
      console.error("Failed to load I3D model");
      inferenceBtn.disabled = true;
      return false;
    }
  } catch (error) {
    console.error("I3D initialization error:", error);
    inferenceBtn.disabled = true;
    return false;
  }
}

/**
 * Capture frame from video element
 */
function captureFrame() {
  if (!localVideo || !videoCanvasCtx) return;
  
  try {
    // Draw current video frame
    videoCanvasCtx.drawImage(localVideo, 0, 0, videoCanvas.width, videoCanvas.height);
    
    // Add to I3D buffer
    if (i3d && isInferenceEnabled) {
      i3d.addFrame(videoCanvas);
      
      // Update buffer status
      const bufferFill = i3d.getBufferFillPercentage();
      bufferPercentage.textContent = bufferFill + "%";
      
      // Show buffer status
      if (bufferFill > 0) {
        bufferStatus.classList.add("show");
      }
    }
  } catch (error) {
    console.error("Frame capture error:", error);
  }
}

/**
 * Continuous frame capture loop
 */
function startFrameCapture() {
  const captureInterval = setInterval(() => {
    if (!isInferenceEnabled) {
      clearInterval(captureInterval);
      return;
    }
    
    captureFrame();
  }, 30); // Roughly 30fps capture rate
}

/**
 * Inference loop
 */
async function inferenceLoop() {
  while (isInferenceEnabled) {
    if (i3d && i3d.isModelLoaded) {
      try {
        const predictions = await i3d.infer();
        
        if (predictions && predictions.length > 0) {
          // Send top prediction via data channel
          const topPrediction = predictions[0];
          const caption = `${topPrediction.gloss} (${topPrediction.confidence})`;
          
          console.log("🎯 Prediction:", caption);
          
          // Send to remote peer
          if (conn && conn.open) {
            conn.send(caption);
          }
        }
      } catch (error) {
        console.error("Inference error:", error);
      }
    }
    
    // Wait before next inference attempt
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

/**
 * Toggle inference on/off
 */
async function toggleInference() {
  if (!i3d || !i3d.isModelLoaded) {
    alert("I3D model is still loading. Please wait...");
    return;
  }
  
  isInferenceEnabled = !isInferenceEnabled;
  
  if (isInferenceEnabled) {
    console.log("🔴 Starting ASL inference...");
    inferenceBtn.classList.add("active");
    i3d.clearBuffer();
    startFrameCapture();
    inferenceLoop(); // Start async inference loop
  } else {
    console.log("⊘ Stopping ASL inference");
    inferenceBtn.classList.remove("active");
    bufferStatus.classList.remove("show");
    i3d.clearBuffer();
  }
}

/* --------------------------
   Metered TURN (for cross-network)
-------------------------- */
const METERED_DOMAIN = "asl-meet.metered.live";
const METERED_SECRET = "HjkVDIwSQwVVEVBRDr6MSu7m5RB8Cl7A6Op5VhLvZavj7yA6";

async function getIceServers() {
  // Try Metered API first
  try {
    const res = await fetch(
      `https://${METERED_DOMAIN}/api/v1/turn/credentials?apiKey=${METERED_SECRET}`
    );
    
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    
    const data = await res.json();
    
    if (!data.iceServers || data.iceServers.length === 0) {
      throw new Error("Empty iceServers response");
    }
    
    console.log("Got ICE servers from Metered:", data.iceServers);
    return data.iceServers;
  } catch (err) {
    console.warn("Metered API failed, using fallback TURN servers:", err.message);
    return getFallbackServers();
  }
}

function getFallbackServers() {
  return [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { 
      urls: "turn:relay1.expressturn.com:443",
      username: "efQ3OLDFTWHXBQD5DD",
      credential: "kpuX4pKETJqKz6yV"
    },
    {
      urls: "turn:freestun.net:3478",
      username: "free",
      credential: "free"
    },
    {
      urls: "turn:numb.viagenie.ca",
      username: "webrtc@live.com",
      credential: "muazkh"
    }
  ];
}

/* --------------------------
   Peer Setup (with short custom ID)
-------------------------- */
let peer;
let peerReady = false;
const myId = Math.random().toString(36).slice(2, 8).toUpperCase();

function tryEnableCall() {
  if (localStream && peerReady) {
    callBtn.disabled = false;
  }
}

async function initPeer() {
  let iceServers = await getIceServers();
  
  // Ensure we have servers
  if (!iceServers || iceServers.length === 0) {
    console.warn("No ICE servers returned, using fallback");
    iceServers = getFallbackServers();
  }
  
  console.log("Using ICE servers:", iceServers);

  peer = new Peer(myId, {
    config: {
      iceServers: iceServers
    },
    debug: 2 // Enable PeerJS debug logging
  });

  peer.on("open", id => {
    myIdText.textContent = id;
    peerReady = true;
    tryEnableCall();
  });

  peer.on("error", err => {
    console.error("Peer error:", err.type, err);
    if (err.type === "unavailable-id") {
      alert("ID collision, please refresh");
    } else if (err.type === "peer-unavailable") {
      alert("Could not find that peer. Make sure the ID is correct.");
    } else if (err.type === "network") {
      alert("Network error. Check your connection.");
    }
  });

  peer.on("call", incoming => {
    // Store the incoming call and show accept button
    pendingCall = incoming;
    incomingCallOverlay.classList.add("show");
  });

  peer.on("connection", c => {
    conn = c;
    conn.on("open", () => setupConn());
  });
}

// Initialize peer and I3D model on page load
(async () => {
  initPeer();
  await new Promise(r => setTimeout(r, 500)); // Brief delay
  await initializeI3D();
})();

/* --------------------------
   Camera
-------------------------- */
navigator.mediaDevices.getUserMedia({
  video: true,
  audio: true
}).then(stream => {
  localStream = stream;
  localVideo.srcObject = stream;
  tryEnableCall();
}).catch(err => {
  console.error("Camera error:", err);
  alert("Please allow camera and microphone access");
});

/* --------------------------
   Call Peer
-------------------------- */
callBtn.onclick = () => {
  const id = peerIdInput.value.trim().toUpperCase();

  if (!id || !localStream || !peerReady) return;

  // Unlock TTS with user gesture (so incoming captions can be spoken)
  speakText(" ");

  // video
  call = peer.call(id, localStream);
  call.on("stream", stream => {
    remoteVideo.srcObject = stream;
    remoteVideo.muted = true;
    remoteVideo.play().then(() => {
      remoteVideo.muted = false;
    }).catch(err => console.log("Autoplay issue:", err));
  });
  call.on("error", err => console.error("Call error:", err));

  // captions channel
  conn = peer.connect(id);
  conn.on("open", () => setupConn());
  conn.on("error", err => console.error("Connection error:", err));
};

/* --------------------------
   Data Channel
-------------------------- */
function setupConn() {
  conn.on("data", text => {
    showCaption(text);
  });
}

/* --------------------------
   Caption + TTS
-------------------------- */
let ttsVoice = null;
let ttsReady = false;

// Load voices (Chrome loads them async)
function loadVoices() {
  const voices = speechSynthesis.getVoices();
  if (voices.length > 0) {
    // Prefer English voice
    ttsVoice = voices.find(v => v.lang.startsWith('en')) || voices[0];
    ttsReady = true;
    console.log("TTS voice loaded:", ttsVoice.name);
  }
}

// Try loading voices immediately and on change
loadVoices();
speechSynthesis.onvoiceschanged = loadVoices;

function speakText(text) {
  if (!ttsReady || !text) return;
  
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = ttsVoice;
  utterance.rate = 1.0;
  utterance.pitch = 1.0;
  
  // Cancel any ongoing speech, then speak after brief delay
  speechSynthesis.cancel();
  setTimeout(() => {
    speechSynthesis.speak(utterance);
  }, 50);
}

function showCaption(text) {
  caption.textContent = text;
  caption.classList.add("show");

  clearTimeout(captionTimeout);
  captionTimeout = setTimeout(() => {
    caption.classList.remove("show");
  }, 3000);

  // Play TTS for predictions - extract gloss from "GLOSS (confidence)" format
  if (text.includes("(") && text.includes(")")) {
    const gloss = text.substring(0, text.indexOf("(")).trim();
    if (gloss) {
      speakText(gloss);
    }
  }
}

/* --------------------------
   Inference Button Handler
-------------------------- */
inferenceBtn.addEventListener("click", toggleInference);
inferenceBtn.disabled = true; // Disabled until model loads

/* --------------------------
   Accept Call Handler
-------------------------- */
acceptCallBtn.addEventListener("click", () => {
  // Unlock TTS with user gesture
  speakText(" ");

  // Hide overlay
  incomingCallOverlay.classList.remove("show");

  // Answer the pending call
  if (pendingCall) {
    call = pendingCall;
    pendingCall = null;

    if (localStream) {
      call.answer(localStream);
    } else {
      const waitForStream = setInterval(() => {
        if (localStream) {
          clearInterval(waitForStream);
          call.answer(localStream);
        }
      }, 100);
    }

    call.on("stream", stream => {
      remoteVideo.srcObject = stream;
      remoteVideo.muted = true;
      remoteVideo.play().then(() => {
        remoteVideo.muted = false;
      }).catch(err => console.log("Autoplay issue:", err));
    });
  }
});
