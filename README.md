# SignLink

Real-time ASL to speech translation for video calls. AI runs entirely in-browser — no server, no data leaves your device.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         SignLink                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐                      ┌──────────────┐         │
│  │  Deaf User   │◄────── WebRTC ──────►│ Hearing User │         │
│  │              │       (PeerJS)       │              │         │
│  └──────┬───────┘                      └──────┬───────┘         │
│         │                                     │                 │
│         ▼                                     ▼                 │
│  ┌──────────────┐                      ┌──────────────┐         │
│  │ Video Stream │                      │   Caption    │         │
│  │   (Camera)   │                      │   Display    │         │
│  └──────┬───────┘                      └──────┬───────┘         │
│         │                                     │                 │
│         ▼                                     ▼                 │
│  ┌──────────────┐                      ┌──────────────┐         │
│  │ I3D Model    │──── Data Channel ───►│     TTS      │         │
│  │ (ONNX/WASM)  │     (Captions)       │ (Web Speech) │         │
│  └──────────────┘                      └──────────────┘         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## How It Works

1. **Deaf user** signs in front of camera
2. **I3D model** recognizes signs from 64-frame buffer (in-browser via ONNX Runtime)
3. **Prediction** sent to hearing user via WebRTC data channel
4. **Hearing user** sees caption + hears TTS audio

## Stack

| Component | Technology |
|-----------|------------|
| Video/Audio | WebRTC (PeerJS) |
| Signaling | PeerJS Cloud |
| ASL Recognition | I3D model (ONNX, 2000 signs) |
| Inference | ONNX Runtime Web (WASM) |
| Text-to-Speech | Web Speech API |
| Hosting | Vercel |

## Structure

```
/
├── home/                 # Landing page (create/join meeting)
│   ├── index.html
│   ├── style.css
│   └── script.js
├── meet/                 # Video call + ASL inference
│   ├── main.js           # WebRTC, peer connection, captions, TTS
│   ├── i3d-inference.js  # ONNX model loading + inference pipeline
│   ├── control.js        # Camera/mic toggle controls
│   ├── glosses/          # WLASL sign labels (2000)
│   └── models/           # i3d_asl2000.onnx (~50MB)
└── vercel.json           # Deployment config
```
