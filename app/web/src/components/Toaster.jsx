import { createContext, useCallback, useContext, useState } from 'react';
import Icon from './Icon.jsx';

const ToastContext = createContext(() => {});

// toast('Saved') or toast(err.message, 'error'). Toasts disappear after a few seconds.
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const toast = useCallback((message, tone = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((list) => [...list.slice(-2), { id, message, tone }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), tone === 'error' ? 6000 : 3500);
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            <span style={{ flex: 1 }}>{t.message}</span>
            <button
              className="icon-btn"
              style={{ width: 22, height: 22 }}
              onClick={() => setToasts((list) => list.filter((x) => x.id !== t.id))}
              aria-label="Dismiss"
            >
              <Icon name="x" size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
