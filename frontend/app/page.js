'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession, signIn, signOut } from "next-auth/react";
import { Video, Keyboard, Plus, Sparkles, Sun, Moon, Settings, FileText, LogIn, LogOut } from 'lucide-react';

export default function Home() {
  const router = useRouter();
  const { data: session } = useSession();
  const [meetingCode, setMeetingCode] = useState('');
  const [theme, setTheme] = useState('dark');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('theme');
    if (saved === 'light') {
      setTheme('light');
      document.documentElement.classList.add('light');
    }
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return; // Prevent overwriting on initial render
    if (theme === 'light') {
      document.documentElement.classList.add('light');
      localStorage.setItem('theme', 'light');
    } else {
      document.documentElement.classList.remove('light');
      localStorage.setItem('theme', 'dark');
    }
  }, [theme, mounted]);

  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark');

  const generateMeetingId = () => {
    // Generate a random string format: xxx-xxxx-xxx
    const randomStr = () => Math.random().toString(36).substring(2, 5);
    return `${randomStr()}-${randomStr()}x-${randomStr()}`;
  };

  const handleNewMeeting = async () => {
    const newId = generateMeetingId();
    const normalizedId = newId.replace(/-/g, '');
    try {
      const payload = { roomId: normalizedId };
      if (session?.user) {
        payload.hostEmail = session.user.email;
        payload.hostName = session.user.name;
        payload.hostImage = session.user.image;
      }
      
      await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:5000'}/api/create-room`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      console.error('Failed to register room on server', e);
    }
    router.push(`/room/${newId}`);
  };

  const handleJoinMeeting = (e) => {
    e.preventDefault();
    if (meetingCode.trim()) {
      // Remove all spaces and hyphens to standardize the ID
      const code = meetingCode.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
      if (code) {
        // We push the cleaned code to the URL
        router.push(`/room/${code}`);
      }
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <header style={{ padding: '24px 48px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'var(--accent-gradient)', display: 'flex', justifyContent: 'center', alignItems: 'center', boxShadow: 'var(--glow)' }}>
            <Video size={20} color="white" />
          </div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.02em' }}>MeetSum</h1>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
          <div suppressHydrationWarning style={{ color: 'var(--text-secondary)', fontWeight: 500, fontSize: '1rem' }}>
            {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {new Date().toLocaleDateString()}
          </div>
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
            {session ? (
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{session.user.name}</span>
                {session.user.image && <img src={session.user.image} alt="Avatar" style={{ width: '32px', height: '32px', borderRadius: '50%' }} />}
                <button onClick={() => signOut()} className="btn-icon">
                  <LogOut size={20} />
                </button>
              </div>
            ) : (
              <button onClick={() => signIn('google')} className="btn-primary" style={{ padding: '8px 16px', borderRadius: '8px', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <LogIn size={18} /> Sign In
              </button>
            )}
            
            <button 
              className="btn-icon"
              onClick={toggleTheme}
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
            </button>
            <button style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 500 }}>
              <Settings size={20} /> Settings
            </button>
          </div>
      </header>

      {/* Main Content */}
      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 48px' }}>
        <div className="fade-in" style={{ display: 'flex', alignItems: 'center', gap: '80px', maxWidth: '1200px', width: '100%' }}>
          
          {/* Left: Copy & Actions */}
          <div style={{ flex: 1, maxWidth: '600px' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '6px 12px', borderRadius: '20px', backgroundColor: 'rgba(236, 72, 153, 0.1)', color: '#ec4899', border: '1px solid rgba(236, 72, 153, 0.2)', marginBottom: '24px', fontSize: '0.875rem', fontWeight: 600 }}>
              <Sparkles size={14} /> AI-Powered Meetings
            </div>
            
            <h2 style={{ fontSize: '3.5rem', fontWeight: 700, lineHeight: 1.1, marginBottom: '24px', letterSpacing: '-0.03em' }}>
              Premium Video Calls. <br />
              <span className="text-gradient">Summarized Instantly.</span>
            </h2>
            
            <p style={{ color: 'var(--text-secondary)', fontSize: '1.125rem', marginBottom: '48px', lineHeight: 1.6, maxWidth: '500px' }}>
              Connect, collaborate, and never miss a detail. MeetSum provides real-time translation and intelligent summaries so you can focus on the conversation.
            </p>

            <div style={{ display: 'flex', alignItems: 'center', gap: '24px', flexWrap: 'wrap' }}>
              <button className="btn-primary" onClick={handleNewMeeting} style={{ fontSize: '1.125rem', padding: '16px 32px' }}>
                <Plus size={24} />
                New Meeting
              </button>
              
              <form onSubmit={handleJoinMeeting} style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: '280px' }}>
                <div style={{ position: 'relative', width: '100%' }}>
                  <div style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }}>
                    <Keyboard size={20} />
                  </div>
                  <input 
                    type="text" 
                    placeholder="Enter a code or link" 
                    value={meetingCode}
                    onChange={(e) => setMeetingCode(e.target.value)}
                    className="premium-input"
                    style={{ paddingLeft: '48px' }}
                  />
                </div>
                <button 
                  type="submit" 
                  disabled={!meetingCode.trim()}
                  style={{ 
                    color: meetingCode.trim() ? 'var(--accent-color)' : 'var(--text-secondary)', 
                    fontWeight: 600, fontSize: '1rem', padding: '0 12px',
                    opacity: meetingCode.trim() ? 1 : 0.5
                  }}
                >
                  Join
                </button>
              </form>
            </div>
            <div style={{ marginTop: '32px', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              <a href="#" style={{ textDecoration: 'underline' }}>Learn more</a> about our AI capabilities.
            </div>
          </div>

          {/* Right: Visual Illustration */}
          <div className="hero-illustration">
            <div className="glass-panel" style={{ width: '100%', aspectRatio: '4/3', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
              {/* Abstract shapes inside the glass panel */}
              <div style={{ position: 'absolute', width: '300px', height: '300px', borderRadius: '50%', background: 'var(--accent-color)', filter: 'blur(80px)', opacity: 0.4, top: '-50px', right: '-50px' }}></div>
              <div style={{ position: 'absolute', width: '200px', height: '200px', borderRadius: '50%', background: '#ec4899', filter: 'blur(60px)', opacity: 0.3, bottom: '20px', left: '20px' }}></div>
              
              <div style={{ zIndex: 1, textAlign: 'center' }}>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', marginBottom: '24px' }}>
                  <div style={{ width: '120px', height: '120px', borderRadius: '24px', overflow: 'hidden', border: '2px solid rgba(255,255,255,0.1)' }}>
                    <img src="https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&q=80&w=300" style={{width:'100%', height:'100%', objectFit:'cover'}} alt="Preview" />
                  </div>
                  <div style={{ width: '120px', height: '120px', borderRadius: '24px', overflow: 'hidden', border: '2px solid rgba(255,255,255,0.1)' }}>
                    <img src="https://images.unsplash.com/photo-1560250097-0b93528c311a?auto=format&fit=crop&q=80&w=300" style={{width:'100%', height:'100%', objectFit:'cover'}} alt="Preview" />
                  </div>
                </div>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', backgroundColor: 'var(--surface-color)', padding: '12px 24px', borderRadius: '100px', border: '1px solid var(--border-color)', backdropFilter: 'blur(10px)', color: 'var(--text-primary)' }}>
                  <Sparkles size={16} color="var(--accent-color)" />
                  <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>Live Transcribing...</span>
                </div>
              </div>
            </div>
            
            {session && (
              <div style={{ marginTop: '32px', textAlign: 'center' }}>
                <button 
                  onClick={() => router.push('/history')}
                  className="btn-secondary" 
                  style={{ padding: '12px 24px', backgroundColor: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border-color)', borderRadius: '12px', fontSize: '0.9375rem', display: 'inline-flex', alignItems: 'center', gap: '8px' }}
                >
                  <FileText size={18} />
                  View Meeting History
                </button>
              </div>
            )}
          </div>

        </div>
      </main>
    </div>
  );
}
