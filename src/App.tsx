import { useState, useEffect } from "react";
import { User } from "./types";
import { Onboarding } from "./components/Onboarding";
import { ChatLayout } from "./components/ChatLayout";
import { motion, AnimatePresence } from "motion/react";
import { MessageSquare } from "lucide-react";

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Recovery user profile context on hot restarts or page loads
  useEffect(() => {
    try {
      const stored = localStorage.getItem("workspace_user");
      if (stored) {
        setCurrentUser(JSON.parse(stored));
      }
    } catch (e) {
      console.warn("localStorage sync collapsed:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  // Save profile state on change
  const handleOnboardingComplete = (user: User) => {
    setCurrentUser(user);
    try {
      localStorage.setItem("workspace_user", JSON.stringify(user));
    } catch (e) {
      console.warn("localStorage write collapsed:", e);
    }
  };

  // Logout/Disconnect cleanup
  const handleLogout = () => {
    setCurrentUser(null);
    try {
      localStorage.removeItem("workspace_user");
    } catch (e) {
      console.warn("localStorage clear collapsed:", e);
    }
  };

  if (loading) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-950 font-sans select-none">
        <div className="h-12 w-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-bold shadow-lg shadow-indigo-100 dark:shadow-none mb-3 animate-pulse">
          <MessageSquare className="h-6 w-6" />
        </div>
        <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">Loading Workspace...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-slate-50 dark:bg-slate-950 overflow-hidden">
      <AnimatePresence mode="wait">
        {!currentUser ? (
          <motion.div
            key="onboarding"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="w-full h-full"
          >
            <Onboarding onComplete={handleOnboardingComplete} />
          </motion.div>
        ) : (
          <motion.div
            key="chat"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="w-full h-full"
          >
            <ChatLayout currentUser={currentUser} onLogout={handleLogout} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
