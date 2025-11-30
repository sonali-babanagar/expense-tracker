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
    <div className="auth-card">
      <h2>{isLogin ? 'Sign In' : 'Create Account'}</h2>

      <form onSubmit={handleSubmit} className="auth-form">
        <input
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <input
          type="password"
          placeholder="password (min 6 chars)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required={!isLogin ? true : false}
        />

        <button type="submit" className="btn" disabled={loading}>
          {loading ? 'Please wait...' : isLogin ? 'Sign In' : 'Sign Up'}
        </button>
      </form>

      <div style={{ marginTop: 8 }}>
        <button className="link" onClick={() => setIsLogin(!isLogin)}>
          {isLogin ? 'Create an account' : 'Already have an account? Sign In'}
        </button>
      </div>

      <div style={{ marginTop: 6 }}>
        <button className="link" onClick={handleMagicLink}>Send magic link</button>
      </div>

      {message && <p className="message">{message}</p>}
    </div>
  );
}
