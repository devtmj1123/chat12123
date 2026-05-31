/**
 * Checks, requests, and triggers HTML5 custom notifications and document title flashing.
 */

// Native desktop notification support check
export function canNotify(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

// Request desktop notification permission
export async function requestNotifyPermission(): Promise<NotificationPermission> {
  if (!canNotify()) return "denied";
  return await Notification.requestPermission();
}

// Display native OS notification if allowed and tab is out of focus
export function showDesktopNotification(title: string, options: NotificationOptions = {}) {
  if (!canNotify() || Notification.permission !== "granted") return;

  // Let browser show the notification
  try {
    const defaultOptions: any = {
      icon: "https://cdn-icons-png.flaticon.com/512/3024/3024593.png", // Fallback system bubble icon
      badge: "https://cdn-icons-png.flaticon.com/512/3024/3024593.png",
      tag: "workspace-notification",
      renotify: true,
      ...options,
    };
    new Notification(title, defaultOptions);
  } catch (error) {
    console.warn("Native Notification failed to spawn:", error);
  }
}

// Document title flashing mechanism when messages arrive in the background
let flashTimer: number | null = null;
let originalTitle = "Full Stack Workspace Chat";

if (typeof document !== "undefined") {
  originalTitle = document.title || "Full Stack Workspace Chat";
}

export function startTabFlashing(message: string) {
  if (typeof document === "undefined") return;
  if (flashTimer !== null) stopTabFlashing();

  let isAlternative = false;
  document.title = `💬 ${message}`;

  flashTimer = window.setInterval(() => {
    document.title = isAlternative ? `💬 ${message}` : originalTitle;
    isAlternative = !isAlternative;
  }, 1000);
}

export function stopTabFlashing() {
  if (typeof document === "undefined") return;
  if (flashTimer !== null) {
    clearInterval(flashTimer);
    flashTimer = null;
  }
  document.title = originalTitle;
}
