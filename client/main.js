const localVideo = document.getElementById("local");
const remoteVideo = document.getElementById("remote");
const caption = document.getElementById("caption");
const myIdText = document.getElementById("myId");
const callBtn = document.getElementById("callBtn");
const peerIdInput = document.getElementById("peerId");
const copyBtn = document.getElementById("copyBtn");
const endCallBtn = document.getElementById("endCallBtn");
const statusEl = document.getElementById("status");
const statusText = document.getElementById("statusText");

let localStream;
let conn;
let call;
let captionTimeout;
let userRole = null; // 'deaf' or 'hearing'
let recognition = null; // Speech recognition for hearing people

/* --------------------------
   Copy ID Button
-------------------------- */
copyBtn.onclick = () => {
  const id = myIdText.textContent;
  navigator.clipboard.writeText(id).then(() => {
    copyBtn.textContent = 'Copied!';
    setTimeout(() => {
      copyBtn.textContent = 'Copy';
    }, 2000);
  }).catch(err => {
    console.error('Copy failed:', err);
  });
};

/* --------------------------
   Connection Status
-------------------------- */
function setStatus(status, text) {
  statusEl.className = 'status ' + status;
  statusText.textContent = text;
  
  // Show/hide end call button
  if (status === 'connected') {
    endCallBtn.classList.add('active');
  } else {
    endCallBtn.classList.remove('active');
  }
}

/* --------------------------
   Role Selection
-------------------------- */
window.selectRole = function(role) {
  userRole = role;
  document.getElementById('roleSelection').style.display = 'none';
  document.getElementById('app').classList.add('active');
  console.log('Selected role:', role);
  
  // Initialize camera (and mic for hearing people)
  initCamera();
};

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
    call = incoming;
    setStatus('connecting', 'Incoming call...');
    if (localStream) {
      call.answer(localStream);
    } else {
      // Wait for camera (with timeout)
      let attempts = 0;
      const maxAttempts = 50; // 5 seconds max
      const waitForStream = setInterval(() => {
        attempts++;
        if (localStream) {
          clearInterval(waitForStream);
          call.answer(localStream);
        } else if (attempts >= maxAttempts) {
          clearInterval(waitForStream);
          console.error("Camera not ready in time for incoming call");
          alert("Camera not ready. Please try again.");
          setStatus('disconnected', 'Call failed');
        }
      }, 100);
    }
    call.on("stream", stream => {
      remoteVideo.srcObject = stream;
      // Start muted to allow autoplay, user can unmute
      remoteVideo.muted = true;
      remoteVideo.play().then(() => {
        // Unmute after play starts
        remoteVideo.muted = false;
      }).catch(err => console.log("Autoplay issue:", err));
      setStatus('connected', 'Connected');
    });
    call.on("close", () => {
      setStatus('disconnected', 'Call ended');
      remoteVideo.srcObject = null;
    });
  });

  peer.on("connection", c => {
    conn = c;
    conn.on("open", () => setupConn());
  });
}

initPeer();

/* --------------------------
   Camera (and mic for hearing people)
-------------------------- */
// We need to wait for role selection before requesting media
// So we'll call this after role is selected
function initCamera() {
  const needsMic = userRole === 'hearing';
  
  navigator.mediaDevices.getUserMedia({
    video: true,
    audio: needsMic  // Only hearing people need mic for speech recognition
  }).then(stream => {
    localStream = stream;
    localVideo.srcObject = stream;
    tryEnableCall();
    
    // Start speech recognition for hearing people after camera is ready
    if (userRole === 'hearing') {
      initSpeechRecognition();
    }
  }).catch(err => {
    console.error("Camera error:", err);
    const permissions = needsMic ? "camera and microphone" : "camera";
    alert(`Please allow ${permissions} access`);
  });
}

// Don't auto-initialize camera anymore, wait for role selection

/* --------------------------
   Call Peer
-------------------------- */
callBtn.onclick = () => {
  const id = peerIdInput.value.trim().toUpperCase();

  if (!id || !localStream || !peerReady) return;

  setStatus('connecting', 'Connecting...');

  // video
  call = peer.call(id, localStream);
  call.on("stream", stream => {
    remoteVideo.srcObject = stream;
    remoteVideo.muted = true;
    remoteVideo.play().then(() => {
      remoteVideo.muted = false;
    }).catch(err => console.log("Autoplay issue:", err));
    setStatus('connected', 'Connected');
  });
  call.on("error", err => {
    console.error("Call error:", err);
    setStatus('disconnected', 'Call failed');
  });
  call.on("close", () => {
    setStatus('disconnected', 'Call ended');
    remoteVideo.srcObject = null;
  });

  // captions channel
  conn = peer.connect(id);
  conn.on("open", () => setupConn());
  conn.on("error", err => console.error("Connection error:", err));
};

