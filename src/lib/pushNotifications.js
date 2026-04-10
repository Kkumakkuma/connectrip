import { supabase } from './supabase';

/**
 * Request notification permission from the user
 * @returns {Promise<string>} 'granted', 'denied', or 'default'
 */
export async function requestPermission() {
  if (!('Notification' in window)) {
    console.warn('This browser does not support notifications');
    return 'denied';
  }
  const permission = await Notification.requestPermission();
  return permission;
}

/**
 * Subscribe to push notifications via the service worker
 * @param {string} userId - The user's ID to store the subscription
 * @returns {Promise<PushSubscription|null>}
 */
export async function subscribeToPush(userId) {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.warn('Push notifications not supported');
      return null;
    }

    const registration = await navigator.serviceWorker.ready;

    // Check for existing subscription
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      // Create new subscription
      // Note: In production, replace with your VAPID public key
      const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
      if (!vapidPublicKey) {
        console.warn('VAPID public key not configured. Push subscription skipped.');
        return null;
      }

      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
    }

    // Store subscription in the profiles table
    if (userId && subscription) {
      await supabase
        .from('profiles')
        .update({ push_subscription: subscription.toJSON() })
        .eq('id', userId);
    }

    return subscription;
  } catch (error) {
    console.error('Failed to subscribe to push:', error);
    return null;
  }
}

/**
 * Send a local notification (when the tab is active / no push server needed)
 * @param {string} title
 * @param {string} body
 * @param {string} url - URL to open on click
 */
export function sendLocalNotification(title, body, url = '/') {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  // If service worker is available, use it for consistency
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.ready.then((registration) => {
      registration.showNotification(title, {
        body,
        icon: '/icon-192x192.png',
        badge: '/icon-192x192.png',
        data: url,
      });
    });
  } else {
    // Fallback to basic Notification API
    const notification = new Notification(title, {
      body,
      icon: '/icon-192x192.png',
    });
    notification.onclick = () => {
      window.focus();
      window.location.href = url;
    };
  }
}

/**
 * Check if notification permission has been granted
 * @returns {boolean}
 */
export function isNotificationGranted() {
  return 'Notification' in window && Notification.permission === 'granted';
}

/**
 * Check if notification permission has been asked before
 * @returns {boolean}
 */
export function isNotificationDecided() {
  return 'Notification' in window && Notification.permission !== 'default';
}

// Helper: Convert VAPID key
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
