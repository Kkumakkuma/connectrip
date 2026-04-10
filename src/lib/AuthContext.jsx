import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from './supabase';

const AuthContext = createContext({});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (userId) => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
    setProfile(data);
    return data;
  };

  useEffect(() => {
    // Safety timeout - never hang on loading forever
    const timeout = setTimeout(() => {
      console.warn('Auth loading timeout - forcing ready state');
      setLoading(false);
    }, 3000);

    let initialDone = false;

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!initialDone) {
        initialDone = true;
        clearTimeout(timeout);
        setUser(session?.user ?? null);
        if (session?.user) {
          fetchProfile(session.user.id).catch(() => {}).finally(() => setLoading(false));
        } else {
          setLoading(false);
        }
      }
    }).catch(() => {
      if (!initialDone) {
        initialDone = true;
        clearTimeout(timeout);
        setLoading(false);
      }
    });

    // Listen for auth changes (after initial session)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        // Skip INITIAL_SESSION since getSession handles it
        if (!initialDone) {
          initialDone = true;
          clearTimeout(timeout);
        }
        setUser(session?.user ?? null);
        if (session?.user) {
          fetchProfile(session.user.id).catch(() => {});
        } else {
          setProfile(null);
        }
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signUp = async (email, password, userType = 'traveler') => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { user_type: userType } }
    });
    if (error) throw error;
    // Update profile with user_type
    if (data.user) {
      await supabase.from('profiles').update({ user_type: userType }).eq('id', data.user.id);
    }
    return data;
  };

  const signIn = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  };

  const signInWithProvider = async (provider) => {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider, // 'google', 'kakao'
      options: { redirectTo: window.location.origin }
    });
    if (error) throw error;
    return data;
  };

  const signOut = async () => {
    // 로컬 세션 먼저 강제 초기화
    setUser(null);
    setProfile(null);
    try {
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) console.error('signOut error:', error.message);
    } catch (err) {
      console.error('signOut exception:', err);
    }
  };

  const updateProfile = async (updates) => {
    if (!user) return;
    const { data, error } = await supabase
      .from('profiles')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', user.id)
      .select()
      .single();
    if (error) throw error;
    setProfile(data);
    return data;
  };

  const value = {
    user,
    profile,
    loading,
    signUp,
    signIn,
    signInWithProvider,
    signOut,
    updateProfile,
    fetchProfile,
    isLoggedIn: !!user,
    isCrew: profile?.user_type === 'crew',
    isAdmin: profile?.role === 'admin',
  };

  if (loading) {
    return (
      <AuthContext.Provider value={value}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ width: '40px', height: '40px', border: '4px solid #e2e8f0', borderTopColor: '#3b82f6', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
            <p style={{ color: '#64748b', fontSize: '14px' }}>ConnecTrip</p>
          </div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </AuthContext.Provider>
    );
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
