import React, { useState } from "react";
import { motion } from "motion/react";
import { User } from "../types";
import { AvatarIcon } from "./AvatarIcon";
import { Layout, MessageSquare, ArrowRight, User as UserIcon } from "lucide-react";

interface OnboardingProps {
  onComplete: (user: User) => void;
}

const emojis = ["🐱", "🦊", "🐨", "🥑", "🚀", "🍕", "🎨", "🎮", "🏄", "🦖", "🍩", "🌟", "🦁", "🐼", "🤖", "🔥"];
const colors = ["sky", "emerald", "amber", "rose", "indigo", "purple", "slate"];

const colorNames: Record<string, string> = {
  sky: "Sky Blue",
  emerald: "Emerald Mint",
  amber: "Warm Honey",
  rose: "Rose Quartz",
  indigo: "Deep Indigo",
  purple: "Royal Orchid",
  slate: "Cool Slate",
};

export const Onboarding: React.FC<OnboardingProps> = ({ onComplete }) => {
  const [username, setUsername] = useState("");
  const [selectedEmoji, setSelectedEmoji] = useState("🦊");
  const [selectedColor, setSelectedColor] = useState("indigo");
  const [error, setError] = useState("");

  const handleConnect = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = username.trim().substring(0, 20);
    if (!cleanName) {
      setError("Please write down a clean handle or username first.");
      return;
    }

    const newUser: User = {
      id: "usr-" + Date.now() + "-" + Math.random().toString(36).substring(2, 7),
      username: cleanName,
      avatarEmoji: selectedEmoji,
      avatarColor: selectedColor,
      status: "online",
      lastActive: Date.now()
    };

    onComplete(newUser);
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#0a0a0a] text-stone-300 p-4 font-sans select-none overflow-y-auto">
      <motion.div 
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="w-full max-w-md bg-[#0f0f0f] border border-white/10 rounded-2xl shadow-2xl overflow-hidden p-8 flex flex-col items-center"
      >
        {/* App Greeting */}
        <div className="flex items-center gap-2 mb-2">
          <div className="h-10 w-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-[0_0_15px_rgba(79,70,229,0.3)]">
            <MessageSquare className="h-5 w-5" />
          </div>
          <span className="text-xl font-bold text-white tracking-tight">Full Stack Workspace</span>
        </div>
        <p className="text-xs text-stone-500 mb-8 tracking-wider uppercase font-semibold">Real-time collaboration suite</p>

        {/* Live Avatar Preview */}
        <div className="mb-6 flex flex-col items-center gap-2">
          <AvatarIcon 
            user={{ username: username || "?", avatarEmoji: selectedEmoji, avatarColor: selectedColor, status: "online" }} 
            size="lg" 
            showStatus={false}
          />
          <span className="text-sm font-medium text-stone-300">
            {username ? `@${username.trim()}` : "Pick your profile appearance"}
          </span>
        </div>

        <form onSubmit={handleConnect} className="w-full space-y-6">
          {/* Handle Entry */}
          <div>
            <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2" htmlFor="username">
              Username ID
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-500 font-mono text-sm">@</span>
              <input
                id="username"
                type="text"
                maxLength={20}
                required
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value.replace(/[^a-zA-Z0-9_\s-]/g, ""));
                  setError("");
                }}
                placeholder="developer_jane"
                className="w-full pl-8 pr-4 py-3 bg-[#050505] border border-white/10 rounded-xl outline-none focus:border-indigo-500 text-white placeholder-stone-600 text-sm font-normal transition-all focus:shadow-[0_0_10px_rgba(79,70,229,0.15)]"
              />
            </div>
          </div>

          {/* Emoji Board Selector */}
          <div>
            <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">
              Select Emoji Avatar
            </label>
            <div className="grid grid-cols-8 gap-2 bg-[#050505] p-2.5 rounded-xl border border-white/10 max-h-28 overflow-y-auto">
              {emojis.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setSelectedEmoji(emoji)}
                  className={`flex h-8 items-center justify-center text-lg rounded-lg hover:bg-white/5 transition-colors cursor-pointer ${selectedEmoji === emoji ? "bg-indigo-600/30 shadow-inner border border-indigo-500/50 scale-110" : ""}`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>

          {/* Color Pallet Picker */}
          <div>
            <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">
              Select Accent Theme
            </label>
            <div className="flex flex-wrap items-center gap-2 bg-[#050505] p-2.5 rounded-xl border border-white/10 justify-center">
              {colors.map((color) => {
                const colorHexes: Record<string, string> = {
                  sky: "bg-sky-400",
                  emerald: "bg-emerald-400",
                  amber: "bg-amber-400",
                  rose: "bg-rose-400",
                  indigo: "bg-indigo-400",
                  purple: "bg-purple-400",
                  slate: "bg-stone-500",
                };
                return (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setSelectedColor(color)}
                    title={colorNames[color]}
                    className={`h-6 w-6 rounded-full ${colorHexes[color]} transition-transform duration-100 hover:scale-115 relative cursor-pointer`}
                  >
                    {selectedColor === color && (
                      <span className="absolute inset-[3px] rounded-full ring-2 ring-black" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {error && (
            <div className="text-xs text-rose-400 bg-rose-500/10 p-3 rounded-lg border border-rose-500/20">
              {error}
            </div>
          )}

          <button
            type="submit"
            className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 hover:shadow-[0_0_15px_rgba(79,70,229,0.30)] active:scale-[98%] text-white py-3 px-4 rounded-xl shadow-md font-medium text-sm transition-all cursor-pointer"
          >
            Enter Workspace 
            <ArrowRight className="h-4 w-4" />
          </button>
        </form>
      </motion.div>
    </div>
  );
};
