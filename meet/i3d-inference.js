/**
 * I3D Inference Module for ASL Sign Recognition
 * Performs real-time inference on video frames using ONNX Runtime
 */

class I3DInference {
  constructor() {
    this.session = null;
    this.isModelLoaded = false;
    this.isInferring = false;
    
    // Model configuration matching the Python implementation
    this.VIDEO_BUFFER_SIZE = 64;        // Frames needed for one inference
    this.INFERENCE_STRIDE = 8;           // Sample every Nth frame
    this.FRAME_SIZE = 224;               // Square frame size (224x224)
    this.TOPK = 5;                       // Return top 5 predictions
    this.frameBuffer = [];
    this.frameCount = 0;
    
    // Glosses mapping (loaded from JSON)
    this.idToGloss = null;
    this.lastPredictions = [];
    
    // Timing control
    this.lastInferenceTime = 0;
    this.INFERENCE_INTERVAL = 2.0;       // seconds between inferences
    
    // ONNX Runtime Tensor constructor
    this.Tensor = null;
  }

  /**
   * Load the ONNX model and gloss mapping
   */
  async loadModel() {
    try {
      console.log("[I3D] Loading ONNX model...");
      
      // Check if ONNX Runtime is loaded
      if (typeof ort === 'undefined') {
        throw new Error('ONNX Runtime not loaded. Please ensure the script tag is included in HTML.');
      }
      
      // Load gloss mapping
      await this.loadGlossMapping();
      
      // Store Tensor constructor for later use
      this.Tensor = ort.Tensor;
      
      // Set WebAssembly configurations
      console.log("[I3D] Configuring WASM paths...");
      ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@latest/dist/';
      
      console.log("[I3D] Loading model from: /meet/models/i3d_asl2000.onnx");
      this.session = await ort.InferenceSession.create('/meet/models/i3d_asl2000.onnx');
      
      this.isModelLoaded = true;
      console.log("[I3D] ✓ Model loaded successfully");
      return true;
    } catch (error) {
      console.error("[I3D] Failed to load model:", error);
      alert("Failed to load I3D model. Please ensure the model file exists.");
      return false;
    }
  }

  /**
   * Load gloss mapping from JSON file
   */
  async loadGlossMapping() {
    try {
      const response = await fetch('/meet/glosses/wlasl_glosses.json');
      const glossList = await response.json();
      
      // Create id to gloss mapping
      this.idToGloss = {};
      glossList.forEach((item, idx) => {
        this.idToGloss[idx] = item.gloss || `Sign_${idx}`;
      });
      
      console.log(`[I3D] Loaded ${Object.keys(this.idToGloss).length} glosses`);
    } catch (error) {
      console.error("[I3D] Failed to load gloss mapping:", error);
      // Create fallback mapping
      this.idToGloss = {};
      for (let i = 0; i < 2000; i++) {
        this.idToGloss[i] = `Sign_${i}`;
      }
    }
  }

  /**
   * Preprocess a video frame (matching Python implementation)
   * Input: ImageData or canvas ImageData
   * Output: Float32Array normalized to [-1, 1]
   */
  preprocessFrame(imageData) {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;

    // Get minimum dimension and scale to 224
    const minDim = Math.min(width, height);
    const scale = this.FRAME_SIZE / minDim;
    
    const newWidth = Math.floor(width * scale);
    const newHeight = Math.floor(height * scale);

    // Create canvas for resizing
    const canvas = document.createElement('canvas');
    canvas.width = newWidth;
    canvas.height = newHeight;
    const ctx = canvas.getContext('2d');
    
    const imgData = ctx.createImageData(newWidth, newHeight);
    const srcData = new Uint8ClampedArray(data);
    
    // Bilinear interpolation resize
    for (let y = 0; y < newHeight; y++) {
      for (let x = 0; x < newWidth; x++) {
        const srcX = x / scale;
        const srcY = y / scale;
        
        const x0 = Math.floor(srcX);
        const y0 = Math.floor(srcY);
        const x1 = Math.min(x0 + 1, width - 1);
        const y1 = Math.min(y0 + 1, height - 1);
        
        const dx = srcX - x0;
        const dy = srcY - y0;
        
        for (let c = 0; c < 3; c++) {
          const v00 = srcData[(y0 * width + x0) * 4 + c];
          const v10 = srcData[(y0 * width + x1) * 4 + c];
          const v01 = srcData[(y1 * width + x0) * 4 + c];
          const v11 = srcData[(y1 * width + x1) * 4 + c];
          
          const v0 = v00 * (1 - dx) + v10 * dx;
          const v1 = v01 * (1 - dx) + v11 * dx;
          const v = v0 * (1 - dy) + v1 * dy;
          
          imgData.data[(y * newWidth + x) * 4 + c] = Math.round(v);
        }
      }
    }
    
    // Center crop to 224x224
    const cropStartX = Math.max(0, Math.floor((newWidth - this.FRAME_SIZE) / 2));
    const cropStartY = Math.max(0, Math.floor((newHeight - this.FRAME_SIZE) / 2));
    
    const croppedFrame = new Float32Array(this.FRAME_SIZE * this.FRAME_SIZE * 3);
    
    for (let y = 0; y < this.FRAME_SIZE; y++) {
      for (let x = 0; x < this.FRAME_SIZE; x++) {
        const srcIdx = ((cropStartY + y) * newWidth + (cropStartX + x)) * 4;
        const dstIdx = (y * this.FRAME_SIZE + x) * 3;
        
        // RGB normalization: (pixel / 255) * 2 - 1
        croppedFrame[dstIdx] = (imgData.data[srcIdx] / 255.0) * 2 - 1;     // R
        croppedFrame[dstIdx + 1] = (imgData.data[srcIdx + 1] / 255.0) * 2 - 1; // G
        croppedFrame[dstIdx + 2] = (imgData.data[srcIdx + 2] / 255.0) * 2 - 1; // B
      }
    }
    
    return croppedFrame;
  }

