require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Store transcripts per room in memory
const roomTranscripts = {};

// Track valid rooms that have been created
const validRooms = new Set();

// API to create a room
app.post('/api/create-room', async (req, res) => {
  const { roomId, hostEmail, hostName, hostImage } = req.body;
  if (!roomId) return res.status(400).json({ error: 'Missing roomId' });
  validRooms.add(roomId);
  
  try {
    if (hostEmail) {
      await prisma.user.upsert({
        where: { email: hostEmail },
        update: { name: hostName, image: hostImage },
        create: { email: hostEmail, name: hostName, image: hostImage }
      });
    }

    await prisma.meeting.upsert({
      where: { roomId },
      update: { hostEmail: hostEmail || null },
      create: { roomId, hostEmail: hostEmail || null }
    });
  } catch (err) {
    console.error('Prisma Create Room Error:', err);
  }
  
  res.json({ success: true });
});

// API to check if a room exists
app.get('/api/check-room/:id', (req, res) => {
  const roomId = req.params.id;
  if (validRooms.has(roomId)) {
    res.json({ exists: true });
  } else {
    res.json({ exists: false });
  }
});

// API to generate summary
app.post('/api/summary', async (req, res) => {
  try {
    const { roomId } = req.body;
    
    // First check if DB already has summary
    const meeting = await prisma.meeting.findUnique({ 
      where: { roomId },
      include: { summary: true }
    });

    if (meeting && meeting.summary) {
      return res.json({ summary: meeting.summary.content });
    }

    let transcript = roomTranscripts[roomId] || [];
    
    if (transcript.length === 0 && meeting) {
      // Load from DB
      const dbTranscripts = await prisma.transcript.findMany({
        where: { meetingId: meeting.id },
        orderBy: { timestamp: 'asc' }
      });
      transcript = dbTranscripts;
    }
    
    if (!transcript || transcript.length === 0) {
      return res.status(400).json({ error: 'Chưa có nội dung cuộc họp để tóm tắt.' });
    }

    // Format transcript for the prompt
    const conversation = transcript.map(t => `${t.sender}: ${t.text}`).join('\n');
    
    const prompt = `Bạn là một trợ lý ảo thông minh cho các cuộc họp. Hãy đọc đoạn hội thoại sau và tóm tắt lại nội dung cuộc họp. 
Hãy viết bằng Tiếng Việt. Phân chia rõ ràng thành 2 phần:
1. Tóm tắt nội dung chính (Summary)
2. Các công việc cần làm (Action Items)

Đoạn hội thoại:
${conversation}`;

    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    const result = await model.generateContent(prompt);
    const aiText = result.response.text();
    
    if (meeting) {
      await prisma.summary.create({
        data: {
          meetingId: meeting.id,
          content: aiText
        }
      });
    }

    res.json({ summary: aiText });
  } catch (error) {
    console.error('Gemini Error:', error);
    res.status(500).json({ error: 'Failed to generate summary' });
  }
});

