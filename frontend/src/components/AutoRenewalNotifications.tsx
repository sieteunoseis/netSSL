import React from 'react';
import { useWebSocket } from '@/contexts/WebSocketContext';

const formatTimeAgo = (timestamp: string): string => {
  const now = new Date();
  const time = new Date(timestamp);
  const diffInSeconds = Math.floor((now.getTime() - time.getTime()) / 1000);
  
  if (diffInSeconds < 60) return `${diffInSeconds}s ago`;
  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `${diffInHours}h ago`;
  const diffInDays = Math.floor(diffInHours / 24);
  return `${diffInDays}d ago`;
};

export const AutoRenewalNotifications: React.FC = () => {
  const { autoRenewalNotifications, clearAutoRenewalNotifications } = useWebSocket();

  if (autoRenewalNotifications.length === 0) {
    return null;
  }

  return (
    <div className="fixed top-4 right-4 z-50 max-w-md">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between p-3 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
            Auto-Renewal Activity
          </h3>
          <button
            onClick={clearAutoRenewalNotifications}
            className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            Clear
          </button>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {autoRenewalNotifications.map((notification, index) => (
            <div
              key={`${notification.connectionId}-${notification.timestamp}-${index}`}
              className="p-3 border-b border-gray-100 dark:border-gray-700 last:border-b-0"
            >
              <div className="flex items-start space-x-3">
                <div className="flex-shrink-0 mt-0.5">
                  {notification.status === 'in_progress' && (
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                  )}
                  {notification.status === 'success' && (
                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  )}
                  {notification.status === 'failed' && (
                    <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-900 dark:text-gray-100">
                    {notification.message}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {formatTimeAgo(notification.timestamp)}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};