  /**
   * Add a frame from canvas to the buffer
   */
  addFrame(canvas) {
    try {
      const ctx = canvas.getContext('2d');
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const processedFrame = this.preprocessFrame(imageData);
      
      this.frameBuffer.push(processedFrame);
      
      // Keep buffer at max size
      if (this.frameBuffer.length > this.VIDEO_BUFFER_SIZE) {
        this.frameBuffer.shift();
      }
      
      this.frameCount++;
    } catch (error) {
      console.error("[I3D] Error adding frame:", error);
    }
  }

  /**
   * Perform inference on the current frame buffer
   * Returns array of top-K predictions with scores
   */
  async infer() {
    if (!this.isModelLoaded || !this.session) {
      console.warn("[I3D] Model not loaded");
      return null;
    }

    if (this.frameBuffer.length < this.VIDEO_BUFFER_SIZE) {
      console.log(`[I3D] Buffer not full: ${this.frameBuffer.length}/${this.VIDEO_BUFFER_SIZE}`);
      return null;
    }

    const now = performance.now() / 1000;
    if (now - this.lastInferenceTime < this.INFERENCE_INTERVAL) {
      return null; // Too soon for another inference
    }

    try {
      // Stack frames: (T, H, W, C) = (64, 224, 224, 3)
      const inputData = new Float32Array(this.VIDEO_BUFFER_SIZE * this.FRAME_SIZE * this.FRAME_SIZE * 3);
      
      for (let t = 0; t < this.VIDEO_BUFFER_SIZE; t++) {
        const frame = this.frameBuffer[t];
        for (let i = 0; i < this.FRAME_SIZE * this.FRAME_SIZE * 3; i++) {
          inputData[t * (this.FRAME_SIZE * this.FRAME_SIZE * 3) + i] = frame[i];
        }
      }

      // Reshape to (1, C, T, H, W) = (1, 3, 64, 224, 224)
      const batchedInput = new Float32Array(1 * 3 * this.VIDEO_BUFFER_SIZE * this.FRAME_SIZE * this.FRAME_SIZE);
      
      for (let t = 0; t < this.VIDEO_BUFFER_SIZE; t++) {
        for (let h = 0; h < this.FRAME_SIZE; h++) {
          for (let w = 0; w < this.FRAME_SIZE; w++) {
            for (let c = 0; c < 3; c++) {
              const srcIdx = t * (this.FRAME_SIZE * this.FRAME_SIZE * 3) + h * this.FRAME_SIZE * 3 + w * 3 + c;
              const dstIdx = c * (this.VIDEO_BUFFER_SIZE * this.FRAME_SIZE * this.FRAME_SIZE) + t * (this.FRAME_SIZE * this.FRAME_SIZE) + h * this.FRAME_SIZE + w;
              batchedInput[dstIdx] = inputData[srcIdx];
            }
          }
        }
      }

      // Create input tensor
      const inputTensor = new this.Tensor('float32', batchedInput, [1, 3, this.VIDEO_BUFFER_SIZE, this.FRAME_SIZE, this.FRAME_SIZE]);
      
      // Run inference
      console.time("[I3D] Inference");
      const outputs = await this.session.run({ input: inputTensor });
      console.timeEnd("[I3D] Inference");

      // Get output and handle both 3D and 2D outputs
      const output = outputs.output;
      let logits = Array.from(output.data);

      // If output is 3D/5D, take mean across spatial dims
      if (output.dims.length > 2) {
        // Average pool if needed
        const numClasses = output.dims[1];
        const spatialSize = output.data.length / numClasses;
        const averaged = new Array(numClasses).fill(0);
        
        for (let i = 0; i < output.data.length; i++) {
          const classIdx = Math.floor(i % numClasses);
          averaged[classIdx] += output.data[i];
        }
        
        for (let i = 0; i < numClasses; i++) {
          averaged[i] /= spatialSize;
        }
        
        logits = averaged;
      }

      // Get top-K predictions
      const predictions = logits
        .map((score, idx) => ({ idx, score }))
        .sort((a, b) => b.score - a.score)
        .slice(0, this.TOPK);

      this.lastPredictions = predictions.map(p => ({
        gloss: this.idToGloss[p.idx] || `Sign_${p.idx}`,
        confidence: p.score.toFixed(3)
      }));

      this.lastInferenceTime = now;
      
      console.log("[I3D] Predictions:", this.lastPredictions);
      return this.lastPredictions;
    } catch (error) {
      console.error("[I3D] Inference error:", error);
      return null;
    }
  }

  /**
   * Get the most recent predictions
   */
  getPredictions() {
    return this.lastPredictions.length > 0 ? this.lastPredictions[0] : null;
  }

  /**
   * Get buffer fill percentage
   */
  getBufferFillPercentage() {
    return Math.round((this.frameBuffer.length / this.VIDEO_BUFFER_SIZE) * 100);
  }

  /**
   * Clear the frame buffer
   */
  clearBuffer() {
    this.frameBuffer = [];
    this.lastPredictions = [];
  }
}

// Export for use in main.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = I3DInference;
}
