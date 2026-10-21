import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface User {
  socketId: string;
  userId: string;
  username: string;
  avatar: string;
  color: string;
  room: string;
  joinedAt: number;
}

interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderAvatar: string;
  senderColor: string;
  text: string;
  room: string;
  timestamp: number;
  replyTo?: {
    id: string;
    senderName: string;
    text: string;
  };
  reactions?: Record<string, string[]>; // emoji -> array of userIds
  isSystem?: boolean;
  isPinned?: boolean;
  senderRole?: string;
}

const app = express();
const server = http.createServer(app);

const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

app.use(express.json());

// In-memory data store
const users = new Map<string, User>(); // socketId -> User
const roomHistories = new Map<string, ChatMessage[]>(); // room -> messages

function getRoomHistory(room: string): ChatMessage[] {
  if (!roomHistories.has(room)) {
    // Initial welcome system message for the room
    const welcomeMsg: ChatMessage = {
      id: `welcome-${room}`,
      senderId: 'system',
      senderName: 'النظام',
      senderAvatar: '🌟',
      senderColor: '#3b82f6',
      text: room === 'general'
        ? 'مرحباً بكم جميعاً في غرفة الدردشة العامة! شاركوا الأحاديث واستمتعوا مع أصدقائكم 🎉'
        : `أهلاً بكم في غرفة [${room}]! 🎉`,
      room,
      timestamp: Date.now(),
      isSystem: true,
    };
    roomHistories.set(room, [welcomeMsg]);
  }
  return roomHistories.get(room)!;
}

function getRoomUsers(room: string): User[] {
  const result: User[] = [];
  for (const user of users.values()) {
    if (user.room === room) {
      result.push(user);
    }
  }
  return result;
}

// REST endpoints
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    totalUsersOnline: users.size,
    timestamp: Date.now(),
  });
});

app.get('/api/rooms', (_req, res) => {
  const counts: Record<string, number> = {
    general: 0,
    chill: 0,
    gaming: 0,
    study: 0,
  };
  for (const user of users.values()) {
    counts[user.room] = (counts[user.room] || 0) + 1;
  }
  res.json({ counts });
});

