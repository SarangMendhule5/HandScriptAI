import React, { createContext, useState, useEffect, useContext, useCallback } from 'react';

const AuthContext = createContext();

// Read the user (id, email) out of the JWT payload. Returns null if the token is broken.
function userFromToken(token) {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64));
    // Expired token -> treat as logged out
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return { id: payload.userId, email: payload.email };
  } catch {
    return null;
  }
}

export const AuthProvider = ({ children }) => {
  const [token, setToken] = useState(() => {
    const saved = localStorage.getItem('token');
    return saved && userFromToken(saved) ? saved : null;
  });
  const [user, setUser] = useState(() => (token ? userFromToken(token) : null));

  // Keep localStorage in sync with the token
  useEffect(() => {
    if (token) localStorage.setItem('token', token);
    else localStorage.removeItem('token');
  }, [token]);

  const login = useCallback((newToken, userData) => {
    localStorage.setItem('token', newToken); // save immediately, before navigate('/')
    setToken(newToken);
    setUser(userData || userFromToken(newToken));
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
  }, []);

  // "loading" is kept so existing ProtectedRoute / PublicRoute code keeps working
  return (
    <AuthContext.Provider value={{ user, token, login, logout, loading: false }}>
      {children}
    </AuthContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);
