'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from "next-auth/react";
import { ChevronLeft, FileText, Calendar, Clock, Video } from 'lucide-react';

export default function HistoryPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/');
      return;
    }
    if (status === 'loading' || !session) return;

    fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:5000'}/api/history?email=${encodeURIComponent(session.user.email)}`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setMeetings(data);
        } else {
          console.error('API did not return an array:', data);
          setMeetings([]);
        }
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to fetch history', err);
        setLoading(false);
      });
  }, [session, status, router]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-color)' }}>
      <header style={{ padding: '24px 48px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '24px' }}>
        <button onClick={() => router.push('/')} className="btn-icon" style={{ backgroundColor: 'var(--surface-color)', borderRadius: '12px' }}>
          <ChevronLeft size={24} />
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ background: 'var(--accent-gradient)', padding: '8px', borderRadius: '12px' }}>
            <FileText size={20} color="white" />
          </div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 600 }}>Meeting History</h1>
        </div>
      </header>

      <main style={{ flex: 1, padding: '48px', maxWidth: '1000px', margin: '0 auto', width: '100%' }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--text-secondary)', marginTop: '40px' }}>Loading history...</div>
        ) : meetings.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-secondary)', marginTop: '60px', padding: '40px', backgroundColor: 'var(--surface-color)', borderRadius: '24px', border: '1px dashed var(--border-color)' }}>
            <div style={{ width: '64px', height: '64px', borderRadius: '50%', backgroundColor: 'var(--bg-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
              <Video size={32} color="var(--text-secondary)" />
            </div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>No meetings yet</h2>
            <p>Your recorded meetings and AI summaries will appear here.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {meetings.map((meeting) => {
              const formattedId = meeting.roomId.replace(/(.{3})(.{4})(.{3})/, '$1-$2-$3');
              return (
                <div key={meeting.id} className="glass-panel" style={{ padding: '24px', border: '1px solid var(--border-color)', borderRadius: '20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
                    <div>
                      <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '8px' }}>{meeting.title} ({formattedId})</h3>
                      <div style={{ display: 'flex', gap: '16px', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Calendar size={16} /> {new Date(meeting.createdAt).toLocaleDateString()}</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Clock size={16} /> {new Date(meeting.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><FileText size={16} /> {meeting._count.transcripts} lines</span>
                      </div>
                    </div>
                    {meeting.summary && (
                      <span style={{ backgroundColor: 'rgba(236, 72, 153, 0.1)', color: '#ec4899', padding: '6px 16px', borderRadius: '20px', fontSize: '0.875rem', fontWeight: 600 }}>
                        AI Summarized
                      </span>
                    )}
                  </div>
                  
                  {meeting.summary ? (
                    <div style={{ backgroundColor: 'var(--surface-color)', padding: '20px', borderRadius: '16px', fontSize: '0.9375rem', lineHeight: 1.6, whiteSpace: 'pre-wrap', color: 'var(--text-primary)', borderLeft: '4px solid var(--accent-color)' }}>
                      {meeting.summary.content}
                    </div>
                  ) : (
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.9375rem', fontStyle: 'italic' }}>
                      No summary available for this meeting.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
