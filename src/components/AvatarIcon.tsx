import React from "react";
import { User } from "../types";

interface AvatarProps {
  user: User | Partial<User>;
  size?: "sm" | "md" | "lg" | "xl";
  showStatus?: boolean;
}

const colorMap: Record<string, string> = {
  sky: "bg-sky-500/10 text-sky-300 border-sky-500/25",
  emerald: "bg-emerald-500/10 text-emerald-200 border-emerald-500/25",
  amber: "bg-amber-500/10 text-amber-300 border-amber-500/25",
  rose: "bg-rose-500/10 text-rose-300 border-rose-500/25",
  indigo: "bg-indigo-500/10 text-indigo-300 border-indigo-500/25",
  purple: "bg-purple-500/10 text-purple-300 border-purple-500/25",
  slate: "bg-stone-800 text-stone-200 border-stone-700",
};

const sizeClasses = {
  sm: "h-8 w-8 text-sm rounded-full",
  md: "h-10 w-10 text-base rounded-full",
  lg: "h-14 w-14 text-xl rounded-full",
  xl: "h-20 w-20 text-3xl rounded-full",
};

const statusColors = {
  online: "bg-green-500 ring-black",
  away: "bg-amber-500 ring-black",
  offline: "bg-stone-600 ring-black",
};

export const AvatarIcon: React.FC<AvatarProps> = ({ 
  user, 
  size = "md", 
  showStatus = true 
}) => {
  const colorClass = colorMap[user.avatarColor || "slate"] || colorMap.slate;
  const emoji = user.avatarEmoji || "👤";
  const status = user.status || "offline";

  return (
    <div className={`relative inline-flex items-center justify-center border ${colorClass} ${sizeClasses[size]} select-none shadow-sm transition-transform hover:scale-105 duration-200 cursor-pointer font-sans`}>
      <span>{emoji}</span>
      
      {showStatus && user.id !== "system" && (
        <span className={`absolute bottom-[-1px] right-[-1px] block h-3 w-3 rounded-full ring-2 ${statusColors[status]}`}>
          {status === "online" && (
            <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping"></span>
          )}
        </span>
      )}
    </div>
  );
};
