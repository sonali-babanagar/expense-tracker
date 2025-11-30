// src/App.jsx
import React, { useEffect, useState, useCallback } from 'react'; 
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { supabase } from './lib/supabaseClient';
import Auth from './components/Auth';
import ExpenseInput from './components/ExpenseInput';
import Dashboard from './components/Dashboard';
import TripsTab from './components/TripsTab';

export default function App() {
  const [user, setUser] = useState(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [view, setView] = useState('casual');
  const [currentTrip, setCurrentTrip] = useState(null);
  const [hasTrips, setHasTrips] = useState(false);
  const [startDateStr, setStartDateStr] = useState(() => {
    return format(startOfMonth(new Date()), 'yyyy-MM-dd');
  });
  const [endDateStr, setEndDateStr] = useState(() => {
    return format(endOfMonth(new Date()), 'yyyy-MM-dd');
  });

  // Auth session
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoadingSession(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => listener.subscription.unsubscribe();
  }, []);
  
  // NEW: Function to check if any trip overlaps the current date range
  // This logic is necessary to run even when TripsTab is unmounted.
  const checkTripsForDateRange = useCallback(async (startStr, endStr) => {
    if (!user || !startStr || !endStr) {
        setHasTrips(false);
        return;
    }

    // 1. Parse dates for consistent filtering logic
    const [startY, startM, startD] = (startStr || '').split('-').map(Number);
    const [endY, endM, endD] = (endStr || '').split('-').map(Number);
    
    let startIso = null;
    let endIso = null;
    
    if (startY && startM && startD && endY && endM && endD) {
      // Use UTC dates for consistent DB comparison
      startIso = new Date(Date.UTC(startY, startM - 1, startD, 0, 0, 0)).toISOString();
      endIso = new Date(Date.UTC(endY, endM - 1, endD, 23, 59, 59, 999)).toISOString();
    }
    
    if (!startIso || !endIso) {
        setHasTrips(false);
        return;
    }

    // 2. Query Supabase for overlapping trips
    // A trip overlaps if: trip.start_date <= filter.end AND trip.end_date >= filter.start
    const { error, count } = await supabase
      .from('trips')
      .select('id', { count: 'exact', head: true }) 
      .eq('user_id', user.id)
      .lte('start_date', endIso) 
      .gte('end_date', startIso);  
    
    if (error) {
        console.error('Error checking trips:', error);
        setHasTrips(false);
    } else {
        setHasTrips(count > 0);
    }
  }, [user]);

  // FIX: This useEffect replaces the original user-only check and runs on date/user change.
  // It ensures the hasTrips status is correct immediately after a date range change.
  useEffect(() => {
    if (user && startDateStr && endDateStr) {
        checkTripsForDateRange(startDateStr, endDateStr);
    }
  }, [user, startDateStr, endDateStr, checkTripsForDateRange]); 

  // Wrap the handler in useCallback to ensure its identity is stable.
  const handleTripStatusChange = useCallback((count) => {
    setHasTrips(count > 0);
  }, []);
  
  if (loadingSession) return <div className="center">Loading...</div>;
  if (!user) return <Auth />;

  return (
    <div className="container">
      <header className="header">
        <h1 style={{ margin: 0 }}>Expense Tracker</h1>
        {/* Date Range Selector with Toggles and Sign Out */}
        <div style={{
          marginBottom: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          backgroundColor: 'rgba(102, 126, 234, 0.1)',
          padding: '12px 16px',
          borderRadius: '8px',
          borderLeft: '4px solid #667eea',
          justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontWeight: '500', color: '#333' }}>Filter by date:</span>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '14px' }}>
                From:
                <input
                  type="date"
                  value={startDateStr}
                  onChange={e => setStartDateStr(e.target.value)}
                  style={{
                    padding: '6px 8px',
                    borderRadius: '4px',
                    border: '1px solid #ccc',
                    fontSize: '14px'
                  }}
                />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '14px' }}>
                To:
                <input
                  type="date"
                  value={endDateStr}
                  onChange={e => setEndDateStr(e.target.value)}
                  style={{
                    padding: '6px 8px',
                    borderRadius: '4px',
                    border: '1px solid #ccc',
                    fontSize: '14px'
                  }}
                />
              </label>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <nav className="tabs" style={{ margin: 0, display: 'flex', alignItems: 'center', height: '40px' }}>
            <button
              className={view === 'casual' ? 'active' : ''}
              onClick={() => { setView('casual'); setCurrentTrip(null); }}
            >
              Casual
            </button>
            <button
              className={view === 'trips' ? 'active' : ''}
              onClick={() => setView('trips')}
              style={view === 'trips' ? { backgroundColor: '#667eea', color: 'white' } : {}}
            >
              Special
            </button>
          </nav>
          <button
            onClick={() => {
              if (window.confirm('Are you sure you want to sign out?')) {
                supabase.auth.signOut();
              }
            }}
            style={{
              background: 'transparent',
              color: '#667eea',
              border: '1px solid #667eea',
              padding: '8px 16px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '500',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              borderRadius: '4px',
              transition: 'all 0.2s ease',
              height: '40px',
              lineHeight: '1'
            }}
            onMouseOver={e => {
              e.target.style.background = '#667eea';
              e.target.style.color = 'white';
            }}
            onMouseOut={e => {
              e.target.style.background = 'transparent';
              e.target.style.color = '#667eea';
            }}
            title="Sign Out"
          >
            Sign out
            <span style={{ fontSize: '16px' }}>→</span>
          </button>
          </div>
        </div>
      </header>

      <main>
        {/* ========== CASUAL VIEW ========== */}
        {view === 'casual' && (
          <>
            {/* Only show if user has trips */}
            {hasTrips && (
              <div style={{
                background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
                color: 'white',
                padding: '20px 24px',
                borderRadius: '12px',
                marginBottom: '24px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                boxShadow: '0 6px 16px rgba(245,87,108,0.3)',
                cursor: 'pointer',
              }}
              onClick={() => setView('trips')}
              >
                <div>
                  <div style={{ fontWeight: 'bold', fontSize: '18px' }}>
                    Trips Active
                  </div>
                  <div style={{ fontSize: '14px', opacity: 0.9, marginTop: '4px' }}>
                    You have active trip budgets set up
                  </div>
                </div>                
                <button
                  style={{
                    background: 'rgba(255,255,255,0.2)',
                    border: '1px solid rgba(255,255,255,0.3)',
                    color: 'white',
                    padding: '10px 24px',
                    borderRadius: '8px',
                    fontWeight: 'bold',
                    fontSize: '15px',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                  }}
                  onMouseOver={e => e.target.style.background = 'rgba(255,255,255,0.3)'}
                  onMouseOut={e => e.target.style.background = 'rgba(255,255,255,0.2)'}
                >
                  View Special Expenses
                </button>
              </div>
            )}

            <ExpenseInput user={user} trip_id={null} />
            <Dashboard user={user} trip={null} startDateStr={startDateStr} endDateStr={endDateStr} onDateChange={(start, end) => { setStartDateStr(start); setEndDateStr(end); }} />
          </>
        )}

        {/* ========== TRIPS VIEW ========== */}
        {view === 'trips' && (
          <>
            <div style={{
              background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
              color: 'white',
              padding: '20px 24px',
              borderRadius: '12px',
              marginBottom: '20px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              boxShadow: '0 6px 16px rgba(245,87,108,0.3)',
            }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '20px' }}>Special Expenses</h2>
                <p style={{ margin: '6px 0 0', fontSize: '14px', opacity: 0.9 }}>
                  Manage your special trip expenses
                </p>
              </div>
              <button
                onClick={() => { setView('casual'); setCurrentTrip(null); }}
                style={{
                  background: 'rgba(255,255,255,0.2)',
                  border: '1px solid rgba(255,255,255,0.3)',
                  color: 'white',
                  padding: '10px 24px',
                  borderRadius: '8px',
                  fontWeight: 'bold',
                  fontSize: '15px',
                  cursor: 'pointer',
                }}
              >
                Back to Casual
              </button>
            </div>

            <TripsTab
              user={user}
              currentTrip={currentTrip}
              onTripSelect={setCurrentTrip}
              startDateStr={startDateStr}
              endDateStr={endDateStr}
              onTripStatusChange={handleTripStatusChange} 
            />

            {currentTrip && (
              <>
                <ExpenseInput user={user} trip_id={currentTrip.id} />
                <Dashboard user={user} trip={currentTrip} startDateStr={startDateStr} endDateStr={endDateStr} onDateChange={(start, end) => { setStartDateStr(start); setEndDateStr(end); }} />
              </>
            )}
          </>
        )}
      </main>

      <footer style={{ textAlign: 'center', color: '#888', marginTop: 40, fontSize: '14px' }}>
        Expense Tracker
      </footer>
    </div>
  );
}