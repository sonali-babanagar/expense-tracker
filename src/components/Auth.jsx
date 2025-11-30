import React, { useState } from 'react';
import { supabase } from '../lib/supabaseClient';

export default function Auth() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) setMessage(error.message);
        else setMessage('Signed in successfully!');
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) {
          setMessage(error.message);
        } else if (data?.user) {
          // Account created successfully
          if (data.user.confirmed_at) {
            setMessage('Account created! You can now sign in.');
          } else {
            setMessage('Account created! Check your email to confirm (if email verification is enabled).');
          }
          // Clear form
          setEmail('');
          setPassword('');
        }
      }
    } catch (err) {
      setMessage('Unexpected error: ' + err.message);
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleMagicLink(e) {
    e.preventDefault();
    if (!email) return setMessage('Enter email for magic link');
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({ email });
    setLoading(false);
    if (error) setMessage(error.message);
    else setMessage('Magic link sent to your email (check spam).');
  }

  return (
    <div className="auth-card" style={{ maxWidth: 'min(420px, 90vw)', margin: 'clamp(20px, 5vw, 60px) auto', padding: 'clamp(14px, 3vw, 20px)' }}>
      <h2 style={{ fontSize: 'clamp(1.5rem, 5vw, 1.8rem)', marginBottom: 'clamp(12px, 2vw, 16px)' }}>{isLogin ? 'Sign In' : 'Create Account'}</h2>

      <form onSubmit={handleSubmit} className="auth-form" style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(8px, 2vw, 12px)' }}>
        <input
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={{ fontSize: '16px', padding: 'clamp(10px, 2vw, 12px)' }}
        />

        <input
          type="password"
          placeholder="password (min 6 chars)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required={!isLogin ? true : false}
          style={{ fontSize: '16px', padding: 'clamp(10px, 2vw, 12px)' }}
        />

        <button type="submit" className="btn" disabled={loading} style={{ marginTop: 'clamp(4px, 1vw, 8px)', fontSize: 'clamp(13px, 2.2vw, 16px)', padding: 'clamp(10px, 2vw, 12px)', fontWeight: 'bold' }}>
          {loading ? 'Please wait...' : isLogin ? 'Sign In' : 'Sign Up'}
        </button>
      </form>

      <div style={{ marginTop: 'clamp(8px, 1.5vw, 12px)' }}>
        <button className="link" onClick={() => setIsLogin(!isLogin)} style={{ fontSize: 'clamp(13px, 2.2vw, 14px)', padding: 'clamp(4px, 1vw, 8px)' }}>
          {isLogin ? 'Create an account' : 'Already have an account? Sign In'}
        </button>
      </div>

      <div style={{ marginTop: 'clamp(6px, 1vw, 10px)' }}>
        <button className="link" onClick={handleMagicLink} style={{ fontSize: 'clamp(13px, 2.2vw, 14px)', padding: 'clamp(4px, 1vw, 8px)' }}>Send magic link</button>
      </div>

      {message && <p className="message" style={{ fontSize: 'clamp(12px, 2vw, 14px)', marginTop: 'clamp(8px, 1.5vw, 12px)', padding: 'clamp(8px, 1.5vw, 10px)', textAlign: 'center', color: message.includes('successfully') ? '#4caf50' : '#e85a5a' }}>{message}</p>}
    </div>
  );
}
