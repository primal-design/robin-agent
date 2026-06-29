import { jsx as _jsx } from "react/jsx-runtime";
import { createContext, useContext, useEffect, useState } from 'react';
const Ctx = createContext(null);
export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        const raw = localStorage.getItem('fen_auth');
        if (raw) {
            try {
                setUser(JSON.parse(raw));
            }
            catch {
                localStorage.removeItem('fen_auth');
            }
        }
        setLoading(false);
    }, []);
    const signIn = async (email) => {
        const { api } = await import('./api');
        await api.sendMagicLink(email);
    };
    const setTokenFromCallback = async (token, name) => {
        const authUser = { email: name ?? '', tenantId: '', token };
        localStorage.setItem('fen_token', token);
        localStorage.setItem('fen_auth', JSON.stringify(authUser));
        setUser(authUser);
    };
    const signOut = () => {
        localStorage.removeItem('fen_token');
        localStorage.removeItem('fen_auth');
        setUser(null);
    };
    return _jsx(Ctx.Provider, { value: { user, loading, signIn, signOut, setTokenFromCallback }, children: children });
}
export function useAuth() {
    const ctx = useContext(Ctx);
    if (!ctx)
        throw new Error('useAuth must be used inside AuthProvider');
    return ctx;
}