// Socket.io Realtime Events
io.on('connection', (socket) => {
  socket.on('join_room', (data: { userId: string; username: string; avatar: string; color: string; room?: string }) => {
    const room = (data.room || 'general').trim();
    const username = (data.username || 'صديق').trim();
    const avatar = data.avatar || '😊';
    const color = data.color || '#3b82f6';
    const userId = data.userId || socket.id;

    // Leave previous room if any
    const existing = users.get(socket.id);
    if (existing) {
      socket.leave(existing.room);
      const prevRoom = existing.room;
      users.delete(socket.id);
      
      // Notify previous room
      io.to(prevRoom).emit('room_users', getRoomUsers(prevRoom));
    }

    // Join new room
    socket.join(room);
    const user: User = {
      socketId: socket.id,
      userId,
      username,
      avatar,
      color,
      room,
      joinedAt: Date.now(),
    };
    users.set(socket.id, user);

    // Send history to joining client
    const history = getRoomHistory(room);
    socket.emit('room_history', history);

    // Broadcast updated users to room
    const roomUsers = getRoomUsers(room);
    io.to(room).emit('room_users', roomUsers);

    // Broadcast system join notification
    const joinMsg: ChatMessage = {
      id: `sys-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      senderId: 'system',
      senderName: 'النظام',
      senderAvatar: '👋',
      senderColor: '#10b981',
      text: `انضم ${username} إلى الدردشة الآن!`,
      room,
      timestamp: Date.now(),
      isSystem: true,
    };
    history.push(joinMsg);
    if (history.length > 200) history.shift();
    io.to(room).emit('new_message', joinMsg);
  });

  socket.on('send_message', (payload: { text: string; replyTo?: { id: string; senderName: string; text: string } }) => {
    const user = users.get(socket.id);
    if (!user || !payload.text || !payload.text.trim()) return;

    const cleanText = payload.text.trim();
    if (cleanText.length > 2000) return; // Safeguard length

    const message: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      senderId: user.userId,
      senderName: user.username,
      senderAvatar: user.avatar,
      senderColor: user.color,
      text: cleanText,
      room: user.room,
      timestamp: Date.now(),
      replyTo: payload.replyTo,
      reactions: {},
    };

    const history = getRoomHistory(user.room);
    history.push(message);
    if (history.length > 200) history.shift();

    io.to(user.room).emit('new_message', message);
  });

  socket.on('add_reaction', ({ messageId, emoji }: { messageId: string; emoji: string }) => {
    const user = users.get(socket.id);
    if (!user) return;

    const history = getRoomHistory(user.room);
    const msg = history.find((m) => m.id === messageId);
    if (!msg || msg.isSystem) return;

    if (!msg.reactions) msg.reactions = {};
    if (!msg.reactions[emoji]) msg.reactions[emoji] = [];

    const userList = msg.reactions[emoji];
    const index = userList.indexOf(user.userId);
    if (index > -1) {
      userList.splice(index, 1);
      if (userList.length === 0) {
        delete msg.reactions[emoji];
      }
    } else {
      userList.push(user.userId);
    }

    io.to(user.room).emit('reaction_updated', {
      messageId,
      reactions: msg.reactions,
    });
  });

  socket.on('delete_message', ({ messageId, room }: { messageId: string; room: string }) => {
    const history = getRoomHistory(room);
    const index = history.findIndex((m) => m.id === messageId);
    if (index > -1) {
      history.splice(index, 1);
    }
    io.to(room).emit('message_deleted', { messageId });
  });

  socket.on('pin_message', ({ messageId, isPinned, room }: { messageId: string; isPinned: boolean; room: string }) => {
    const history = getRoomHistory(room);
    const msg = history.find((m) => m.id === messageId);
    if (msg) {
      msg.isPinned = isPinned;
    }
    io.to(room).emit('message_pinned', { messageId, isPinned });
  });

  socket.on('clear_room', ({ room }: { room: string }) => {
    roomHistories.set(room, []);
    io.to(room).emit('room_cleared');
  });

  socket.on('broadcast_announcement', ({ text, room, senderName }: { text: string; room: string; senderName: string }) => {
    const sysMsg: ChatMessage = {
      id: `announcement-${Date.now()}`,
      senderId: 'admin_broadcast',
      senderName: `تنبيه إداري من ${senderName}`,
      senderAvatar: '📢',
      senderColor: '#f59e0b',
      text,
      room,
      timestamp: Date.now(),
      isPinned: true,
      isSystem: true,
    };
    const history = getRoomHistory(room);
    history.push(sysMsg);
    io.to(room).emit('new_message', sysMsg);
  });

  socket.on('typing_start', () => {
    const user = users.get(socket.id);
    if (user) {
      socket.to(user.room).emit('user_typing', {
        userId: user.userId,
        username: user.username,
        isTyping: true,
      });
    }
  });

  socket.on('typing_stop', () => {
    const user = users.get(socket.id);
    if (user) {
      socket.to(user.room).emit('user_typing', {
        userId: user.userId,
        username: user.username,
        isTyping: false,
      });
    }
  });

  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      users.delete(socket.id);
      const room = user.room;
      const roomUsers = getRoomUsers(room);
      io.to(room).emit('room_users', roomUsers);

      const leaveMsg: ChatMessage = {
        id: `sys-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        senderId: 'system',
        senderName: 'النظام',
        senderAvatar: '🚪',
        senderColor: '#64748b',
        text: `غادر ${user.username} الغرفة.`,
        room,
        timestamp: Date.now(),
        isSystem: true,
      };

      const history = getRoomHistory(room);
      history.push(leaveMsg);
      if (history.length > 200) history.shift();
      io.to(room).emit('new_message', leaveMsg);

      socket.to(room).emit('user_typing', {
        userId: user.userId,
        username: user.username,
        isTyping: false,
      });
    }
  });
});

// Vite middleware in dev or static files in prod
const isProduction = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT) || 3000;

async function startServer() {
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
