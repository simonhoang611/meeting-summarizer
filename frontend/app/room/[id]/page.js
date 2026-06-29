'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { 
  Mic, MicOff, Video, VideoOff, PhoneMissed, 
  MonitorUp, Users, Bot, FileText, CheckCircle, ChevronLeft, Sparkles
} from 'lucide-react';
import { io } from 'socket.io-client';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:5000';

export default function Room() {
  const params = useParams();
  const rawId = params.id;
  const roomId = rawId.replace(/-/g, '').toLowerCase();
  const router = useRouter();
  
  const [roomStatus, setRoomStatus] = useState('checking'); // 'checking', 'valid', 'invalid'
  const [hasJoined, setHasJoined] = useState(false);
  const [userName, setUserName] = useState('');

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/check-room/${roomId}`)
      .then(res => res.json())
      .then(data => {
        if (data.exists) setRoomStatus('valid');
        else setRoomStatus('invalid');
      })
      .catch(err => {
        console.error('Check room failed', err);
        setRoomStatus('invalid');
      });
  }, [roomId]);
  
  const [isMicOn, setIsMicOn] = useState(true);
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [isParticipantsOpen, setIsParticipantsOpen] = useState(false);
  const [isAiSidebarOpen, setIsAiSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState('transcript');
  
  const [transcriptData, setTranscriptData] = useState([]);
  const [summaryData, setSummaryData] = useState('');
  const [isSummarizing, setIsSummarizing] = useState(false);
  
  // Multi-peer: map of socketId -> { stream, userName }
  const [remotePeers, setRemotePeers] = useState({});
  
  const videoRef = useRef(null);
  const [localStream, setLocalStream] = useState(null);
  
  const socketRef = useRef(null);
  // Map of socketId -> RTCPeerConnection
  const peersRef = useRef({});
  // Map of socketId -> ICE candidate queue
  const pendingCandidatesRef = useRef({});
  const deepgramRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const isDeepgramReadyRef = useRef(false);
  const isMicOnRef = useRef(isMicOn);
  const localStreamRef = useRef(null);
  
  useEffect(() => { isMicOnRef.current = isMicOn; }, [isMicOn]);
  useEffect(() => { localStreamRef.current = localStream; }, [localStream]);

  // Sync theme
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
      document.documentElement.classList.add('light');
    } else {
      document.documentElement.classList.remove('light');
    }
  }, []);

  // Initialize Media
  useEffect(() => {
    let stream;
    async function setupMedia() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        setLocalStream(stream);
        localStreamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error("Error accessing media devices.", err);
      }
    }
    setupMedia();
    return () => {
      if (stream) stream.getTracks().forEach(track => track.stop());
    };
  }, []);

  // Toggle Media Tracks
  useEffect(() => {
    if (localStream) {
      localStream.getVideoTracks().forEach(track => { track.enabled = isVideoOn; });
      localStream.getAudioTracks().forEach(track => { track.enabled = isMicOn; });
      
      if (isMicOn) {
        if (!mediaRecorderRef.current && deepgramRef.current) {
           const mediaRecorder = new MediaRecorder(localStream, { mimeType: 'audio/webm' });
           mediaRecorder.ondataavailable = (e) => {
             if (e.data.size > 0 && isDeepgramReadyRef.current && deepgramRef.current) {
               try { deepgramRef.current.send(e.data); } catch(err) {}
             }
           };
           mediaRecorder.start(250);
           mediaRecorderRef.current = mediaRecorder;
        } else if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'inactive') {
           mediaRecorderRef.current.start(250);
        }
      } else {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.stop();
        }
      }
    }
  }, [isVideoOn, isMicOn, localStream, userName]);

  // Re-assign srcObject when switching from lobby to call
  useEffect(() => {
    if (hasJoined && videoRef.current && localStream) {
      videoRef.current.srcObject = localStream;
    }
  }, [hasJoined, localStream]);

  const handleJoin = (e) => {
    e.preventDefault();
    if (userName.trim()) {
      setHasJoined(true);
      connectToRoom();
    }
  };

  const createPeer = (targetSocketId) => {
    const peer = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ]
    });

    peer.onicecandidate = (e) => {
      if (e.candidate && socketRef.current) {
        socketRef.current.emit('ice-candidate', { target: targetSocketId, candidate: e.candidate });
      }
    };

    peer.ontrack = (e) => {
      setRemotePeers(prev => ({
        ...prev,
        [targetSocketId]: { ...prev[targetSocketId], stream: e.streams[0] }
      }));
    };

    const stream = localStreamRef.current;
    if (stream) {
      stream.getTracks().forEach(track => peer.addTrack(track, stream));
    }
    
    peersRef.current[targetSocketId] = peer;
    if (!pendingCandidatesRef.current[targetSocketId]) {
      pendingCandidatesRef.current[targetSocketId] = [];
    }
    
    return peer;
  };

  const flushCandidates = async (targetSocketId) => {
    const peer = peersRef.current[targetSocketId];
    const candidates = pendingCandidatesRef.current[targetSocketId] || [];
    for (const candidate of candidates) {
      try { await peer.addIceCandidate(new RTCIceCandidate(candidate)); } catch(e) { console.error(e); }
    }
    pendingCandidatesRef.current[targetSocketId] = [];
  };

  const connectToRoom = () => {
    socketRef.current = io(BACKEND_URL);
    
    socketRef.current.emit('join-room', roomId, userName);

    socketRef.current.on('transcript-update', (data) => {
      setTranscriptData(data);
    });

    socketRef.current.on('new-transcript-line', (newLine) => {
      setTranscriptData(prev => [...prev, newLine]);
    });

    // A new user joined - I create an offer for them
    socketRef.current.on('user-connected', async ({ id, userName: newUserName }) => {
      console.log(`${newUserName} connected, creating offer...`);
      setRemotePeers(prev => ({ ...prev, [id]: { userName: newUserName, stream: null } }));
      
      const peer = createPeer(id);
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      socketRef.current.emit('offer', { target: id, caller: socketRef.current.id, callerName: userName, sdp: offer });
    });

    // I received an offer from someone - create answer
    socketRef.current.on('offer', async (payload) => {
      console.log(`Received offer from ${payload.caller}`);
      setRemotePeers(prev => ({ ...prev, [payload.caller]: { userName: payload.callerName || 'Partner', stream: null } }));
      
      const peer = createPeer(payload.caller);
      await peer.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      socketRef.current.emit('answer', { target: payload.caller, caller: socketRef.current.id, sdp: answer });
      
      await flushCandidates(payload.caller);
    });

    // I received an answer to my offer
    socketRef.current.on('answer', async (payload) => {
      const peer = peersRef.current[payload.caller];
      if (peer) {
        await peer.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        await flushCandidates(payload.caller);
      }
    });

    // ICE candidate from a specific peer
    socketRef.current.on('ice-candidate', async (incoming) => {
      // incoming = { candidate, from }
      const fromId = incoming.from;
      const peer = peersRef.current[fromId];
      if (peer && peer.remoteDescription) {
        try {
          await peer.addIceCandidate(new RTCIceCandidate(incoming.candidate));
        } catch (e) {
          if (!pendingCandidatesRef.current[fromId]) pendingCandidatesRef.current[fromId] = [];
          pendingCandidatesRef.current[fromId].push(incoming.candidate);
        }
      } else {
        if (!pendingCandidatesRef.current[fromId]) pendingCandidatesRef.current[fromId] = [];
        pendingCandidatesRef.current[fromId].push(incoming.candidate);
      }
    });

    // Someone disconnected
    socketRef.current.on('user-disconnected', (id) => {
      if (peersRef.current[id]) {
        peersRef.current[id].close();
        delete peersRef.current[id];
      }
      delete pendingCandidatesRef.current[id];
      setRemotePeers(prev => {
        const updated = { ...prev };
        delete updated[id];
        return updated;
      });
    });

    const setupDeepgram = async () => {
      if (deepgramRef.current) return;
      
      try {
        const res = await fetch('/api/deepgram-key');
        const data = await res.json();
        const apiKey = data.key;
        
        const ws = new WebSocket(
          'wss://api.deepgram.com/v1/listen?model=nova-2&language=vi&smart_format=true',
          ['token', apiKey]
        );

        ws.onopen = () => {
          console.log('Deepgram connected');
          isDeepgramReadyRef.current = true;
        };
        
        ws.onclose = () => {
          isDeepgramReadyRef.current = false;
        };

        ws.onmessage = (event) => {
          try {
            const parsed = JSON.parse(event.data);
            if (parsed.channel && parsed.channel.alternatives && parsed.channel.alternatives.length > 0) {
              const transcript = parsed.channel.alternatives[0].transcript;
              if (transcript && transcript.trim() && socketRef.current && parsed.is_final) {
                socketRef.current.emit('new-transcript', {
                  sender: userName,
                  text: transcript.trim()
                });
              }
            }
          } catch(e) {}
        };

        ws.onerror = (err) => {
          console.error('Deepgram error:', err);
        };

        deepgramRef.current = ws;
      } catch (err) {
        console.error('Failed to setup Deepgram', err);
      }
    };
    setupDeepgram();
  };


  const generateSummary = async () => {
    if (transcriptData.length === 0) return;
    
    setIsSummarizing(true);
    setActiveTab('summary');
    setSummaryData('Đang phân tích nội dung cuộc họp bằng AI...');
    
    try {
      const res = await fetch(`${BACKEND_URL}/api/summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId })
      });
      const data = await res.json();
      if (data.summary) {
        setSummaryData(data.summary);
      } else {
        setSummaryData(data.error || 'Lỗi khi tạo tóm tắt.');
      }
    } catch (err) {
      setSummaryData('Không thể kết nối đến AI Server.');
    } finally {
      setIsSummarizing(false);
    }
  };

  const handleEndCall = () => {
    if (localStream) localStream.getTracks().forEach(track => track.stop());
    if (socketRef.current) socketRef.current.disconnect();
    Object.values(peersRef.current).forEach(peer => peer.close());
    peersRef.current = {};
    if (recognitionRef.current) recognitionRef.current.stop();
    router.push('/');
  };

  const remoteEntries = Object.entries(remotePeers);
  const totalParticipants = remoteEntries.length + 1; // +1 for self

  const MAX_VISIBLE_TILES = 6;
  const isOverflow = totalParticipants > MAX_VISIBLE_TILES;
  const visibleRemoteCount = isOverflow ? MAX_VISIBLE_TILES - 2 : remoteEntries.length;
  
  const visibleRemoteEntries = remoteEntries.slice(0, visibleRemoteCount);
  const hiddenRemoteEntries = remoteEntries.slice(visibleRemoteCount);
  const renderedTilesCount = isOverflow ? MAX_VISIBLE_TILES : totalParticipants;

  // CSS Container queries in globals.css handle the grid layout now.

  // ==========================================
  // STATE 0: CHECKING / ERROR
  // ==========================================
  if (roomStatus === 'checking') {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-color)' }}>
        <div className="text-gradient" style={{ fontSize: '1.5rem', fontWeight: 600 }}>Checking room...</div>
      </div>
    );
  }

  if (roomStatus === 'invalid') {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-color)', padding: '20px', textAlign: 'center' }}>
        <div style={{ width: '80px', height: '80px', borderRadius: '50%', backgroundColor: 'rgba(239, 68, 68, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '24px' }}>
          <PhoneMissed size={40} color="var(--danger-color)" />
        </div>
        <h2 style={{ fontSize: '2.5rem', fontWeight: 700, marginBottom: '16px' }}>Meeting not found</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '1.125rem', marginBottom: '32px', maxWidth: '400px' }}>
          The meeting code you entered doesn't exist. Please check the code and try again.
        </p>
        <button className="btn-primary" onClick={() => router.push('/')} style={{ padding: '12px 32px', fontSize: '1.125rem' }}>
          Go back home
        </button>
      </div>
    );
  }

  // ==========================================
  // STATE 1: PRE-JOIN LOBBY
  // ==========================================
  if (!hasJoined) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <header style={{ padding: '24px 48px', display: 'flex', justifyContent: 'space-between' }}>
          <button onClick={() => router.push('/')} style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)', fontWeight: 500 }}>
            <ChevronLeft size={20} /> Back to home
          </button>
        </header>
        
        <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 48px' }}>
          <div className="fade-in" style={{ display: 'flex', gap: '64px', maxWidth: '1100px', width: '100%', alignItems: 'center', flexWrap: 'wrap' }}>
            
            <div style={{ flex: 3, minWidth: '300px' }}>
              <div className="video-container" style={{ position: 'relative', width: '100%', aspectRatio: '16/9' }}>
                <video ref={videoRef} autoPlay playsInline muted style={{ transform: 'scaleX(-1)', display: isVideoOn ? 'block' : 'none' }} />
                {!isVideoOn && (
                  <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--surface-color)' }}>
                    <div style={{ width: '80px', height: '80px', borderRadius: '50%', backgroundColor: 'var(--surface-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <VideoOff size={32} color="var(--text-secondary)" />
                    </div>
                  </div>
                )}
                
                <div style={{ position: 'absolute', bottom: '24px', left: '0', right: '0', display: 'flex', justifyContent: 'center', gap: '16px' }}>
                  <button 
                    className={`btn-icon ${!isMicOn ? 'danger' : ''}`} 
                    onClick={() => setIsMicOn(!isMicOn)}
                    style={{ backgroundColor: !isMicOn ? 'var(--danger-color)' : 'var(--surface-color)', backdropFilter: 'blur(10px)' }}
                  >
                    {isMicOn ? <Mic size={20} color="var(--text-primary)" /> : <MicOff size={20} color="white" />}
                  </button>
                  <button 
                    className={`btn-icon ${!isVideoOn ? 'danger' : ''}`} 
                    onClick={() => setIsVideoOn(!isVideoOn)}
                    style={{ backgroundColor: !isVideoOn ? 'var(--danger-color)' : 'var(--surface-color)', backdropFilter: 'blur(10px)' }}
                  >
                    {isVideoOn ? <Video size={20} color="var(--text-primary)" /> : <VideoOff size={20} color="white" />}
                  </button>
                </div>
              </div>
            </div>

          <div style={{ flex: 2, minWidth: '300px', display: 'flex', flexDirection: 'column' }}>
              <h2 style={{ fontSize: '2.5rem', fontWeight: 600, marginBottom: '8px', lineHeight: 1.2 }}>Ready to join?</h2>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '32px' }}>
                Meeting ID: <span style={{ color: 'var(--text-primary)', fontWeight: 600, fontFamily: 'monospace' }}>{roomId}</span>
              </p>

              <form onSubmit={handleJoin} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <input 
                  type="text" 
                  placeholder="Enter your name" 
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  className="premium-input"
                  autoFocus
                />
                <button type="submit" className="btn-primary" disabled={!userName.trim()} suppressHydrationWarning style={{ width: '100%', padding: '16px', fontSize: '1.125rem' }}>
                  Ask to join
                </button>
              </form>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ==========================================
  // STATE 2: IN-CALL ROOM
  // ==========================================
  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: 'var(--bg-color)' }}>
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', padding: '16px', gap: '16px', paddingBottom: '0' }}>
        
        {/* Video Grid Wrapper */}
        <div className="grid-wrapper" style={{ flex: 1, minHeight: 0, minWidth: 0 }}>
          <div className="meet-grid" data-count={renderedTilesCount}>
          
          {/* Remote Peers */}
          {visibleRemoteEntries.map(([peerId, peerData]) => (
            <RemoteVideo key={peerId} peerData={peerData} />
          ))}

          {/* Others Tile */}
          {isOverflow && (
            <OthersTile hiddenPeers={hiddenRemoteEntries} />
          )}

          {/* No redundant waiting tile needed - Self Video naturally fills the 1x1 grid */}

          {/* Self Video */}
          <div className="video-wrapper">
            <div className="video-container" style={{ position: 'relative' }}>
              <video ref={videoRef} autoPlay playsInline muted style={{ transform: 'scaleX(-1)', display: isVideoOn ? 'block' : 'none' }} />
            {!isVideoOn && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--surface-color)' }}>
                <div style={{ width: '64px', height: '64px', borderRadius: '50%', backgroundColor: 'var(--surface-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: '1.5rem', fontWeight: 600 }}>{userName.charAt(0).toUpperCase()}</span>
                </div>
              </div>
            )}
            <div className="video-overlay" style={{ zIndex: 20 }}>{userName} (You) {!isMicOn && <MicOff size={14} color="var(--danger-color)" style={{marginLeft: '4px'}} />}</div>
          </div>
          </div>
        </div>
      </div>

        {/* Sidebar Area - Participants & AI panels stack here */}
        {(isAiSidebarOpen || isParticipantsOpen) && (
          <div className="slide-in-right" style={{ width: '380px', display: 'flex', flexDirection: 'column', height: '100%', gap: '16px' }}>

            {/* Participants Panel */}
            {isParticipantsOpen && (
              <div className="glass-panel" style={{ flex: isAiSidebarOpen ? 1 : 1, display: 'flex', flexDirection: 'column', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', minHeight: 0 }}>
                <div style={{ padding: '20px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ background: 'linear-gradient(135deg, #1273e6, #0f9d58)', padding: '8px', borderRadius: '12px' }}>
                      <Users size={20} color="white" />
                    </div>
                    <h2 style={{ fontSize: '1.125rem', fontWeight: 600 }}>Participants</h2>
                  </div>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', fontWeight: 600, backgroundColor: 'var(--surface-color)', padding: '4px 12px', borderRadius: '20px' }}>
                    {Object.keys(remotePeers).length + 1}
                  </span>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px' }}>
                  {/* Self */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 0', borderBottom: '1px solid var(--border-color)' }}>
                    <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'var(--accent-gradient)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: 'white', fontSize: '0.875rem', flexShrink: 0 }}>
                      {userName.charAt(0).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.9375rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{userName} (You)</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Host</div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                      {isMicOn ? <Mic size={16} color="var(--text-secondary)" /> : <MicOff size={16} color="var(--danger-color)" />}
                      {isVideoOn ? <Video size={16} color="var(--text-secondary)" /> : <VideoOff size={16} color="var(--danger-color)" />}
                    </div>
                  </div>
                  {/* Remote Peers */}
                  {Object.entries(remotePeers).map(([peerId, peerData]) => (
                    <div key={peerId} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 0', borderBottom: '1px solid var(--border-color)' }}>
                      <div style={{ width: '36px', height: '36px', borderRadius: '50%', backgroundColor: 'var(--surface-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.875rem', flexShrink: 0 }}>
                        {(peerData.userName || 'P').charAt(0).toUpperCase()}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: '0.9375rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{peerData.userName || 'Partner'}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Participant</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* AI Assistant Panel */}
            {isAiSidebarOpen && (
              <div className="glass-panel" style={{ flex: isParticipantsOpen ? 1 : 1, display: 'flex', flexDirection: 'column', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', minHeight: 0 }}>
                <div style={{ padding: '20px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '12px', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ background: 'var(--accent-gradient)', padding: '8px', borderRadius: '12px' }}>
                      <Bot size={20} color="white" />
                    </div>
                    <h2 style={{ fontSize: '1.125rem', fontWeight: 600 }}>MeetSum AI</h2>
                  </div>
                  <button onClick={generateSummary} disabled={isSummarizing || transcriptData.length === 0} className="btn-primary" style={{ padding: '8px 16px', fontSize: '0.875rem' }}>
                     <Sparkles size={14} /> Tóm tắt
                  </button>
                </div>

                <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)' }}>
                  <button onClick={() => setActiveTab('transcript')} style={{ flex: 1, padding: '16px', fontWeight: 500, color: activeTab === 'transcript' ? 'var(--text-primary)' : 'var(--text-secondary)', borderBottom: activeTab === 'transcript' ? '2px solid var(--accent-color)' : '2px solid transparent' }}>
                    Transcript
                  </button>
                  <button onClick={() => setActiveTab('summary')} style={{ flex: 1, padding: '16px', fontWeight: 500, color: activeTab === 'summary' ? 'var(--text-primary)' : 'var(--text-secondary)', borderBottom: activeTab === 'summary' ? '2px solid var(--accent-color)' : '2px solid transparent' }}>
                    AI Summary
                  </button>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
                  
                  {activeTab === 'transcript' && (
                    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                      {transcriptData.length === 0 ? (
                        <div style={{ textAlign: 'center', color: 'var(--text-secondary)', marginTop: '40px' }}>
                           Chưa có hội thoại nào. Hãy bật mic và nói gì đó!
                        </div>
                      ) : (
                        transcriptData.map((msg, i) => {
                          const isMe = msg.sender === userName;
                          return (
                            <div key={i} style={{ display: 'flex', gap: '12px', flexDirection: isMe ? 'row-reverse' : 'row' }}>
                              <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: isMe ? 'var(--accent-color)' : 'var(--surface-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600 }}>
                                {msg.sender.charAt(0).toUpperCase()}
                              </div>
                              <div style={{ alignItems: isMe ? 'flex-end' : 'flex-start', display: 'flex', flexDirection: 'column' }}>
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '4px' }}>
                                  <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>{isMe ? 'You' : msg.sender}</span>
                                </div>
                                <div style={{ background: isMe ? 'var(--accent-gradient)' : 'var(--surface-color)', padding: '12px 16px', borderRadius: isMe ? '12px 0 12px 12px' : '0 12px 12px 12px', fontSize: '0.875rem', color: isMe ? 'white' : 'var(--text-primary)' }}>
                                  {msg.text}
                                </div>
                              </div>
                            </div>
                          )
                        })
                      )}
                    </div>
                  )}

                  {activeTab === 'summary' && (
                    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                      {!summaryData ? (
                        <div style={{ textAlign: 'center', color: 'var(--text-secondary)', marginTop: '40px' }}>
                           Chưa có tóm tắt. Bấm nút "Tóm tắt" ở trên để AI tạo bản ghi.
                        </div>
                      ) : (
                        <div style={{ backgroundColor: 'var(--surface-color)', padding: '16px', borderRadius: '12px', fontSize: '0.875rem', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                          {summaryData}
                        </div>
                      )}
                    </div>
                  )}

                </div>
              </div>
            )}

          </div>
        )}
      </div>

      {/* Bottom Control Bar */}
      <div style={{ padding: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div suppressHydrationWarning style={{ width: '240px', fontWeight: 500, fontSize: '0.9375rem', color: 'var(--text-secondary)', letterSpacing: '0.02em' }}>
          {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} <span style={{ opacity: 0.4, margin: '0 6px' }}>|</span> {roomId.replace(/(.{3})(.{4})(.{3})/, '$1-$2-$3')}
        </div>

        <div style={{ display: 'flex', gap: '16px' }}>
          <button className={`btn-icon ${!isMicOn ? 'danger' : ''}`} onClick={() => setIsMicOn(!isMicOn)}>
            {isMicOn ? <Mic size={20} /> : <MicOff size={20} />}
          </button>
          <button className={`btn-icon ${!isVideoOn ? 'danger' : ''}`} onClick={() => setIsVideoOn(!isVideoOn)}>
            {isVideoOn ? <Video size={20} /> : <VideoOff size={20} />}
          </button>
          <button className="btn-icon">
            <MonitorUp size={20} />
          </button>
          <button className="btn-icon danger" onClick={handleEndCall} style={{ width: '72px', borderRadius: '36px' }}>
            <PhoneMissed size={20} />
          </button>
        </div>

        <div style={{ width: '200px', display: 'flex', justifyContent: 'flex-end', gap: '16px' }}>
          <button className={`btn-icon ${isParticipantsOpen ? 'active' : ''}`} style={{ backgroundColor: isParticipantsOpen ? 'var(--text-primary)' : 'transparent', border: 'none' }} onClick={() => setIsParticipantsOpen(!isParticipantsOpen)}>
            <Users size={20} />
          </button>
          <button className={`btn-icon ${isAiSidebarOpen ? 'active' : ''}`} style={{ backgroundColor: isAiSidebarOpen ? 'var(--text-primary)' : 'transparent', border: 'none' }} onClick={() => setIsAiSidebarOpen(!isAiSidebarOpen)}>
            <Bot size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}

// Separate component for remote video to handle ref properly
function RemoteVideo({ peerData }) {
  const videoElRef = useRef(null);

  useEffect(() => {
    if (videoElRef.current && peerData.stream) {
      videoElRef.current.srcObject = peerData.stream;
    }
  }, [peerData.stream]);

  return (
    <div className="video-wrapper">
      <div className="video-container" style={{ position: 'relative' }}>
        <video ref={videoElRef} autoPlay playsInline />
      {!peerData.stream && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--surface-color)', flexDirection: 'column', gap: '12px' }}>
          <Users size={36} color="var(--text-secondary)" opacity={0.5} />
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Connecting...</span>
        </div>
      )}
      <div className="video-overlay" style={{ zIndex: 20 }}>{peerData.userName || 'Partner'}</div>
      </div>
    </div>
  );
}

function OthersTile({ hiddenPeers }) {
  const count = hiddenPeers.length;
  const avatars = hiddenPeers.slice(0, 2).map(([id, data]) => data.userName?.charAt(0)?.toUpperCase() || 'P');
  const meetColors = ['#e8710a', '#1273e6', '#0f9d58', '#f4b400'];

  return (
    <div className="video-wrapper">
      <div className="video-container" style={{ position: 'relative', backgroundColor: 'var(--surface-color)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          {avatars.map((initial, idx) => (
            <div key={idx} style={{ 
              width: '72px', 
              height: '72px', 
              borderRadius: '50%', 
              backgroundColor: meetColors[idx % meetColors.length], 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center', 
              fontSize: '1.75rem', 
              fontWeight: 500,
              color: '#fff',
              border: '4px solid var(--surface-color)',
              marginLeft: idx > 0 ? '-28px' : '0',
              zIndex: 10 - idx
            }}>
              {initial}
            </div>
          ))}
        </div>
          <span style={{ color: 'var(--text-primary)', fontWeight: 500, fontSize: '1.125rem' }}>{count} others</span>
        </div>
      </div>
    </div>
  );
}
