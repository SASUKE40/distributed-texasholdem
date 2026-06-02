const sessionStorageKey = "distributed-texasholdem-session";

const getStoredSession = () => {
  try {
    return JSON.parse(window.localStorage.getItem(sessionStorageKey));
  } catch {
    return null;
  }
};

const storeSession = (session) => {
  if (session?.code && session?.username && session?.token) {
    window.localStorage.setItem(sessionStorageKey, JSON.stringify(session));
  }
};

const clearSession = () => {
  window.localStorage.removeItem(sessionStorageKey);
};

export const createGameSocket = () => {
  const listeners = new Map();
  const pending = [];
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const url = `${protocol}://${window.location.host}/ws`;
  let socket;
  let reconnectTimer;

  const dispatch = (event, payload) => {
    const callbacks = listeners.get(event) ?? [];
    for (const callback of callbacks) callback(payload);
  };

  const flush = () => {
    if (socket?.readyState !== WebSocket.OPEN) return;
    while (pending.length > 0) socket.send(pending.shift());
  };

  const send = (event, payload = {}) => {
    pending.push(JSON.stringify({ event, payload }));
    flush();
  };

  const connect = () => {
    socket = new WebSocket(url);

    socket.addEventListener("open", () => {
      const session = getStoredSession();
      if (session) send("resume", session);
      flush();
    });

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.payload?.session) storeSession(message.payload.session);
      if (message.event === "resumed") storeSession(message.payload);
      if (message.event === "resumeFailed") clearSession();
      dispatch(message.event, message.payload);
    });

    socket.addEventListener("close", () => {
      dispatch("connectionLost", {});
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, 1000);
    });

    socket.addEventListener("error", () => {
      socket.close();
    });
  };

  connect();

  return {
    on(event, callback) {
      const callbacks = listeners.get(event) ?? [];
      callbacks.push(callback);
      listeners.set(event, callbacks);
    },
    emit: send,
    clearSession,
  };
};
