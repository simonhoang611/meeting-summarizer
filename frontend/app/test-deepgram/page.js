'use client';

import { useState, useRef } from 'react';

export default function TestDeepgram() {
  const [logs, setLogs] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const wsRef = useRef(null);
  const audioContextRef = useRef(null);
  const processorRef = useRef(null);
  const sourceRef = useRef(null);
  const streamRef = useRef(null);
  const logsRef = useRef([]);

  const addLog = (msg, type = 'info') => {
    const time = new Date().toLocaleTimeString();
    const entry = { time, msg, type };
    logsRef.current = [...logsRef.current, entry];
    setLogs([...logsRef.current]);
  };

  const startTest = async () => {
    logsRef.current = [];
    setLogs([]);
    setIsRunning(true);

    addLog('🔑 Bước 1: Lấy API Key...');
    try {
      const res = await fetch('/api/deepgram-key');
      const data = await res.json();
      if (!data.key) {
        addLog('❌ API Key trống!', 'error');
        return;
      }
      addLog(`✅ API Key OK`, 'success');

      // List all available mics
      addLog('🎤 Bước 2: Kiểm tra tất cả Microphone...');
      const devices = await navigator.mediaDevices.enumerateDevices();
      const mics = devices.filter(d => d.kind === 'audioinput');
      mics.forEach((mic, i) => {
        addLog(`   Mic ${i}: ${mic.label || 'Unknown'} (${mic.deviceId.substring(0, 8)}...)`);
      });

      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ 
          audio: { 
            autoGainControl: true,
            noiseSuppression: false,
            echoCancellation: false,
          } 
        });
        streamRef.current = stream;
        const track = stream.getAudioTracks()[0];
        const settings = track.getSettings();
        addLog(`✅ Đang dùng: ${track.label}`, 'success');
        addLog(`   Settings: sampleRate=${settings.sampleRate}, channelCount=${settings.channelCount}, autoGain=${settings.autoGainControl}`);
      } catch (micErr) {
        addLog(`❌ Mic lỗi: ${micErr.message}`, 'error');
        return;
      }

      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      audioContextRef.current = audioContext;
      const nativeSR = audioContext.sampleRate;
      const targetSR = 16000;
      const ratio = nativeSR / targetSR;

      addLog(`🌐 Bước 3: Kết nối Deepgram (gain=10x)...`);
      const ws = new WebSocket(
        `wss://api.deepgram.com/v1/listen?model=nova-2&language=vi&smart_format=true&encoding=linear16&sample_rate=${targetSR}&channels=1&interim_results=true`,
        ['token', data.key]
      );
      wsRef.current = ws;

      ws.onopen = () => {
        addLog('✅ WebSocket OK!', 'success');

        const source = audioContext.createMediaStreamSource(stream);
        sourceRef.current = source;
        
        const gainNode = audioContext.createGain();
        gainNode.gain.value = 10.0;  // 10x amplification
        
        const processor = audioContext.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;

        let chunkCount = 0;
        let peakRaw = 0;

        processor.onaudioprocess = (e) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const inputData = e.inputBuffer.getChannelData(0);
          
          // Track raw peak level
          for (let i = 0; i < inputData.length; i++) {
            const abs = Math.abs(inputData[i]);
            if (abs > peakRaw) peakRaw = abs;
          }
          
          const outputLength = Math.floor(inputData.length / ratio);
          const pcm16 = new Int16Array(outputLength);
          for (let i = 0; i < outputLength; i++) {
            const s = Math.max(-1, Math.min(1, inputData[Math.floor(i * ratio)]));
            pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }
          ws.send(pcm16.buffer);

          chunkCount++;
          if (chunkCount === 1) addLog(`✅ Ghi âm! NÓI to vào mic...`, 'success');
          if (chunkCount % 30 === 0) {
            let sum = 0;
            for (let i = 0; i < inputData.length; i++) sum += Math.abs(inputData[i]);
            const avgLevel = (sum / inputData.length * 100).toFixed(3);
            addLog(`📦 #${chunkCount} | Avg: ${avgLevel}% | Peak: ${(peakRaw * 100).toFixed(2)}%`);
          }
        };

        source.connect(gainNode);
        gainNode.connect(processor);
        processor.connect(audioContext.destination);
        addLog(`🔊 Gain: 10x | ${nativeSR}Hz→${targetSR}Hz`);
      };

      ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          if (parsed.channel && parsed.channel.alternatives) {
            const transcript = parsed.channel.alternatives[0]?.transcript;
            const isFinal = parsed.is_final;
            if (transcript && transcript.trim()) {
              addLog(`🗣️ [${isFinal ? '✅ FINAL' : '⏳ interim'}] "${transcript}"`, 'success');
            }
          } else if (parsed.type === 'Metadata') {
            addLog(`ℹ️ Deepgram model: ${parsed.model_info?.name || 'n/a'}`, 'success');
          }
        } catch (e) {}
      };

      ws.onerror = () => addLog('❌ WebSocket lỗi!', 'error');
      ws.onclose = (e) => addLog(`🔌 Đóng: code=${e.code}`, e.code === 1000 ? 'info' : 'error');

    } catch (err) {
      addLog(`❌ Lỗi: ${err.message}`, 'error');
    }
  };

  const stopTest = () => {
    if (processorRef.current) processorRef.current.disconnect();
    if (sourceRef.current) sourceRef.current.disconnect();
    if (audioContextRef.current) audioContextRef.current.close();
    if (wsRef.current) wsRef.current.close();
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    setIsRunning(false);
    addLog('⏹️ Đã dừng.');
  };

  return (
    <div style={{ padding: 30, fontFamily: 'monospace', background: '#0a0a0a', color: '#e0e0e0', minHeight: '100vh' }}>
      <h1 style={{ color: '#4fc3f7' }}>🧪 Test Deepgram (Gain 10x + AutoGain)</h1>
      <p>⚠️ Hãy kiểm tra mic volume trong Windows Sound Settings trước khi test!</p>
      
      <div style={{ marginBottom: 20 }}>
        {!isRunning ? (
          <button onClick={startTest} style={{ padding: '10px 24px', fontSize: 16, background: '#4caf50', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
            ▶ Bắt đầu Test
          </button>
        ) : (
          <button onClick={stopTest} style={{ padding: '10px 24px', fontSize: 16, background: '#f44336', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
            ⏹ Dừng Test
          </button>
        )}
      </div>

      <div style={{ background: '#1a1a1a', padding: 16, borderRadius: 8, maxHeight: 500, overflowY: 'auto', border: '1px solid #333' }}>
        {logs.length === 0 && <p style={{ color: '#666' }}>Nhấn "Bắt đầu Test"...</p>}
        {logs.map((log, i) => (
          <div key={i} style={{ 
            padding: '4px 0', 
            color: log.type === 'error' ? '#ef5350' : log.type === 'success' ? '#66bb6a' : '#bbb',
            borderBottom: '1px solid #222'
          }}>
            <span style={{ color: '#666' }}>[{log.time}]</span> {log.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