// API to get meeting history
app.get('/api/history', async (req, res) => {
  try {
    const email = req.query.email;
    if (!email) return res.status(400).json({ error: 'Missing email' });

    const meetings = await prisma.meeting.findMany({
      where: { hostEmail: email },
      orderBy: { createdAt: 'desc' },
      include: {
        summary: true,
        _count: {
          select: { transcripts: true }
        }
      }
    });
    res.json(meetings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

async function autoGenerateSummary(roomId) {
  try {
    const meeting = await prisma.meeting.findUnique({ where: { roomId } });
    if (!meeting) return;
    
    // Check if summary already exists
    const existingSummary = await prisma.summary.findUnique({ where: { meetingId: meeting.id } });
    if (existingSummary) return;

    const transcripts = await prisma.transcript.findMany({
      where: { meetingId: meeting.id },
      orderBy: { timestamp: 'asc' }
    });
    
    if (transcripts.length === 0) return;

    const conversation = transcripts.map(t => `${t.sender}: ${t.text}`).join('\n');
    
    const prompt = `Bạn là một trợ lý ảo thông minh cho các cuộc họp. Hãy đọc đoạn hội thoại sau và tóm tắt lại nội dung cuộc họp. 
Hãy viết bằng Tiếng Việt. Phân chia rõ ràng thành 2 phần:
1. Tóm tắt nội dung chính (Summary)
2. Các công việc cần làm (Action Items)

Đoạn hội thoại:
${conversation}`;

    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    const result = await model.generateContent(prompt);
    const aiText = result.response.text();
    
    await prisma.summary.create({
      data: {
        meetingId: meeting.id,
        content: aiText
      }
    });
    
    // Mark meeting as ended
    await prisma.meeting.update({
      where: { id: meeting.id },
      data: { endedAt: new Date() }
    });

    console.log(`Auto summary generated for room ${roomId}`);
  } catch (err) {
    console.error(`Auto summary failed for ${roomId}`, err);
  }
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-room', async (roomId, userName) => {
    socket.join(roomId);
    console.log(`${userName} (${socket.id}) joined room ${roomId}`);
    
    // Broadcast to others that this user joined
    socket.to(roomId).emit('user-connected', { id: socket.id, userName });

    // Load transcript from DB if memory is empty
    if (!roomTranscripts[roomId]) {
      try {
        const meeting = await prisma.meeting.findUnique({
          where: { roomId },
          include: { transcripts: { orderBy: { timestamp: 'asc' } } }
        });
        if (meeting && meeting.transcripts.length > 0) {
          roomTranscripts[roomId] = meeting.transcripts.map(t => ({
            sender: t.sender,
            text: t.text,
            timestamp: t.timestamp
          }));
        } else {
          roomTranscripts[roomId] = [];
        }
      } catch (e) {
        console.error('DB load transcript error:', e);
        roomTranscripts[roomId] = [];
      }
    }

    // Send initial transcript to the newly joined user
    socket.emit('transcript-update', roomTranscripts[roomId]);

    socket.on('disconnect', () => {
      console.log(`${userName} (${socket.id}) left room ${roomId}`);
      socket.to(roomId).emit('user-disconnected', socket.id);
      
      // Cleanup transcript if room is empty
      const room = io.sockets.adapter.rooms.get(roomId);
      if (!room || room.size === 0) {
        console.log(`Room ${roomId} is empty. Auto-generating summary and cleaning up.`);
        autoGenerateSummary(roomId);
        delete roomTranscripts[roomId];
      }
    });

    // Handle new transcript lines
    socket.on('new-transcript', async (data) => {
      const { sender, text } = data;
      if (!roomTranscripts[roomId]) {
        roomTranscripts[roomId] = [];
      }
      const timestamp = new Date();
      const newLine = { sender, text, timestamp };
      roomTranscripts[roomId].push(newLine);
      io.to(roomId).emit('new-transcript-line', newLine);

      try {
        const meeting = await prisma.meeting.findUnique({ where: { roomId } });
        if (meeting) {
          await prisma.transcript.create({
            data: {
              meetingId: meeting.id,
              sender,
              text,
              timestamp
            }
          });
        }
      } catch (e) {
        console.error('DB transcript error:', e);
      }
    });

    // Send initial transcript to the newly joined user
    socket.emit('transcript-update', roomTranscripts[roomId] || []);
  });

  // ========== WebRTC Signaling ==========
  // Forward offer from caller to target
  socket.on('offer', (payload) => {
    console.log(`Offer from ${payload.caller} to ${payload.target}`);
    io.to(payload.target).emit('offer', payload);
  });

  // Forward answer from callee back to caller
  socket.on('answer', (payload) => {
    console.log(`Answer from ${payload.caller} to ${payload.target}`);
    io.to(payload.target).emit('answer', payload);
  });

  // Forward ICE candidates between peers (include sender ID)
  socket.on('ice-candidate', (payload) => {
    io.to(payload.target).emit('ice-candidate', { candidate: payload.candidate, from: socket.id });
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
