export interface User {
  id: string;
  username: string;
  avatarColor: string; // Tailwind color name like 'amber', 'emerald', 'sky', etc.
  avatarEmoji: string; // Fun emojis like '🦊', '🐨', '🦖', '🍕'
  status: 'online' | 'away' | 'offline';
  lastActive: number;
}

export interface Reaction {
  emoji: string;
  userIds: string[]; // List of user IDs who reacted
}

export interface Message {
  id: string;
  channelId: string;
  user: User;
  content: string;
  timestamp: number;
  imageUrl?: string; // Optional image URL for file uploads
  reactions: Reaction[];
  isSystem?: boolean;
}

export interface Channel {
  id: string;
  name: string;
  description: string;
  isPrivate?: boolean;
}

export interface TypingStatus {
  userId: string;
  username: string;
  channelId: string;
  isTyping: boolean;
}
