import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { User, Message, Channel, Reaction } from "../types";
import { showDesktopNotification, startTabFlashing, stopTabFlashing } from "../utils/notification";
import { playChime } from "../utils/audio";
import { AvatarIcon } from "./AvatarIcon";
import { 
  Hash, 
  Plus, 
  Smile, 
  Image as ImageIcon, 
  LogOut, 
  Search, 
  Volume2, 
  VolumeX, 
  Bell, 
  X, 
  Users,
  Menu,
  MessageSquare,
  AlertCircle
} from "lucide-react";
import { 
  collection, 
  doc, 
  setDoc, 
  updateDoc, 
  onSnapshot, 
  query, 
  orderBy, 
  getDocs
} from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../utils/firebase";

interface ChatLayoutProps {
  currentUser: User;
  onLogout: () => void;
}

export const ChatLayout: React.FC<ChatLayoutProps> = ({ currentUser, onLogout }) => {
  // Connection state indicating Firestore snapshot health
  const [connectionStatus, setConnectionStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");

  // Core collections synced from server
  const [channels, setChannels] = useState<Channel[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [users, setUsers] = useState<User[]>([]);

  // UI state variables
  const [activeChannelId, setActiveChannelId] = useState("general");
  const [messageInput, setMessageInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Record<string, { username: string; channelId: string }>>({});
  
  // Custom states
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [hasNotificationPermission, setHasNotificationPermission] = useState(false);
  const [showChannelModal, setShowChannelModal] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelDesc, setNewChannelDesc] = useState("");
  const [channelError, setChannelError] = useState("");

  // File Upload states
  const [previewBase64, setPreviewBase64] = useState<string | null>(null);
  const [uploadFileName, setUploadFileName] = useState("");
  const [uploadFileType, setUploadFileType] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  // Responsive drawer for mobile screens
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // References
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const typingTimerRef = useRef<number | null>(null);

  // Track window focus
  const isWindowFocused = useRef(true);

  // Set window focus refs
  useEffect(() => {
    isWindowFocused.current = document.hasFocus();

    const handleFocus = () => {
      isWindowFocused.current = true;
      stopTabFlashing();
    };
    const handleBlur = () => {
      isWindowFocused.current = false;
    };

    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);

    // Initial permission check
    if ("Notification" in window) {
      setHasNotificationPermission(Notification.permission === "granted");
    }

    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  // Request browser desktop privileges
  const requestNotificationPermission = async () => {
    if (!("Notification" in window)) return;
    const result = await Notification.requestPermission();
    setHasNotificationPermission(result === "granted");
  };

  // Sound cues toggle handler
  const toggleSound = () => {
    setSoundEnabled(!soundEnabled);
  };

  // Scroll to bottom helper
  const scrollToBottom = (behavior: "smooth" | "auto" = "smooth") => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  };

  // Filter messages in selected active channel first
  const activeChannelMessages = messages.filter(m => m.channelId === activeChannelId);

  // Track last message details to prevent repetitive scroll loops on reaction/presence changes
  const activeChannelMessagesCount = activeChannelMessages.length;
  const lastMessageIdInActiveChannel = activeChannelMessagesCount > 0 
    ? activeChannelMessages[activeChannelMessagesCount - 1].id 
    : "";

  // Scroll to bottom ONLY when active messages count, last message ID, or channel truly switches
  useEffect(() => {
    scrollToBottom("smooth");
  }, [activeChannelMessagesCount, lastMessageIdInActiveChannel, activeChannelId]);

  // Synchronous refs to prevent stale closures inside callbacks
  const activeChannelIdRef = useRef(activeChannelId);
  const soundEnabledRef = useRef(soundEnabled);

  useEffect(() => {
    activeChannelIdRef.current = activeChannelId;
  }, [activeChannelId]);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  // 1. Presence registration system
  useEffect(() => {
    const userRef = doc(db, "users", currentUser.id);
    
    const refreshPresence = async () => {
      try {
        await setDoc(userRef, {
          ...currentUser,
          lastActive: Date.now()
        }, { merge: true });
      } catch (err) {
        console.error("Presence check fails:", err);
      }
    };

    refreshPresence();
    const presenceTimer = setInterval(refreshPresence, 20000);

    return () => {
      clearInterval(presenceTimer);
      // Try to gracefully mark away/offline on unmount
      setDoc(userRef, {
        status: "offline",
        lastActive: Date.now()
      }, { merge: true }).catch(err => console.log("Unmount presence update skipped:", err));
    };
  }, [currentUser]);

  // 2. Synchronous subscriptions for channels, messages, users, and typing telemetry
  useEffect(() => {
    setConnectionStatus("connecting");

    // Live Channels Sync
    const unsubscribeChannels = onSnapshot(collection(db, "channels"), async (snapshot) => {
      if (snapshot.empty) {
        // Automatically seed default channels if database is fresh
        const defaultChannels: Channel[] = [
          { id: "general", name: "general", description: "Default channel for friendly workspace chit-chats." },
          { id: "tech-corner", name: "tech-corner", description: "Code snippets, engineering design reviews, and modern tools." },
          { id: "announcements", name: "announcements", description: "Broadcast board for official notifications and alerts." }
        ];

        try {
          for (const ch of defaultChannels) {
            await setDoc(doc(db, "channels", ch.id), ch);
          }
          // Seed system welcome message too
          const systemMsg: Message = {
            id: "system-welcome",
            channelId: "general",
            user: {
              id: "system",
              username: "System Butler",
              avatarColor: "slate",
              avatarEmoji: "🛎️",
              status: "online",
              lastActive: Date.now()
            },
            content: "Welcome to the real-time Workspace Chat App! Share links, upload screenshots/drawings, react to messages, or test push notifications.",
            timestamp: Date.now(),
            reactions: [],
            isSystem: true
          };
          await setDoc(doc(db, "messages", systemMsg.id), systemMsg);
        } catch (e) {
          console.error("Failed to seed default database channels:", e);
        }
      } else {
        const loadedChannels: Channel[] = [];
        snapshot.docs.forEach((doc) => {
          loadedChannels.push(doc.data() as Channel);
        });
        setChannels(loadedChannels);
        setConnectionStatus("connected");
      }
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, "channels");
      setConnectionStatus("disconnected");
    });

    // Live Messages Sync
    const messagesQuery = query(collection(db, "messages"), orderBy("timestamp", "asc"));
    const unsubscribeMessages = onSnapshot(messagesQuery, (snapshot) => {
      const loadedMessages: Message[] = [];
      snapshot.docs.forEach((doc) => {
        loadedMessages.push(doc.data() as Message);
      });
      setMessages(loadedMessages);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, "messages");
    });

    // Live Users Sync
    const unsubscribeUsers = onSnapshot(collection(db, "users"), (snapshot) => {
      const loadedUsers: User[] = [];
      const now = Date.now();
      snapshot.docs.forEach((doc) => {
        const data = doc.data() as User;
        // Mark stale users as offline (inactive for over 90 seconds)
        const isStale = (now - data.lastActive) > 90000;
        loadedUsers.push({
          ...data,
          status: isStale ? "offline" : data.status
        });
      });
      setUsers(loadedUsers);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, "users");
    });

    // Live Typing Sync
    const unsubscribeTyping = onSnapshot(collection(db, "typing"), (snapshot) => {
      const activeTyping: Record<string, { username: string; channelId: string }> = {};
      const now = Date.now();
      snapshot.docs.forEach((doc) => {
        const data = doc.data();
        if (data.isTyping && data.userId !== currentUser.id && (now - data.lastUpdated < 10000)) {
          activeTyping[data.userId] = { username: data.username, channelId: data.channelId };
        }
      });
      setTypingUsers(activeTyping);
    }, (err) => {
      console.warn("Typing subscription error:", err);
    });

    return () => {
      unsubscribeChannels();
      unsubscribeMessages();
      unsubscribeUsers();
      unsubscribeTyping();
    };
  }, [currentUser]);

  // 3. Setup client notifications on real-time message changes
  const initialLoadRef = useRef(true);
  useEffect(() => {
    if (messages.length === 0) return;
    if (initialLoadRef.current) {
      initialLoadRef.current = false;
      return;
    }

    const latestMessage = messages[messages.length - 1];
    if (!latestMessage) return;

    // Verify message is very recent to avoid triggering popups on old backloaded chats
    const isVeryRecent = Date.now() - latestMessage.timestamp < 3500;
    
    if (isVeryRecent && latestMessage.user.id !== currentUser.id) {
       if (latestMessage.channelId !== activeChannelIdRef.current || !isWindowFocused.current) {
         if (soundEnabledRef.current) {
           playChime();
         }
         if (Notification.permission === "granted") {
           const targetChanName = channels.find(c => c.id === latestMessage.channelId)?.name || 'channel';
           showDesktopNotification(`New in #${targetChanName}`, { body: `${latestMessage.user.username}: ${latestMessage.content}` });
         }
         if (!isWindowFocused.current) {
           const targetChanName = channels.find(c => c.id === latestMessage.channelId)?.name || 'channel';
           startTabFlashing(`New in #${targetChanName}`);
         }
       }
    }
  }, [messages.length]);

  // Transmit typing activity telemetry
  const reportTypingStatus = async (typingState: boolean) => {
    try {
      const typingRef = doc(db, "typing", currentUser.id);
      await setDoc(typingRef, {
        userId: currentUser.id,
        username: currentUser.username,
        channelId: activeChannelIdRef.current,
        isTyping: typingState,
        lastUpdated: Date.now()
      });
    } catch (e) {
      console.warn("Reporting telemetry typing status collapsed:", e);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setMessageInput(e.target.value);

    if (!isTyping) {
      setIsTyping(true);
      reportTypingStatus(true);
    }

    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
    }

    // Set auto off after 2.5s of typing silence
    typingTimerRef.current = window.setTimeout(() => {
      setIsTyping(false);
      reportTypingStatus(false);
    }, 2500);
  };

  // Send message
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageInput.trim() && !previewBase64) return;
    if (connectionStatus === "disconnected") return;

    let finalImageUrl: string | undefined = undefined;

    // If there is an image preview, upload it first
    if (previewBase64) {
      setIsUploading(true);
      try {
        const response = await fetch("/api/upload", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            fileName: uploadFileName,
            fileType: uploadFileType,
            base64Data: previewBase64
          })
        });
        const uploadResult = await response.json();
        if (uploadResult.fileUrl) {
          finalImageUrl = uploadResult.fileUrl;
        } else {
          throw new Error(uploadResult.error || "Failed upload processing");
        }
      } catch (err: any) {
        console.error("File upload failed:", err);
        setUploadError("Image upload broke down. Message sent without image.");
        setTimeout(() => setUploadError(""), 4000);
      }
      setIsUploading(false);
    }

    const newMessage: Message = {
      id: "msg-" + Date.now() + "-" + Math.random().toString(36).substring(2, 7),
      channelId: activeChannelId,
      user: currentUser,
      content: messageInput.trim(),
      timestamp: Date.now(),
      imageUrl: finalImageUrl,
      reactions: []
    };

    try {
      await setDoc(doc(db, "messages", newMessage.id), newMessage);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `messages/${newMessage.id}`);
    }

    // ResetComposer
    setMessageInput("");
    setPreviewBase64(null);
    setUploadFileName("");
    setUploadFileType("");
    
    // Stop typing telemetry immediately
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
    }
    setIsTyping(false);
    reportTypingStatus(false);
  };

  // Convert uploaded image to base64 for preview
  const handleImageFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setUploadError("Please upload visual image files only (PNG, JPG, WEBP, GIF).");
      setTimeout(() => setUploadError(""), 3000);
      return;
    }

    // Limit base64 client-size conversions to 5MB to prevent browser crash
    if (file.size > 5 * 1024 * 1024) {
      setUploadError("File exceeds 5MB size limit.");
      setTimeout(() => setUploadError(""), 3000);
      return;
    }

    setUploadFileName(file.name);
    setUploadFileType(file.type);

    const reader = new FileReader();
    reader.onloadend = () => {
      setPreviewBase64(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  // Trigger Firestore reaction toggle
  const toggleReaction = async (messageId: string, emoji: string) => {
    const msgRef = doc(db, "messages", messageId);
    const msgDoc = messages.find(m => m.id === messageId);
    if (!msgDoc) return;

    const currentReactions = msgDoc.reactions || [];
    let nextReactions = [...currentReactions];

    const existingReactionIndex = nextReactions.findIndex(r => r.emoji === emoji);
    if (existingReactionIndex !== -1) {
      const reaction = nextReactions[existingReactionIndex];
      const userIndex = reaction.userIds.indexOf(currentUser.id);

      if (userIndex !== -1) {
        // Remove reaction
        const newUserIds = reaction.userIds.filter(id => id !== currentUser.id);
        if (newUserIds.length === 0) {
          // Remove the group entire
          nextReactions = nextReactions.filter(r => r.emoji !== emoji);
        } else {
          nextReactions[existingReactionIndex] = { ...reaction, userIds: newUserIds };
        }
      } else {
        // Add user to reaction list
        nextReactions[existingReactionIndex] = { ...reaction, userIds: [...reaction.userIds, currentUser.id] };
      }
    } else {
      // Add completely new emoji reaction
      nextReactions.push({ emoji, userIds: [currentUser.id] });
    }

    try {
      await updateDoc(msgRef, { reactions: nextReactions });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `messages/${messageId}`);
    }
  };

  // Change self active status
  const updateSelfStatus = async (status: "online" | "away" | "offline") => {
    try {
      const userDoc = doc(db, "users", currentUser.id);
      await updateDoc(userDoc, { status, lastActive: Date.now() });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${currentUser.id}`);
    }
  };

  // Create Channel submit handler
  const handleCreateChannelSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setChannelError("");
    const cleanName = newChannelName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (!cleanName) {
      setChannelError("Accepts only letters, numbers, and dashes.");
      return;
    }

    const newChannelId = cleanName;

    // Check if channel already exists
    if (channels.some(c => c.id === newChannelId)) {
      setChannelError("Channel name is occupied.");
      return;
    }

    const newChannel: Channel = {
      id: newChannelId,
      name: cleanName,
      description: newChannelDesc.trim() || `Channel focused on ${cleanName}.`
    };

    try {
      await setDoc(doc(db, "channels", newChannelId), newChannel);
      setShowChannelModal(false);
      setNewChannelName("");
      setNewChannelDesc("");
      setActiveChannelId(newChannelId);
      setSidebarOpen(false); // Close mobile tray
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `channels/${newChannelId}`);
    }
  };

  // Apply real-time client filter search
  const filteredMessages = activeChannelMessages.filter(m => {
    if (!searchQuery.substring(0, 50).trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return (
      m.content.toLowerCase().includes(q) ||
      m.user.username.toLowerCase().includes(q)
    );
  });

  // Calculate generic active channel object
  const activeChannel = channels.find(c => c.id === activeChannelId) || {
    name: "loading...",
    description: "Hang tight while the live server coordinates channels."
  };

  // Calculate matching typing members for THIS channel only
  const matchingTypers = Object.values(typingUsers).filter(
    (tu: any) => tu.channelId === activeChannelId
  ) as { username: string; channelId: string }[];

  return (
    <div className="h-screen w-full flex bg-[#0a0a0a] text-stone-300 font-sans tracking-normal overflow-hidden select-none">
      
      {/* MOBILE HEADER BAR TRIGGER (HIDDEN ON DESKTOP) */}
      <div className="md:hidden absolute top-3.5 left-4 z-40">
        <button 
          onClick={() => setSidebarOpen(!sidebarOpen)} 
          className="h-10 w-10 flex items-center justify-center bg-[#0f0f0f] rounded-xl border border-white/10 shadow-md text-stone-200 cursor-pointer"
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>

      {/* 1. COMPACT TWO-COLUMN LAYOUT - SIDEBAR PANEL (LEFT) */}
      <aside className={`
        fixed inset-y-0 left-0 z-35 w-72 border-r border-white/10 bg-[#0f0f0f] transform transition-transform duration-300 ease-out flex flex-col justify-between shrink-0
        md:static md:translate-x-0
        ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
      `}>
        
        {/* UPPER HEADER LISTS */}
        <div className="flex-1 flex flex-col overflow-y-auto">
          {/* Main Workspace Branding */}
          <div className="p-4 flex items-center justify-between border-b border-white/5 mt-12 md:mt-0 bg-[#0c0c0c]">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-bold shadow-[0_0_10px_rgba(79,70,229,0.25)]">
                <MessageSquare className="h-4 w-4" />
              </div>
              <span className="text-sm font-bold text-white tracking-tight">Group Chat</span>
            </div>
            
            {/* Status light indicator */}
            <div className="flex items-center gap-1.5 bg-[#050505] py-1 px-2.5 rounded-full border border-white/5">
              <span className={`h-2 w-2 rounded-full ${
                connectionStatus === "connected" ? "bg-green-500 shadow-[0_0_8px_#10b981]" : 
                connectionStatus === "connecting" ? "bg-amber-400 animate-pulse" : "bg-rose-500"
              }`} />
              <span className="text-[10px] font-bold text-stone-500 font-mono capitalize">
                {connectionStatus}
              </span>
            </div>
          </div>

          {/* CHANNELS ACCORDION SECTION */}
          <div className="p-4">
            <div className="flex items-center justify-between text-[10px] font-bold text-stone-500 uppercase tracking-[0.15em] mb-3">
              <span>Discussion Channels</span>
              <button 
                onClick={() => setShowChannelModal(true)} 
                title="Create custom channel"
                className="h-5 w-5 rounded hover:bg-white/5 flex items-center justify-center text-stone-400 hover:text-white transition-colors cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            
            <div className="space-y-0.5 max-h-48 overflow-y-auto pr-1">
              {channels.map((chan) => {
                const isActive = activeChannelId === chan.id;
                return (
                  <button
                    key={chan.id}
                    onClick={() => {
                      setActiveChannelId(chan.id);
                      setSidebarOpen(false);
                    }}
                    className={`
                      w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm select-none transition-all group font-medium cursor-pointer
                      ${isActive ? 
                        "bg-white/5 border border-white/10 text-white font-semibold" : 
                        "text-stone-400 hover:bg-white/[0.02] hover:text-white"
                      }
                    `}
                  >
                    <div className="flex items-center gap-2 overflow-hidden">
                      <Hash className={`h-4 w-4 shrink-0 ${isActive ? "text-indigo-400" : "text-stone-600"}`} />
                      <span className="truncate">{chan.name}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* PRESENCE USERS SECTION */}
          <div className="p-4 border-t border-white/5 flex-1 overflow-y-auto">
            <div className="flex items-center justify-between text-[10px] font-bold text-stone-500 uppercase tracking-[0.15em] mb-4">
              <div className="flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-stone-500" />
                <span>Active Members ({users.length})</span>
              </div>
            </div>

            <div className="space-y-3 pr-1">
              {users.filter(u => u.id !== "assistant").map((u) => {
                const isSelf = u.id === currentUser.id;
                return (
                  <div key={u.id} className="flex items-center gap-2.5 px-1 py-0.5 group">
                    <AvatarIcon user={u} size="sm" showStatus={true} />
                    <div className="flex-1 overflow-hidden min-w-0">
                      <h4 className="text-xs font-semibold text-stone-300 flex items-center justify-between">
                        <span className="truncate pr-1">{u.username}</span>
                        {isSelf && (
                          <span className="text-[9px] font-mono text-stone-500 shrink-0 font-semibold">(You)</span>
                        )}
                      </h4>
                      <p className="text-[10px] text-stone-500 truncate font-mono">
                        {u.status === "online" ? "Active now" : u.status === "away" ? "Idle away" : "Offline"}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* BOTTOM USER UTILITIES FOOTER */}
        <div className="p-4 border-t border-white/5 bg-[#0c0c0c] shrink-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 overflow-hidden">
              <AvatarIcon user={currentUser} size="sm" showStatus={true} />
              <div className="overflow-hidden">
                <h4 className="text-xs font-bold text-white truncate">@{currentUser.username}</h4>
                
                {/* Status selector */}
                <select 
                  onChange={(e) => updateSelfStatus(e.target.value as any)}
                  defaultValue={currentUser.status}
                  className="bg-[#050505] text-[10px] text-stone-400 hover:text-white outline-none border border-white/10 rounded-md py-0.5 px-1.5 font-medium font-sans cursor-pointer focus:ring-0"
                >
                  <option value="online" className="bg-[#0f0f0f]">🟢 Active</option>
                  <option value="away" className="bg-[#0f0f0f]">🟡 Idle</option>
                  <option value="offline" className="bg-[#0f0f0f]">⚪ Invisible</option>
                </select>
              </div>
            </div>

            {/* Notification sounds selector helper */}
            <button 
              onClick={toggleSound} 
              title={soundEnabled ? "Mute notifications" : "Unmute notifications"}
              className="h-8 w-8 rounded-lg hover:bg-white/5 flex items-center justify-center text-stone-400 hover:text-white transition-colors cursor-pointer"
            >
              {soundEnabled ? <Volume2 className="h-4 w-4 text-indigo-400" /> : <VolumeX className="h-4 w-4" />}
            </button>
          </div>

          {/* Leave session button */}
          <button
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 bg-white/5 hover:bg-red-950/20 text-stone-400 hover:text-red-400 border border-white/5 py-2 px-3 rounded-lg text-xs font-semibold transition-all cursor-pointer"
          >
            <LogOut className="h-3.5 w-3.5" />
            Disconnect Session
          </button>
        </div>
      </aside>

      {/* 2. COMPACT TWO-COLUMN LAYOUT - CHAT CONVERSATION AREA (RIGHT) */}
      <main className="flex-1 flex flex-col justify-between bg-[#050505] overflow-hidden relative">
        
        {/* TOP CHANNEL HEADER CONTROL PANEL */}
        <header className="h-16 px-6 shrink-0 border-b border-white/5 flex items-center justify-between pl-16 md:pl-6 bg-[#050505]">
          <div className="overflow-hidden min-w-0 pr-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-1.5 leading-none">
              <Hash className="h-4 w-4 text-stone-600 shrink-0" />
              <span className="truncate">{activeChannel.name}</span>
            </h3>
            <p className="text-[11px] text-stone-500 truncate mt-1">
              {activeChannel.description}
            </p>
          </div>

          {/* SEARCH COMPOSER */}
          <div className="relative max-w-xs shrink-0 hidden sm:block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-stone-500" />
            <input
              type="text"
              value={searchQuery}
              maxLength={50}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Search #${activeChannel.name}...`}
              className="w-full pl-9 pr-8 py-1.5 bg-[#0f0f0f] border border-white/5 rounded-lg outline-none focus:border-indigo-500/85 text-xs font-normal text-white placeholder-stone-600"
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery("")} 
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-500 hover:text-stone-300 rounded"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </header>

        {/* DIALOG SEARCH BANNER FILTER */}
        {searchQuery && (
          <div className="bg-amber-950/20 border-b border-amber-900/30 px-6 py-1.5 flex items-center justify-between text-xs text-amber-500 shrink-0">
            <span className="font-medium flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              Filtering workspace messages containing "{searchQuery}"
            </span>
            <button 
              onClick={() => setSearchQuery("")} 
              className="text-[10px] font-bold underline cursor-pointer hover:text-amber-300"
            >
              Clear Filter
            </button>
          </div>
        )}

        {/* INDEX CHRONOLOGICAL TIMELINE */}
        <div className="flex-1 p-6 overflow-y-auto space-y-4 bg-[#050505]">
          {filteredMessages.length === 0 ? (
            <div className="h-full w-full flex flex-col items-center justify-center text-center p-8">
              <div className="h-12 w-12 bg-white/5 rounded-2xl flex items-center justify-center text-stone-500 mb-4 border border-white/5">
                <Hash className="h-6 w-6" />
              </div>
              <h4 className="text-sm font-bold text-white">
                {searchQuery ? "No entries match search query" : `Welcome to #${activeChannel.name}!`}
              </h4>
              <p className="text-xs text-stone-500 mt-1 max-w-sm">
                {searchQuery ? "Try altering keywords or clear filters to view default room chat logs." : `This marks the beginning of the chat feed database for #${activeChannel.name}.`}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <AnimatePresence initial={false}>
                {filteredMessages.map((msg) => {
                  const isSelf = msg.user.id === currentUser.id;
                  
                  return (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.15 }}
                      className={`flex items-start gap-3 select-text ${isSelf ? "flex-row-reverse" : ""}`}
                    >
                      {/* Avatar icon */}
                      <AvatarIcon user={msg.user} size="md" showStatus={false} />

                      {/* Msg Core Bubble */}
                      <div className={`max-w-[75%] space-y-1 ${isSelf ? "text-right" : ""}`}>
                        <div className="flex items-baseline gap-1.5 justify-start flex-row flex-wrap">
                          <span className="text-xs font-bold text-stone-200">{msg.user.username}</span>
                          <span className="text-[9px] text-stone-500 font-mono">
                            {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          
                          {/* Bot indicator badge */}
                          {msg.user.id === "assistant" && (
                            <span className="bg-indigo-950/60 text-indigo-400 border border-indigo-500/25 text-[8px] font-semibold px-1 rounded font-mono shrink-0">Bot</span>
                          )}
                          {msg.isSystem && (
                            <span className="bg-white/5 text-stone-400 border border-white/5 text-[8px] font-semibold px-1 rounded font-mono shrink-0">System</span>
                          )}
                        </div>

                        {/* Text bubble */}
                        <div className={`
                          text-left px-4 py-2 rounded-2xl text-sm border inline-block select-text break-words w-full
                          ${isSelf ? 
                            "bg-indigo-950/40 border-indigo-500/30 text-indigo-200 rounded-tr-none shadow-[0_0_15px_rgba(79,70,229,0.1)]" : 
                            "bg-[#111111] border-white/5 rounded-tl-none text-stone-300"
                          }
                        `}>
                          {/* Shared file image attachments */}
                          {msg.imageUrl && (
                            <div className="mb-2.5 rounded-lg overflow-hidden border border-white/5 max-h-64 bg-black flex items-center justify-center">
                              <img 
                                src={msg.imageUrl} 
                                alt="Attachment upload screenshot" 
                                className="max-h-64 object-contain max-w-full hover:scale-[1.01] transition-transform cursor-pointer"
                                referrerPolicy="no-referrer"
                                onClick={() => window.open(msg.imageUrl, '_blank')}
                              />
                            </div>
                          )}
                          <p className="whitespace-pre-wrap leading-relaxed text-sm">{msg.content}</p>
                        </div>

                        {/* Emoji Reactions row */}
                        <div className={`flex flex-wrap items-center gap-1.5 mt-1 ${isSelf ? "justify-end" : ""}`}>
                          {msg.reactions && msg.reactions.map((react) => {
                            const hasReacted = react.userIds.includes(currentUser.id);
                            return (
                              <button
                                key={react.emoji}
                                onClick={() => toggleReaction(msg.id, react.emoji)}
                                className={`
                                  flex items-center gap-1 px-1.5 py-0.5 rounded-lg text-[10px] border font-bold transition-all hover:scale-105 active:scale-95 cursor-pointer
                                  ${hasReacted ?
                                    "bg-indigo-950/40 text-indigo-400 border-indigo-500/30 font-semibold" :
                                    "bg-[#111111] border-white/5 text-stone-400 hover:text-stone-200 hover:border-white/10"
                                  }
                                `}
                              >
                                <span>{react.emoji}</span>
                                <span className="font-mono">{react.userIds.length}</span>
                              </button>
                            );
                          })}

                          {/* Quick Add Reaction hover badge */}
                          <div className="relative group/react inline-flex">
                            <button className="h-5 w-5 rounded-full hover:bg-white/5 border border-transparent hover:border-white/5 flex items-center justify-center text-stone-500 hover:text-stone-300 transition-all cursor-pointer">
                              <Smile className="h-3.5 w-3.5" />
                            </button>
                            {/* Reaction shortcuts floating layout */}
                            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 scale-0 group-hover/react:scale-100 group-focus-within/react:scale-100 transition-all duration-150 origin-bottom bg-[#0f0f0f] border border-white/10 rounded-xl p-1.5 shadow-xl flex items-center gap-1 z-30">
                              {["👍", "❤️", "🔥", "😂", "🚀", "💡"].map(emoji => (
                                <button
                                  key={emoji}
                                  onClick={() => toggleReaction(msg.id, emoji)}
                                  className="h-6 w-6 rounded hover:bg-white/5 flex items-center justify-center text-sm transition-transform hover:scale-120 cursor-pointer"
                                >
                                  {emoji}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>

                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* FEEDBACK STATUS INDICATOR (TYPING ACTIVE STATUS FOOTER) */}
        <div className="h-5 px-6 pb-2 shrink-0 select-none">
          {matchingTypers.length > 0 && (
            <div className="flex items-center gap-1.5 text-[10px] text-stone-500 font-medium">
              <span className="flex h-1.5 w-1.5 rounded-full bg-indigo-500 animate-ping shrink-0" />
              <span>
                {matchingTypers.map(t => t.username).join(", ")} {matchingTypers.length === 1 ? "is typing" : "are typing"}...
              </span>
            </div>
          )}
        </div>

        {/* COMPOSER INLINE ATTACHMENT PREVIEW PANEL */}
        {previewBase64 && (
          <div className="mx-6 mb-3 p-3 bg-[#0e0e0e] border border-white/5 rounded-xl flex items-center justify-between shadow-inner shrink-0 relative animate-fade-in">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-lg overflow-hidden border border-white/10 bg-[#151515] flex items-center justify-center">
                <img src={previewBase64} alt="Image upload thumbnail layout" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
              </div>
              <div className="text-left">
                <p className="text-xs font-bold text-white truncate max-w-xs">{uploadFileName}</p>
                <p className="text-[10px] text-stone-500">Ready to transmit screenshot attachment</p>
              </div>
            </div>
            <button 
              onClick={() => {
                setPreviewBase64(null);
                setUploadFileName("");
                setUploadFileType("");
              }}
              className="h-7 w-7 rounded-full bg-[#1c1c1c] hover:bg-rose-950/40 hover:text-rose-400 flex items-center justify-center text-stone-400 transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* COMPOSER TEXT INPUT SYSTEM */}
        <div className="p-6 pt-2 shrink-0 bg-[#050505]">
          <form onSubmit={handleSendMessage} className="relative">
            <div className="relative flex items-center">
              {/* Image upload preview selectors */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                title="Attach image screenshot (max 5MB)"
                className="absolute left-3 h-9 w-9 rounded-xl hover:bg-white/5 flex items-center justify-center text-stone-400 hover:text-white transition-colors shrink-0 cursor-pointer disabled:opacity-50"
              >
                <ImageIcon className="h-4 w-4" />
              </button>
              
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleImageFileSelect}
                accept="image/*"
                className="hidden"
              />

              {/* Text composer box */}
              <input
                type="text"
                value={messageInput}
                onChange={handleInputChange}
                disabled={connectionStatus === "disconnected"}
                maxLength={450}
                placeholder={`Compose message in #${activeChannel.name}...`}
                className="w-full pl-14 pr-24 py-3.5 bg-[#111111] hover:bg-[#151515] focus:bg-[#111111] border border-white/10 rounded-xl outline-none focus:border-indigo-500/80 text-sm font-normal text-stone-200 transition-colors leading-relaxed placeholder-stone-600 disabled:opacity-60"
              />

              {/* Action triggers */}
              <div className="absolute right-2 flex items-center">
                <button
                  type="submit"
                  disabled={isUploading || connectionStatus === "disconnected" || (!messageInput.trim() && !previewBase64)}
                  className={`
                    h-8 px-4 rounded-lg text-xs font-bold tracking-wider uppercase transition-all shrink-0 cursor-pointer
                    ${(messageInput.trim() || previewBase64) && connectionStatus === "connected" ?
                      "bg-white text-black hover:bg-stone-200 active:scale-95 shadow-sm" :
                      "bg-[#1c1c1c] text-stone-600 cursor-not-allowed"
                    }
                  `}
                >
                  Send
                </button>
              </div>
            </div>

            {/* In-composer status warnings */}
            {uploadError && (
              <p className="text-[10px] text-rose-400 font-semibold mt-1.5 ml-1 flex items-center gap-1 bg-rose-950/20 p-2 rounded-lg border border-rose-900/30 max-w-max">
                <AlertCircle className="h-3.5 w-3.5" />
                {uploadError}
              </p>
            )}
          </form>
        </div>
      </main>

      {/* CREATE CUSTOM CHANNEL MODAL INTERACTIVE POP-UP OVERLAY */}
      {showChannelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm shadow-xl font-sans">
          <div className="w-full max-w-sm bg-[#0f0f0f] rounded-xl border border-white/10 overflow-hidden shadow-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-sm font-bold text-white flex items-center gap-1.5">
                <Hash className="h-4.5 w-4.5 text-indigo-400" />
                Create New Channel
              </h4>
              <button 
                onClick={() => setShowChannelModal(false)}
                className="h-8 w-8 rounded-full hover:bg-white/5 flex items-center justify-center text-stone-400 hover:text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateChannelSubmit} className="space-y-4">
              {/* Channel name inputs */}
              <div>
                <label htmlFor="chName" className="block text-[10px] font-bold text-stone-500 uppercase tracking-widest mb-1">
                  Channel Name
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500 text-sm font-mono font-bold">#</span>
                  <input
                    id="chName"
                    type="text"
                    required
                    maxLength={20}
                    placeholder="marketing-team"
                    value={newChannelName}
                    onChange={(e) => {
                      setNewChannelName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""));
                      setChannelError("");
                    }}
                    className="w-full pl-7 pr-3 py-2 bg-black border border-white/5 rounded-lg outline-none focus:border-white/20 text-xs text-white"
                  />
                </div>
              </div>

              {/* Descriptions */}
              <div>
                <label htmlFor="chDesc" className="block text-[10px] font-bold text-stone-500 uppercase tracking-widest mb-1">
                  Description
                </label>
                <input
                  id="chDesc"
                  type="text"
                  maxLength={100}
                  placeholder="Review campaigns and timeline planning."
                  value={newChannelDesc}
                  onChange={(e) => setNewChannelDesc(e.target.value)}
                  className="w-full px-3 py-2 bg-black border border-white/5 rounded-lg outline-none focus:border-white/20 text-xs text-white"
                />
              </div>

              {channelError && (
                <p className="text-[10px] text-rose-400 font-semibold bg-rose-950/20 p-2.5 border border-rose-900/40 rounded-lg">
                  {channelError}
                </p>
              )}

              {/* Button controllers */}
              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowChannelModal(false)}
                  className="px-3 py-2 text-xs font-semibold hover:bg-white/5 text-stone-400 hover:text-stone-250 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold bg-white text-black hover:bg-stone-200 rounded-lg shrink-0 cursor-pointer"
                >
                  Create Channel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
