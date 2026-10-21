export type UserRole = 'admin' | 'moderator' | 'user';

export interface User {
  socketId: string;
  userId: string;
  username: string;
  role?: UserRole;
  avatar: string;
  color: string;
  room: string;
  joinedAt: number;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderAvatar: string;
  senderColor: string;
  senderRole?: UserRole;
  text: string;
  room: string;
  timestamp: number;
  isPinned?: boolean;
  replyTo?: {
    id: string;
    senderName: string;
    text: string;
  };
  reactions?: Record<string, string[]>; // emoji -> array of userIds
  isSystem?: boolean;
}

export interface RoomOption {
  id: string;
  name: string;
  icon: string;
  description: string;
}

export const PRESET_ROOMS: RoomOption[] = [
  {
    id: 'general',
    name: 'غرفة الدردشة العامة',
    icon: '💬',
    description: 'المكان الرئيسي لجميع الأصدقاء للدردشة وتبادل الأخبار',
  },
  {
    id: 'gaming',
    name: 'ألعاب وجيمنج',
    icon: '🎮',
    description: 'ترتيب اللعب، التحديات، ومشاركة اللقطات',
  },
  {
    id: 'chill',
    name: 'سوالف وفرفشة',
    icon: '☕',
    description: 'جلسة رايقة، نكت، وضحك مع الشلة',
  },
  {
    id: 'study',
    name: 'مذاكرة وتحدي',
    icon: '📚',
    description: 'مساعدة في الدراسة، تبادل المراجع والأسئلة',
  },
];

export const AVATAR_OPTIONS = [
  '😎', '🦊', '🚀', '🦁', '🐼', '🐱', '👾', '⚽', '👑', '🎧', '🌟', '🍕', '🔥', '⚡', '🦉', '🎨'
];

export const COLOR_OPTIONS = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#8b5cf6', // purple
  '#f59e0b', // amber
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#ef4444', // red
  '#14b8a6', // teal
];
