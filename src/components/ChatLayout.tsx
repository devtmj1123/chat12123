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
  AlertCircle,
  Check,
  CheckCheck,
  Send,
  Paperclip,
  MoreVertical,
  Phone,
  Video
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
  const [activeChannelId, setActiveChannelId] = useState("");
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
      reactions: []
    };

    if (finalImageUrl) {
      newMessage.imageUrl = finalImageUrl;
    }

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

   // Deterministic color palette for sender names inside WhatsApp group chats
  const getSenderColor = (userId: string) => {
    const colors = [
      "text-[#30d6bf]", // Light Teal
      "text-[#f47a54]", // Coral
      "text-[#43c4ff]", // Cyan Blue
      "text-[#a2de5c]", // Soft Lime Green
      "text-[#ed79da]", // Warm Pink
      "text-[#ffd12a]"  // Honey Yellow
    ];
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      hash = userId.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  // Find the latest message inside any channel to show as preview in the sidebar
  const getLatestMessageForChannel = (channelId: string) => {
    const channelMsgs = messages.filter((m) => m.channelId === channelId);
    if (channelMsgs.length === 0) return null;
    return channelMsgs[channelMsgs.length - 1];
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

  // Helper for 1-to-1 rooms
  const getDMChannelId = (userAId: string, userBId: string) => {
    const sorted = [userAId, userBId].sort();
    return `dm-${sorted[0]}-${sorted[1]}`;
  };

  const isDM = activeChannelId.startsWith("dm-");
  let dmRecipient: User | undefined = undefined;
  if (isDM) {
    const parts = activeChannelId.split("-");
    const recipientId = parts[1] === currentUser.id ? parts[2] : parts[1];
    dmRecipient = users.find(u => u.id === recipientId);
  }

  // Calculate generic active channel object
  const activeChannel = isDM 
    ? {
        id: activeChannelId,
        name: dmRecipient ? dmRecipient.username : "Direct Chat",
        description: dmRecipient 
          ? `Private 1-to-1 conversation with ${dmRecipient.username} (${dmRecipient.status})` 
          : "Secure Direct Message"
      }
    : (channels.find(c => c.id === activeChannelId) || {
        id: activeChannelId,
        name: "loading...",
        description: "Hang tight while the live server coordinates channels."
      });

  // Calculate matching typing members for THIS channel only
  const matchingTypers = Object.values(typingUsers).filter(
    (tu: any) => tu.channelId === activeChannelId
  ) as { username: string; channelId: string }[];

  return (
    <div className="h-screen w-full flex bg-[#0d1418] text-[#e9edef] font-sans tracking-normal overflow-hidden select-none">
      
      {/* MOBILE HEADER BAR TRIGGER (HIDDEN ON DESKTOP) */}
      <div className="md:hidden absolute top-3 left-4 z-40">
        <button 
          onClick={() => setSidebarOpen(!sidebarOpen)} 
          className="h-10 w-10 flex items-center justify-center bg-[#202c33] hover:bg-[#2a3942] rounded-full border border-white/5 shadow-md text-[#e9edef] cursor-pointer"
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>

      {/* 1. SIDEBAR PANEL (LEFT) - WHATSAPP CHAT LIST PANEL */}
      <aside className={`
        fixed inset-y-0 left-0 z-35 w-80 border-r border-[#202c33]/40 bg-[#111b21] transform transition-transform duration-300 ease-out flex flex-col justify-between shrink-0
        md:static md:translate-x-0
        ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
      `}>
        
        {/* UPPER HEADER LISTS */}
        <div className="flex-1 flex flex-col overflow-y-auto">
          {/* Main Workspace Branding / User Header Bar */}
          <div className="p-3 pl-4 flex items-center justify-between bg-[#202c33] border-b border-[#2a3942]/20 mt-12 md:mt-0">
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-full bg-[#00a884] text-[#111b21] flex items-center justify-center font-bold shadow-[0_0_8px_rgba(0,168,132,0.15)]">
                <MessageSquare className="h-4.5 w-4.5" />
              </div>
              <span className="text-sm font-bold text-[#e9edef] tracking-tight">Apeiron Chat</span>
            </div>
            
            {/* Status light indicator */}
            <div className="flex items-center gap-1.5 bg-[#111b21] py-1 px-2.5 rounded-full border border-[#2a3942]/40">
              <span className={`h-2 w-2 rounded-full ${
                connectionStatus === "connected" ? "bg-[#00e676] shadow-[0_0_6px_#00e676]" : 
                connectionStatus === "connecting" ? "bg-amber-400 animate-pulse" : "bg-rose-500"
              }`} />
              <span className="text-[10px] font-bold text-[#8696a0] font-mono capitalize">
                {connectionStatus}
              </span>
            </div>
          </div>

          {/* DIRECT MESSAGES / CONTACTS LIST */}
          <div className="p-3 flex-1 overflow-y-auto w-full">
            <div className="flex items-center justify-between text-[11px] font-bold text-[#00a884] uppercase tracking-[0.1em] mb-3 px-1">
              <div className="flex items-center gap-1.5">
                <Users className="h-4 w-4 text-[#00a884]" />
                <span>Contacts ({users.filter(u => u.id !== "assistant").length})</span>
              </div>
            </div>

            <div className="space-y-1.5 pr-1">
              {users.filter(u => u.id !== "assistant").map((u) => {
                const isSelf = u.id === currentUser.id;
                const dmId = getDMChannelId(currentUser.id, u.id);
                const isActive = activeChannelId === dmId;
                const latestMsg = getLatestMessageForChannel(dmId);

                return (
                  <button
                    key={u.id}
                    disabled={isSelf}
                    onClick={() => {
                      setActiveChannelId(dmId);
                      setSidebarOpen(false);
                    }}
                    className={`
                      w-full flex items-center gap-3 p-2.5 rounded-xl text-left select-none transition-all border border-transparent
                      ${isSelf 
                        ? "opacity-60 cursor-default" 
                        : "cursor-pointer hover:bg-[#202c33]/40"
                      }
                      ${isActive 
                        ? "bg-[#2a3942] border-[#2a3942]/40 text-white" 
                        : "text-[#8696a0] hover:text-[#e9edef]"
                      }
                    `}
                  >
                    <AvatarIcon user={u} size="sm" showStatus={true} />
                    <div className="flex-1 overflow-hidden min-w-0">
                      <div className="flex items-baseline justify-between mb-0.5">
                        <span className="text-xs font-bold text-[#e9edef] truncate">{u.username}</span>
                        {isSelf ? (
                          <span className="text-[9px] font-mono text-[#00a884] shrink-0 font-bold">(You)</span>
                        ) : (
                          latestMsg && (
                            <span className="text-[9px] text-[#8696a0] font-mono shrink-0">
                              {new Date(latestMsg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )
                        )}
                      </div>
                      <p className="text-[10px] text-[#8696a0] truncate flex items-center gap-1">
                        {latestMsg ? (
                          <>
                            {latestMsg.user.id === currentUser.id && (
                              <span className="text-[#53bdeb] text-[10px] font-bold shrink-0">✓✓</span>
                            )}
                            <span className="font-semibold text-stone-400">
                              {latestMsg.user.id === currentUser.id ? "You" : latestMsg.user.username}:
                            </span>
                            <span className="truncate">{latestMsg.content || "📷 Image attachment"}</span>
                          </>
                        ) : (
                          <span className="capitalize">{u.status === "online" ? "online" : u.status === "away" ? "away" : "offline"}</span>
                        )}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* BOTTOM USER UTILITIES FOOTER */}
        <div className="p-3 border-t border-[#202c33]/40 bg-[#202c33] shrink-0">
          <div className="flex items-center justify-between mb-3 pl-1">
            <div className="flex items-center gap-2.5 overflow-hidden">
              <AvatarIcon user={currentUser} size="sm" showStatus={true} />
              <div className="overflow-hidden">
                <h4 className="text-xs font-bold text-[#e9edef] truncate">@{currentUser.username}</h4>
                
                {/* Status selector */}
                <select 
                  onChange={(e) => updateSelfStatus(e.target.value as any)}
                  defaultValue={currentUser.status}
                  className="bg-[#111b21] text-[10px] text-[#8696a0] hover:text-[#e9edef] outline-none border border-white/5 rounded py-0.5 px-1.5 font-bold font-sans cursor-pointer focus:ring-0 mt-0.5"
                >
                  <option value="online" className="bg-[#111b21]">🟢 Online</option>
                  <option value="away" className="bg-[#111b21]">🟡 Idle</option>
                  <option value="offline" className="bg-[#111b21]">⚪ Invisible</option>
                </select>
              </div>
            </div>

            {/* Notification sounds selector helper */}
            <button 
              onClick={toggleSound} 
              title={soundEnabled ? "Mute notifications" : "Unmute notifications"}
              className="h-8 w-8 rounded-full hover:bg-white/5 flex items-center justify-center text-[#8696a0] hover:text-white transition-colors cursor-pointer animate-none"
            >
              {soundEnabled ? <Volume2 className="h-4.5 w-4.5 text-[#00a884]" /> : <VolumeX className="h-4.5 w-4.5" />}
            </button>
          </div>

          {/* Leave session button */}
          <button
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 bg-[#111b21] hover:bg-rose-950/20 text-[#8696a0] hover:text-red-400 border border-white/5 py-2 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign Out Web
          </button>
        </div>
      </aside>

      {/* 2. CHAT CONVERSATION PANEL (RIGHT) */}
      <main className="flex-1 flex flex-col justify-between bg-[#111b21] overflow-hidden relative">
        {!isDM ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-[#0b141a] relative select-none">
            {/* Ambient vector wallpaper layout */}
            <div 
              className="absolute inset-0 opacity-[0.02]"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'%3E%3Cg fill='%23ffffff'%3E%3Cpath d='M11 18c3.866 0 7-3.134 7-7s-3.134-7-7-7-7 3.134-7 7 3.134 7 7 7zm48 25c3.866 0 7-3.134 7-7s-3.134-7-7-7-7 3.134-7 7 3.134 7 7 7zm-43-7c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zm63 31c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zM34 90c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zm1-61c3.105 0 5.167-2.062 5.167-5.167s-2.062-5.167-5.167-5.167-5.167 2.062-5.167 5.167 2.062 5.167 5.167 5.167zM22.4 44.4a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8zM44 4a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm30.6 12.5a2.1 2.1 0 1 0 0-4.2 2.1 2.1 0 0 0 0 4.2zM2.1 56.6a2.1 2.1 0 1 0 0-4.2 2.1 2.1 0 0 0 0 4.2zm63.3.5a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8z'%2F%3E%3C/g%3E%3C/svg%3E")`
              }}
            />
            
            <div className="relative z-10 max-w-sm px-6 flex flex-col items-center">
              <div className="h-16 w-16 rounded-full bg-[#202c33]/80 text-[#00a884] flex items-center justify-center font-bold shadow-[0_0_12px_rgba(0,168,132,0.15)] mb-5">
                <MessageSquare className="h-8 w-8 text-[#00a884]" />
              </div>
              <h2 className="text-lg font-bold text-[#e9edef] tracking-tight mb-2">Apeiron Chat</h2>
              <p className="text-xs text-[#8696a0] leading-relaxed mb-5">
                Send and receive real-time messages. Select a contact from the list to start a private, secure 1-to-1 conversation.
              </p>
              <div className="h-[1px] w-full bg-[#2a3942]/30 mb-5" />
              <div className="flex items-center gap-1.5 text-[10px] text-[#8696a0] font-mono leading-none">
                <span>🔒 End-to-end synchronized</span>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* TOP COMPACT WHATSAPP HEADER BAR */}
        <header className="h-16 px-6 shrink-0 border-b border-white/5 flex items-center justify-between pl-16 md:pl-6 bg-[#202c33] z-10 shadow-sm">
          <div className="flex items-center gap-3 overflow-hidden min-w-0 pr-4">
            {/* Round Avatar/Icon for the active chat */}
            <div className="shrink-0 select-none">
              {isDM && dmRecipient ? (
                <AvatarIcon user={dmRecipient} size="sm" showStatus={true} />
              ) : (
                <div className="h-9 w-9 rounded-full bg-[#111b21]/80 flex items-center justify-center text-sm font-bold border border-white/5 select-none">
                  {activeChannel.id === "general" ? "💬" : activeChannel.id === "tech-corner" ? "💻" : "📢"}
                </div>
              )}
            </div>
            <div className="overflow-hidden">
              <h3 className="text-xs md:text-sm font-bold text-[#e9edef] truncate">
                {isDM ? dmRecipient?.username : `#${activeChannel.name}`}
              </h3>
              
              {/* WhatsApp real-time sub-heading detail */}
              <div className="text-[10px] md:text-[11px] text-[#8696a0] truncate mt-0.5">
                {matchingTypers.length > 0 ? (
                  <span className="text-[#00a884] font-bold animate-pulse">
                    {matchingTypers.map(t => t.username).join(", ")} typing...
                  </span>
                ) : (
                  <span>
                    {isDM 
                      ? (dmRecipient ? `${dmRecipient.username} is ${dmRecipient.status}` : "Direct Message")
                      : `${users.filter(u => u.status === 'online' && u.id !== "assistant").length} contacts active • ${activeChannel.description}`
                    }
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* CONTROLS (CALL, VIDEO & SEARCH OVERLAYS SIMULATORS) */}
          <div className="flex items-center gap-4.5 text-[#aebac1] shrink-0">
            <button title="Simulated audio call" className="hover:text-white transition-colors cursor-pointer">
              <Phone className="h-4.5 w-4.5" />
            </button>
            <button title="Simulated video call" className="hover:text-white transition-colors cursor-pointer">
              <Video className="h-4.5 w-4.5" />
            </button>
            <div className="h-5 w-[1px] bg-[#2a3942]/60 hidden sm:block" />
            <button 
              onClick={() => setSearchQuery(searchQuery ? "" : " ")} 
              title="Search keywords inside conversations" 
              className={`hover:text-white transition-colors cursor-pointer ${searchQuery ? "text-[#00a884]" : ""}`}
            >
              <Search className="h-4.5 w-4.5" />
            </button>
            <button title="More choices" className="hover:text-white transition-colors cursor-pointer">
              <MoreVertical className="h-4.5 w-4.5" />
            </button>
          </div>
        </header>

        {/* DIALOG SEARCH BANNER FILTER */}
        {searchQuery && (
          <div className="bg-[#2a3942] border-b border-white/5 px-6 py-2 flex items-center justify-between text-xs text-[#00a884] shrink-0 z-10">
            <span className="font-semibold flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              Searching conversations for containing: "{searchQuery.trim()}"
            </span>
            <button 
              onClick={() => setSearchQuery("")} 
              className="text-[10px] px-2 py-0.5 bg-[#111b21] text-stone-300 rounded font-bold hover:text-[#00a884]"
            >
              Clear
            </button>
          </div>
        )}

        {/* TIMELINE SCREEN - RENDERED OVER AUTHENTIC BACKGROUND WALLPAPER */}
        <div 
          className="flex-1 p-6 overflow-y-auto space-y-4 relative"
          style={{
            backgroundColor: "#0b141a",
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'%3E%3Cg fill='%23ffffff' fill-opacity='0.02'%3E%3Cpath d='M11 18c3.866 0 7-3.134 7-7s-3.134-7-7-7-7 3.134-7 7 3.134 7 7 7zm48 25c3.866 0 7-3.134 7-7s-3.134-7-7-7-7 3.134-7 7 3.134 7 7 7zm-43-7c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zm63 31c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zM34 90c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zm1-61c3.105 0 5.167-2.062 5.167-5.167s-2.062-5.167-5.167-5.167-5.167 2.062-5.167 5.167 2.062 5.167 5.167 5.167zM22.4 44.4a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8zM44 4a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm30.6 12.5a2.1 2.1 0 1 0 0-4.2 2.1 2.1 0 0 0 0 4.2zM2.1 56.6a2.1 2.1 0 1 0 0-4.2 2.1 2.1 0 0 0 0 4.2zm63.3.5a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8z'%2F%3E%3C/g%3E%3C/svg%3E")`
          }}
        >
          {filteredMessages.length === 0 ? (
            <div className="h-full w-full flex flex-col items-center justify-center text-center p-8 select-none">
              <div className="h-14 w-14 bg-[#202c33] rounded-full flex items-center justify-center text-stone-500 mb-4 border border-white/5">
                {isDM ? (
                  <MessageSquare className="h-6 w-6 text-[#00a884]" />
                ) : (
                  <Hash className="h-6 w-6 text-[#00a884]" />
                )}
              </div>
              <h4 className="text-sm font-bold text-white">
                {searchQuery ? "No search results match query" : (isDM ? `Direct Chat with ${activeChannel.name}` : `Welcome to Group #${activeChannel.name}`)}
              </h4>
              <p className="text-xs text-[#8696a0] mt-1 max-w-xs leading-relaxed">
                {searchQuery ? "Try altering words to look for matches." : (isDM ? `This marks the beginning of your private 1-to-1 conversation history with ${activeChannel.name}.` : "All communications are synchronizing live. Tap attachments to post files.")}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <AnimatePresence initial={false}>
                {filteredMessages.map((msg) => {
                  const isSelf = msg.user.id === currentUser.id;

                  // 1. WhatsApp styled centered system notifications
                  if (msg.isSystem) {
                    return (
                      <div key={msg.id} className="flex justify-center my-3.5 mx-auto max-w-[85%]">
                        <div className="bg-[#182229] border border-[#2a3942]/10 text-[#ffd279] text-[11px] md:text-[11.5px] py-1 px-3.5 rounded-lg text-center shadow-sm select-text leading-snug">
                          {msg.content}
                        </div>
                      </div>
                    );
                  }

                  // 2. Standard WhatsApp speech bubbles
                  return (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.12 }}
                      className={`flex items-start gap-2.5 select-text group ${isSelf ? "justify-end pl-12" : "justify-start pr-12"}`}
                    >
                      {/* Self has no avatar next to bubble, received has cute avatar for context */}
                      {!isSelf && (
                        <div className="shrink-0 self-start mt-0.5">
                          <AvatarIcon user={msg.user} size="sm" showStatus={false} />
                        </div>
                      )}

                      {/* Bubble Block */}
                      <div className="flex flex-col max-w-full">
                        <div className={`
                          relative px-3.5 py-1.5 rounded-2.5xl text-[13.5px] text-[#e9edef] shadow-[0_1.2px_0.8px_rgba(0,0,0,0.18)] select-text break-words min-w-[120px] pb-5.5
                          ${isSelf ? 
                            "bg-[#005c4b] rounded-tr-none self-end" : 
                            "bg-[#202c33] rounded-tl-none self-start"
                          }
                        `}>
                          {/* Sender's Custom Name Tag inside group balloon (Only for received) */}
                          {!isSelf && (
                            <div className={`text-[11.5px] font-bold ${getSenderColor(msg.user.id)} mb-1 select-none`}>
                              {msg.user.username}
                            </div>
                          )}

                          {/* Render Image File attachments inside balloon if exists */}
                          {msg.imageUrl && (
                            <div className="mb-2 rounded-lg overflow-hidden border border-white/5 max-h-64 bg-black flex items-center justify-center">
                              <img 
                                src={msg.imageUrl} 
                                alt="Shared upload file" 
                                className="max-h-64 object-contain max-w-full hover:scale-[1.01] transition-transform cursor-pointer"
                                referrerPolicy="no-referrer"
                                onClick={() => window.open(msg.imageUrl, '_blank')}
                              />
                            </div>
                          )}

                          {/* Message core text string */}
                          <p className="whitespace-pre-wrap leading-relaxed pb-0.5 text-[#e9edef]">{msg.content}</p>

                          {/* Sneak in typical WhatsApp bottom-right metadata footer stamps */}
                          <div className="absolute bottom-1 right-2.5 flex items-center gap-1 mt-1 select-none">
                            <span className="text-[9px] text-[#8696a0]/90 font-mono scale-95-none">
                              {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            {isSelf && (
                              <span className="text-[#53bdeb] text-[11px] leading-none font-bold">✓✓</span>
                            )}
                          </div>
                        </div>

                        {/* Interactive floating Emoji Picker triggers & active reactions displays */}
                        <div className={`flex flex-wrap items-center gap-1.5 mt-1 ${isSelf ? "justify-end" : "justify-start"}`}>
                          {msg.reactions && msg.reactions.map((react) => {
                            const hasReacted = react.userIds.includes(currentUser.id);
                            return (
                              <button
                                key={react.emoji}
                                onClick={() => toggleReaction(msg.id, react.emoji)}
                                className={`
                                  flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] border transition-all hover:scale-105 active:scale-95 cursor-pointer
                                  ${hasReacted ?
                                    "bg-[#005c4b]/55 text-[#00e676] border-[#00a884]/40 font-bold" :
                                    "bg-[#202c33] border-white/5 text-[#8696a0] hover:text-[#e9edef] hover:border-white/10"
                                  }
                                `}
                              >
                                <span>{react.emoji}</span>
                                <span className="font-mono">{react.userIds.length}</span>
                              </button>
                            );
                          })}

                          {/* Hidden Smile quick picker selector appearing on hover */}
                          <div className="relative group/react inline-flex select-none">
                            <button className="h-5.5 w-5.5 rounded-full hover:bg-white/5 flex items-center justify-center text-[#8696a0] hover:text-white transition-opacity shrink-0 cursor-pointer">
                              <Smile className="h-3.5 w-3.5" />
                            </button>
                            
                            {/* Reaction floating drawer menu on hover */}
                            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 scale-0 group-hover/react:scale-100 group-focus-within/react:scale-100 transition-all duration-120 origin-bottom bg-[#233138] border border-[#2a3942]/70 rounded-full p-1 shadow-2xl flex items-center gap-1 z-35">
                              {["👍", "❤️", "🔥", "😂", "🚀", "💡"].map(emoji => (
                                <button
                                  key={emoji}
                                  onClick={() => toggleReaction(msg.id, emoji)}
                                  className="h-6 w-6 rounded-full hover:bg-white/10 flex items-center justify-center text-sm transition-transform hover:scale-120 cursor-pointer"
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

        {/* FEEDBACK STATUS BAR (SPACER) */}
        <div className="h-1 bg-[#111b21]/10 shrink-0" />

        {/* DIALOG INLINE ATTACHMENT UPLOAD PREVIEW */}
        {previewBase64 && (
          <div className="mx-6 mb-3 p-3 bg-[#202c33] border border-[#2a3942]/30 rounded-xl flex items-center justify-between shadow-lg shrink-0 relative animate-fade-in z-10">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-lg overflow-hidden border border-[#2a3942]/40 bg-black flex items-center justify-center shrink-0">
                <img src={previewBase64} alt="Predefined preview thumbnail" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
              </div>
              <div className="text-left min-w-0">
                <p className="text-xs font-bold text-[#e9edef] truncate max-w-xs">{uploadFileName}</p>
                <p className="text-[10px] text-[#8696a0]">Attached photo will be inserted in conversation bubble</p>
              </div>
            </div>
            <button 
              onClick={() => {
                setPreviewBase64(null);
                setUploadFileName("");
                setUploadFileType("");
              }}
              className="h-8 w-8 rounded-full bg-[#111b21] hover:bg-rose-950/40 text-[#8696a0] hover:text-rose-400 flex items-center justify-center transition-colors cursor-pointer"
            >
              <X className="h-4.5 w-4.5" />
            </button>
          </div>
        )}

        {/* COMPOSER FIELD - DESIGNED EXACTLY LIKE WHATSAPP TEXTING TOOLBAR */}
        <div className="p-3 bg-[#202c33] shrink-0 z-10">
          <form onSubmit={handleSendMessage} className="relative max-w-7xl mx-auto flex items-center gap-2">
            
            {/* Attachment Button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              title="Attach photo/image file"
              className="h-10 w-10 rounded-full hover:bg-[#2a3942] flex items-center justify-center text-[#aebac1] hover:text-[#00a884] transition-colors shrink-0 cursor-pointer disabled:opacity-40"
            >
              <Paperclip className="h-5 w-5" />
            </button>
            
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleImageFileSelect}
              accept="image/*"
              className="hidden"
            />

            {/* Input keyboard bar box */}
            <div className="flex-1 relative flex items-center">
              <input
                type="text"
                value={messageInput}
                onChange={handleInputChange}
                disabled={connectionStatus === "disconnected"}
                maxLength={450}
                placeholder="Type a message"
                className="w-full py-2.5 px-5 bg-[#2a3942] hover:bg-[#32424b] focus:bg-[#2a3942] border border-transparent rounded-lg outline-none text-[14px] text-[#e9edef] transition-all leading-relaxed placeholder-[#8696a0] disabled:opacity-50"
              />
            </div>

            {/* Circular Green Action Button */}
            <button
              type="submit"
              disabled={isUploading || connectionStatus === "disconnected" || (!messageInput.trim() && !previewBase64)}
              className={`
                h-10 w-10 rounded-full flex items-center justify-center transition-all shrink-0 shadow-md cursor-pointer
                ${(messageInput.trim() || previewBase64) && connectionStatus === "connected" ?
                  "bg-[#00a884] hover:bg-[#128c7e] text-[#111b21] active:scale-95" :
                  "bg-[#202c33] border border-[#2a3942]/60 text-[#8696a0] cursor-not-allowed opacity-60"
                }
              `}
              title="Send entry"
            >
              <Send className="h-4.5 w-4.5 text-white" />
            </button>
          </form>

          {/* In-composer status warnings */}
          {uploadError && (
            <p className="text-[10px] text-rose-450 font-bold mt-2 mx-auto max-w-max flex items-center gap-1 bg-rose-950/20 px-3 py-1.5 rounded-lg border border-rose-900/30">
              <AlertCircle className="h-3.5 w-3.5" />
              {uploadError}
            </p>
          )}
        </div>
        </>
        )}
      </main>

      {/* CREATE NEW CHAT/GROUP MODAL POP-UP OVERLAY */}
      {showChannelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm shadow-2xl">
          <div className="w-full max-w-sm bg-[#222e35] rounded-xl border border-white/5 overflow-hidden shadow-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-sm font-bold text-white flex items-center gap-1.5 uppercase tracking-wide">
                <Users className="h-4.5 w-4.5 text-[#00a884]" />
                Create New Chat Group
              </h4>
              <button 
                onClick={() => setShowChannelModal(false)}
                className="h-8 w-8 rounded-full hover:bg-white/5 flex items-center justify-center text-[#8696a0] hover:text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateChannelSubmit} className="space-y-4">
              {/* Group name input */}
              <div>
                <label htmlFor="chName" className="block text-[10px] font-bold text-[#8696a0] uppercase tracking-widest mb-1.5">
                  Group Subject Name
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8696a0] text-sm font-mono font-bold">#</span>
                  <input
                    id="chName"
                    type="text"
                    required
                    maxLength={20}
                    placeholder="e.g. design-hangout"
                    value={newChannelName}
                    onChange={(e) => {
                      setNewChannelName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""));
                      setChannelError("");
                    }}
                    className="w-full pl-7 pr-3 py-2 bg-[#111b21] border border-white/5 rounded-lg outline-none focus:border-[#00a884]/60 text-xs text-white"
                  />
                </div>
              </div>

              {/* Descriptions */}
              <div>
                <label htmlFor="chDesc" className="block text-[10px] font-bold text-[#8696a0] uppercase tracking-widest mb-1.5">
                  Description / Topic Room
                </label>
                <input
                  id="chDesc"
                  type="text"
                  maxLength={100}
                  placeholder="e.g. Discuss assets and layouts ideas"
                  value={newChannelDesc}
                  onChange={(e) => setNewChannelDesc(e.target.value)}
                  className="w-full px-3 py-2 bg-[#111b21] border border-white/5 rounded-lg outline-none focus:border-[#00a884]/60 text-xs text-white"
                />
              </div>

              {channelError && (
                <p className="text-[10px] text-rose-450 font-bold bg-rose-950/20 p-2.5 border border-rose-900/40 rounded-lg">
                  {channelError}
                </p>
              )}

              {/* Button controller */}
              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowChannelModal(false)}
                  className="px-3 py-2 text-xs font-bold hover:bg-white/5 text-[#8696a0] hover:text-white rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold bg-[#00a884] hover:bg-[#128c7e] text-white rounded-lg shrink-0 cursor-pointer shadow"
                >
                  Create Group
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