/* --------------------------
   End Call
-------------------------- */
endCallBtn.onclick = () => {
  if (call) {
    call.close();
    call = null;
  }
  if (conn) {
    conn.close();
    conn = null;
  }
  remoteVideo.srcObject = null;
  setStatus('disconnected', 'Not connected');
};

/* --------------------------
   Data Channel
-------------------------- */
function setupConn() {
  conn.on("data", text => {
    // Both users see captions from the other person
    showCaption(text);
  });
}

/* --------------------------
   Caption display
   TTS only for hearing people (deaf users rely on visual captions)
-------------------------- */
function showCaption(text) {
  caption.textContent = text;
  caption.classList.add("show");

  clearTimeout(captionTimeout);
  captionTimeout = setTimeout(() => {
    caption.classList.remove("show");
  }, 2000);

  // Read caption aloud with TTS (only for hearing people who can hear it)
  if (userRole === 'hearing') {
    speakText(text);
  }
}

/* --------------------------
   Text-to-Speech (for hearing people)
-------------------------- */
function speakText(text) {
  const utterance = new SpeechSynthesisUtterance(text);
  
  // Pick a consistent English voice if available
  const voices = speechSynthesis.getVoices();
  const preferred = voices.find(v => v.lang.startsWith('en') && v.name.includes('Google')) 
                 || voices.find(v => v.lang.startsWith('en'));
  if (preferred) utterance.voice = preferred;
  
  utterance.rate = 1.1; // Slightly faster for real-time conversation
  
  // Clear backlog if queue is getting long, but let current speech finish
  if (speechSynthesis.pending) {
    speechSynthesis.cancel();
  }
  
  speechSynthesis.speak(utterance);
}

/* --------------------------
   Send captions
   - Deaf person sends ASL recognition results
   - Hearing person sends speech recognition results
-------------------------- */
function sendCaption(text) {
  if (conn?.open) {
    conn.send(text);
    console.log('Sent caption:', text);
  }
}

/* --------------------------
   Speech Recognition (for hearing people)
   Converts speech to text and sends to deaf person
-------------------------- */
function initSpeechRecognition() {
  // Check browser support
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  
  if (!SpeechRecognition) {
    console.warn('Speech recognition not supported in this browser');
    alert('Speech recognition is not supported in your browser. Try Chrome or Edge.');
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = true;  // Keep listening
  recognition.interimResults = false;  // Only send final results
  recognition.lang = 'en-US';

  recognition.onstart = () => {
    console.log('Speech recognition started');
  };

  recognition.onresult = (event) => {
    const last = event.results.length - 1;
    const text = event.results[last][0].transcript;
    
    console.log('Recognized speech:', text);
    
    // Send the recognized text to deaf person
    sendCaption(text);
  };

  recognition.onerror = (event) => {
    console.error('Speech recognition error:', event.error);
    
    if (event.error === 'no-speech') {
      console.log('No speech detected, continuing to listen...');
    } else if (event.error === 'not-allowed') {
      alert('Microphone access denied. Please allow microphone access.');
    }
  };

  recognition.onend = () => {
    // Restart recognition if it stops (for continuous listening)
    console.log('Speech recognition ended, restarting...');
    if (userRole === 'hearing' && localStream) {
      setTimeout(() => {
        try {
          recognition.start();
        } catch (e) {
          console.warn('Failed to restart recognition:', e.message);
          // Retry once after a delay
          setTimeout(() => {
            try {
              recognition.start();
            } catch (retryError) {
              console.error('Speech recognition failed to restart:', retryError);
              alert('Speech recognition stopped. Please refresh the page.');
            }
          }, 1000);
        }
      }, 100);
    }
  };

  // Start listening
  try {
    recognition.start();
    console.log('Speech recognition initialized');
  } catch (e) {
    console.error('Failed to start speech recognition:', e);
  }
}

/* --------------------------
   TEMP: Demo sender for deaf person
   (Replace this with actual ASL hand tracking later)
-------------------------- */
setInterval(() => {
  if (userRole === 'deaf' && conn?.open) {
    sendCaption("Hello from signer");
  }
}, 4000);